const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

// Marketing homepage
router.get('/', async (req, res) => {
    try {
        let user = null;
        if (req.session.user) {
            user = await db('users').where('id', req.session.user.id).first();
        }
        
        // Check service configuration status for development
        const serviceStatus = {
            workos: !!(config.workos.clientId && config.workos.apiKey),
            lemonSqueezy: !!(config.lemonSqueezy.apiKey && config.lemonSqueezy.storeId),
            claude: !!config.claude.apiKey,
            database: false // Will be true if we get here without errors
        };
        
        try {
            await db.raw('SELECT 1');
            serviceStatus.database = true;
        } catch (dbError) {
            console.error('Database connection error:', dbError.message);
        }
        
        res.render('index', { 
            user, 
            serviceStatus: config.nodeEnv === 'development' ? serviceStatus : null 
        });
    } catch (error) {
        console.error('Homepage error:', error);
        res.render('index');
    }
});

// Login page
router.get('/login', (req, res) => {
    res.render('login', { error: req.session.error });
    delete req.session.error;
});

// Dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const user = req.user;
        
        // Get subscription
        const subscription = await db('subscriptions')
            .where('user_id', user.id)
            .where('status', 'active')
            .first();
        
        // Get team members for this subscription
        let teamMembers = [];
        if (subscription) {
            teamMembers = await db('team_members')
                .where('subscription_id', subscription.id)
                .orderBy('created_at', 'desc');
        }
        
        // Check if trial is active
        const trial_active = user.trial_ends_at && new Date(user.trial_ends_at) > new Date() && !user.trial_used;
        
        res.render('dashboard', {
            user,
            subscription,
            teamMembers,
            trial_active,
            isDashboard: true
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Server error');
    }
});

module.exports = router; 