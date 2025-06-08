const express = require('express');
const router = express.Router();
const db = require('../db');
const aiService = require('../services/ai');

// AI-only approach - no manual cards (for desktop app)
let transcriptionBuffer = [];
let shownCards = new Set(); // Prevent duplicate cards by ID
let shownCardTypes = new Set(); // Prevent duplicate card types (e.g., multiple pricing objections)
let lastAnalysisTime = 0;

// Health check
router.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            workos: !!(require('../config').workos.clientId && require('../config').workos.apiKey),
            lemonSqueezy: !!(require('../config').lemonSqueezy.apiKey && require('../config').lemonSqueezy.storeId),
            claude: !!require('../config').claude.apiKey,
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
                // Don't add to duplicate prevention sets for manual generation
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