const express = require('express');
const router = express.Router();
const db = require('../db');
const workosService = require('../services/workos');
const { createTrialSubscription } = require('../utils/license');

// WorkOS authentication
router.get('/workos', async (req, res) => {
    try {
        // Check if WorkOS is configured
        if (!workosService.isConfigured()) {
            console.error('WorkOS not configured');
            return res.send(workosService.getConfigErrorMessage());
        }
        
        const authorizationUrl = workosService.getAuthorizationUrl();
        res.redirect(authorizationUrl);
    } catch (error) {
        console.error('WorkOS auth error:', error);
        req.session.error = 'Authentication failed';
        res.redirect('/login');
    }
});

// WorkOS callback
router.get('/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            throw new Error('No authorization code received');
        }
        
        // Exchange code for user
        const { user: workosUser } = await workosService.authenticateWithCode(code);
        
        // Find or create user in database
        let user = await db('users').where('workos_user_id', workosUser.id).first();
        
        if (!user) {
            // Create new user
            const userData = {
                workos_user_id: workosUser.id,
                email: workosUser.email,
                first_name: workosUser.firstName,
                last_name: workosUser.lastName,
                profile_picture_url: workosUser.profilePictureUrl
            };
            
            const [newUser] = await db('users').insert(userData).returning('*');
            user = newUser;
            
            // Start free trial
            await createTrialSubscription(user.id);
        }
        
        // Set session
        req.session.user = { id: user.id };
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('WorkOS callback error:', error);
        req.session.error = 'Authentication failed';
        res.redirect('/login');
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

module.exports = router; 