const express = require('express');
const router = express.Router();
const db = require('../db');
const aiService = require('../services/ai');
const crypto = require('crypto');

// AI-only approach - clean and simple (for desktop app)
let transcriptionBuffer = [];
let shownCards = new Set(); 
let shownCardTypes = new Set(); 
let lastAnalysisTime = 0;

// Health check
router.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            authentication: true, // Our custom auth system
            claude: !!require('../config').claude.apiKey,
            stripe: !!(require('../config').stripe?.secretKey && require('../config').stripe?.publishableKey),
            database: false
        }
    };
    
    try {
        await db.raw('SELECT 1');
        health.services.database = true;
    } catch (error) {
        health.services.database = false;
        health.database_error = error.message;
    }
    
    res.json(health);
});

// Handle Electron authentication (called from auth routes)
function handleElectronAuth(user, res) {
    // Generate a temporary auth token for Electron
    const authToken = crypto.randomBytes(32).toString('hex');
    
    // Store token temporarily (you might want to use Redis for this in production)
    global.electronTokens = global.electronTokens || new Map();
    global.electronTokens.set(authToken, {
        userId: user.id,
        email: user.email,
        expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    });
    
    // Clean up expired tokens
    for (const [token, data] of global.electronTokens.entries()) {
        if (data.expiresAt < Date.now()) {
            global.electronTokens.delete(token);
        }
    }
    
    // Redirect to deep link that will open the Electron app
    const deepLinkUrl = `closedai://auth?token=${authToken}`;
    
    return res.render('auth-success', {
        title: 'Authentication Successful - Closed AI',
        deepLinkUrl: deepLinkUrl,
        authToken: authToken
    });
}

// Electron token validation endpoint
router.post('/validate-electron-token', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Token is required'
            });
        }
        
        global.electronTokens = global.electronTokens || new Map();
        const tokenData = global.electronTokens.get(token);
        
        if (!tokenData) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }
        
        if (tokenData.expiresAt < Date.now()) {
            global.electronTokens.delete(token);
            return res.status(401).json({
                success: false,
                error: 'Token expired'
            });
        }
        
        // Get user and tenant details
        const user = await db('users')
            .join('tenants', 'users.tenant_id', 'tenants.id')
            .where('users.id', tokenData.userId)
            .select(
                'users.*',
                'tenants.status as tenant_status',
                'tenants.plan as tenant_plan'
            )
            .first();
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Only check if user is suspended, not tenant status
        console.log('🔍 Validating user access for:', user.email, 'tenant status:', user.tenant_status);
        
        if (user.status === 'inactive') {
            console.log('🚫 User account suspended');
            return res.status(403).json({
                success: false,
                error: 'Your account has been suspended. Please contact support.',
                shouldLogout: true
            });
        }
        
        // Let inactive tenants through - they can see billing options in dashboard
        
        // Clean up the token (one-time use)
        global.electronTokens.delete(token);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: user.role
            },
            tenant: {
                plan: user.tenant_plan,
                status: user.tenant_status
            }
        });
        
    } catch (error) {
        console.error('Token validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during token validation'
        });
    }
});

// Desktop app periodic access validation
router.post('/validate-access', async (req, res) => {
    try {
        const { userEmail } = req.body;
        
        if (!userEmail) {
            return res.status(400).json({
                success: false,
                error: 'User email is required'
            });
        }
        
        console.log('🔍 Periodic access validation for:', userEmail);
        
        // Get user and tenant
        const user = await db('users')
            .join('tenants', 'users.tenant_id', 'tenants.id')
            .where('users.email', userEmail)
            .select(
                'users.*',
                'tenants.status as tenant_status',
                'tenants.plan as tenant_plan'
            )
            .first();
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                shouldLogout: true
            });
        }
        
        // Only check if user is suspended, not tenant status
        if (user.status === 'inactive') {
            console.log('🚫 User account suspended');
            return res.status(403).json({
                success: false,
                error: 'Your account has been suspended. Please contact support.',
                shouldLogout: true
            });
        }
        
        // Let inactive tenants through - they can access app and see billing options
        
        console.log('✅ Periodic validation passed for:', userEmail);
        res.json({
            success: true,
            tenant: {
                plan: user.tenant_plan,
                status: user.tenant_status
            }
        });
        
    } catch (error) {
        console.error('❌ Periodic validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during access validation'
        });
    }
});

// Reset shown cards (for new conversations)
router.post('/cards/reset', (req, res) => {
    shownCards.clear();
    shownCardTypes.clear();
    transcriptionBuffer = [];
    lastAnalysisTime = 0;
    res.json({
        success: true,
        message: 'Cards reset for new conversation'
    });
});

// Manual card generation (bypasses all protections)
router.post('/cards/manual-generate', async (req, res) => {
    try {
        const { selectedLines } = req.body;
        
        if (!selectedLines || !Array.isArray(selectedLines) || selectedLines.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Selected lines are required'
            });
        }
        
        console.log(`🎯 Manual card generation requested for ${selectedLines.length} lines`);
        
        try {
            // Force AI analysis on selected lines
            const aiCard = await aiService.generateSmartCard(selectedLines, true); // true = force generation
            
            if (aiCard) {
                console.log('🎯 Manual card generated:', aiCard.title);
                
                return res.json({
                    success: true,
                    card: aiCard,
                    message: 'Manual card generated successfully'
                });
            } else {
                return res.json({
                    success: false,
                    error: 'AI could not generate a card from selected lines'
                });
            }
            
        } catch (error) {
            console.error('Manual AI analysis error:', error);
            return res.json({
                success: false,
                error: 'AI analysis failed: ' + error.message
            });
        }
        
    } catch (error) {
        console.error('Error in manual card generation:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Analyze transcription with AI (smart, cost-effective)
router.post('/cards/analyze', async (req, res) => {
    try {
        const { transcription, speaker } = req.body;
        
        if (!transcription || transcription.trim().length < 5) {
            return res.json({
                success: true,
                cards: [],
                message: 'Transcription too short'
            });
        }
        
        // Add to buffer
        transcriptionBuffer.push({
            text: transcription.trim(),
            speaker: speaker,
            timestamp: new Date().toISOString()
        });
        
        // Keep only last 12 transcriptions for context
        if (transcriptionBuffer.length > 12) {
            transcriptionBuffer = transcriptionBuffer.slice(-12);
        }
        
        const now = Date.now();
        const timeSinceLastAnalysis = now - lastAnalysisTime;
        
        // Smart analysis timing: every 3 transcriptions OR every 30 seconds (whichever comes first)
        const shouldAnalyze = (
            transcriptionBuffer.length >= 3 && 
            (transcriptionBuffer.length % 3 === 0 || timeSinceLastAnalysis > 30000)
        );
        
        if (!shouldAnalyze) {
            return res.json({
                success: true,
                cards: [],
                message: 'Collecting more context...'
            });
        }
        
        lastAnalysisTime = now;
        
        // Get AI analysis
        try {
            const aiCard = await aiService.generateSmartCard(transcriptionBuffer);
            
            if (aiCard && !shownCards.has(aiCard.id) && !shownCardTypes.has(aiCard.type)) {
                shownCards.add(aiCard.id);
                shownCardTypes.add(aiCard.type);
                
                return res.json({
                    success: true,
                    cards: [aiCard],
                    message: `AI card generated: ${aiCard.type}`
                });
            } else {
                const reason = !aiCard ? 'No actionable opportunity detected' :
                              shownCards.has(aiCard.id) ? 'Card already shown' :
                              shownCardTypes.has(aiCard.type) ? `${aiCard.type} card already shown` :
                              'Unknown reason';
                              
                return res.json({
                    success: true,
                    cards: [],
                    message: reason
                });
            }
            
        } catch (error) {
            console.error('AI analysis error:', error);
            return res.json({
                success: true,
                cards: [],
                error: 'AI analysis failed: ' + error.message
            });
        }
        
    } catch (error) {
        console.error('Error analyzing transcription:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Export the handleElectronAuth function for use in auth routes
module.exports = router;
module.exports.handleElectronAuth = handleElectronAuth; 