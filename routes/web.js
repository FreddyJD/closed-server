const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const axios = require('axios');

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

// Download page - fetch latest releases from GitHub
router.get('/download', requireAuth, async (req, res) => {
    try {
        console.log('📥 Download page access:', { 
            user: req.user?.email, 
            tenant: req.tenant?.name 
        });
        
        const user = req.user;
        const tenant = req.tenant;
        
        // Fetch latest releases from GitHub
        let releases = [];
        let error = null;
        
        try {
            const response = await axios.get('https://api.github.com/repos/tryhiding/closed-download/releases', {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'ClosedAI-Download-Page'
                },
                timeout: 10000
            });
            
            // Process releases and organize by platform
            releases = response.data.map(release => {
                const assets = release.assets || [];
                
                // Categorize assets by platform
                const windows = assets.filter(asset => 
                    asset.name.includes('.exe') || 
                    asset.name.includes('.nupkg') || 
                    asset.name.includes('RELEASES')
                );
                
                const macIntel = assets.filter(asset => 
                    (asset.name.includes('osx-x64') || asset.name.includes('darwin-x64')) &&
                    (asset.name.includes('.dmg') || asset.name.includes('.zip'))
                );
                
                const macArm = assets.filter(asset => 
                    (asset.name.includes('osx-arm64') || asset.name.includes('darwin-arm64')) &&
                    (asset.name.includes('.dmg') || asset.name.includes('.zip'))
                );
                
                return {
                    ...release,
                    platforms: {
                        windows: windows.filter(asset => asset.name.includes('.exe')), // Only .exe for main installer
                        macIntel: macIntel.filter(asset => asset.name.includes('.dmg')), // Prefer .dmg
                        macArm: macArm.filter(asset => asset.name.includes('.dmg')), // Prefer .dmg
                    },
                    version: release.tag_name.replace('v', ''),
                    publishedDate: new Date(release.published_at).toLocaleDateString(),
                    isLatest: response.data[0].id === release.id
                };
            }).filter(release => 
                // Only show releases that have at least one downloadable asset
                release.platforms.windows.length > 0 || 
                release.platforms.macIntel.length > 0 || 
                release.platforms.macArm.length > 0
            );
            
        } catch (apiError) {
            console.error('GitHub API error:', apiError.message);
            error = 'Unable to fetch latest releases. Please try again later.';
        }
        
        res.render('download', {
            user,
            tenant,
            releases,
            error,
            isDownloadPage: true,
            title: 'Download Closed Desktop'
        });
        
    } catch (error) {
        console.error('Download page error:', error);
        res.status(500).render('download', {
            user: req.user,
            tenant: req.tenant,
            releases: [],
            error: 'Server error occurred. Please try again later.',
            isDownloadPage: true,
            title: 'Download Closed Desktop'
        });
    }
});

module.exports = router; 