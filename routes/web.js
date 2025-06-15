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
            authentication: true, // Our custom auth system
            stripe: !!(config.stripe?.secretKey && config.stripe?.publishableKey),
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

// Show login page
router.get('/login', (req, res) => {
    const { isElectron } = req.query;
    res.render('login', { 
        error: req.session.error,
        isElectron: isElectron === 'true',
        isAuthPage: true
    });
    delete req.session.error;
});

// Show register page
router.get('/register', (req, res) => {
    const { isElectron } = req.query;
    res.render('register', { 
        error: req.session.error,
        isElectron: isElectron === 'true',
        isAuthPage: true
    });
    delete req.session.error;
});

// Dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        console.log('📊 Dashboard access:', { 
            user: req.user?.email, 
            tenant: req.tenant?.name,
            tenant_status: req.tenant?.status 
        });
        
        const user = req.user;
        const tenant = req.tenant;
        
        // Get all users in this tenant (for admin view)
        let tenantUsers = [];
        if (user.role === 'admin') {
            tenantUsers = await db('users')
                .where('tenant_id', tenant.id)
                .where('id', '!=', user.id) // Exclude current user
                .orderBy('created_at', 'desc');
        }
        
        // Check if this is a new registration (show welcome message)
        const isNewRegistration = req.query.welcome === 'true';
        
        // Simple status check
        const isActive = tenant.status === 'active';
        
        res.render('dashboard', {
            user,
            tenant,
            tenantUsers,
            isNewRegistration,
            isActive,
            isDashboard: true
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Server error');
    }
});

// Billing page
router.get('/billing', requireAuth, (req, res) => {
    res.render('billing', {
        user: req.user,
        tenant: req.tenant,
        title: 'Choose Your Plan',
        isAuthPage: true
    });
});

module.exports = router; 