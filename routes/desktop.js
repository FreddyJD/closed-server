const express = require('express');
const router = express.Router();
const db = require('../db');
const aiService = require('../services/ai');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// AI-only approach - clean and simple (for desktop app)
let transcriptionBuffer = [];
let shownCards = new Set(); 
let shownCardTypes = new Set(); 
let lastAnalysisTime = 0;

// Desktop login (more restrictive than web - requires active tenant)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🖥️ Desktop login attempt:', { 
            email: email?.toLowerCase(),
            hasPassword: !!password
        });
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        // Find user by email
        const user = await db('users')
            .join('tenants', 'users.tenant_id', 'tenants.id')
            .where('users.email', email.toLowerCase())
            .select(
                'users.*',
                'tenants.status as tenant_status',
                'tenants.plan as tenant_plan'
            )
            .first();
        
        if (!user) {
            console.log('❌ Desktop: User not found:', email?.toLowerCase());
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        // Check if this is an invited user
        const isInvitedUser = user.first_name === 'Invited' && user.last_name === 'User';
        if (isInvitedUser) {
            return res.status(401).json({
                success: false,
                error: 'Please complete your registration on the web first',
                requiresWebRegistration: true
            });
        }
        
        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            console.log('❌ Desktop: Invalid password for:', user.email);
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        // Check if user is inactive (suspended)
        if (user.status === 'inactive') {
            console.log('❌ Desktop: User account inactive:', user.email);
            return res.status(403).json({
                success: false,
                error: 'Your account has been suspended. Please contact support.',
                shouldLogout: true
            });
        }
        
        // DESKTOP RESTRICTION: Require active tenant for full access
        if (user.tenant_status !== 'active') {
            console.log('🚫 Desktop: Tenant not active:', user.email, 'status:', user.tenant_status);
            return res.status(403).json({
                success: false,
                error: 'Desktop access requires an active subscription. Please visit our website to subscribe.',
                requiresSubscription: true,
                tenant_status: user.tenant_status
            });
        }
        
        console.log('✅ Desktop login successful:', user.email);
        
        // Generate auth token for desktop
        const authToken = crypto.randomBytes(32).toString('hex');
        
        // Store token
        global.electronTokens = global.electronTokens || new Map();
        global.electronTokens.set(authToken, {
            userId: user.id,
            email: user.email,
            expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours for desktop
        });
        
        res.json({
            success: true,
            token: authToken,
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
        console.error('❌ Desktop login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed. Please try again.'
        });
    }
});

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

module.exports = router;