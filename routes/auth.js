const express = require('express');
const router = express.Router();
const db = require('../db');
const workosService = require('../services/workos');
const { createTrialSubscription } = require('../utils/license');
const crypto = require('crypto');

// WorkOS authentication (login)
router.get('/login', async (req, res) => {
    try {
        // Check if WorkOS is configured
        if (!workosService.isConfigured()) {
            console.error('WorkOS not configured');
            return res.send(workosService.getConfigErrorMessage());
        }
        
        const authorizationUrl = workosService.getAuthorizationUrl('login');
        res.redirect(authorizationUrl);
    } catch (error) {
        console.error('WorkOS auth error:', error);
        req.session.error = 'Authentication failed';
        res.redirect('/');
    }
});

// Electron-specific authentication (returns token instead of redirect)
router.get('/electron-login', async (req, res) => {
    try {
        // Check if WorkOS is configured
        if (!workosService.isConfigured()) {
            console.error('WorkOS not configured');
            return res.send(workosService.getConfigErrorMessage());
        }
        
        // Create special redirect URI for Electron
        const authorizationUrl = workosService.getAuthorizationUrl() + '&state=electron';
        res.redirect(authorizationUrl);
    } catch (error) {
        console.error('Electron WorkOS auth error:', error);
        res.status(500).send('Authentication failed');
    }
});

// WorkOS callback
router.get('/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        
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
            
            // Start free trial for new users
            await createTrialSubscription(user.id);
        }
        
        // Handle Electron authentication differently
        if (state === 'electron') {
            // Generate a temporary auth token for Electron
            const authToken = crypto.randomBytes(32).toString('hex');
            
            // Store token temporarily (you might want to use Redis for this in production)
            // For now, we'll use a simple in-memory store with expiration
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
        
        // Normal web authentication - set session and redirect to dashboard
        req.session.user = { id: user.id };
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('WorkOS callback error:', error);
        req.session.error = 'Authentication failed';
        res.redirect('/');
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
        
        // Get user details
        const user = await db('users').where('id', tokenData.userId).first();
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // STRICT SUBSCRIPTION VALIDATION - NO ACCESS WITHOUT PAYMENT! 💳
        let hasActiveAccess = false;
        let subscriptionInfo = null;
        let accessDeniedReason = '';
        
        console.log('🔍 Validating subscription access for user:', user.email);
        
        // First check if user is the subscription owner
        const userSubscription = await db('subscriptions')
            .where('user_id', user.id)
            .first(); // Get any subscription, not just active ones
        
        if (userSubscription) {
            console.log('👑 User is subscription owner, status:', userSubscription.status);
            
            // Only allow access if subscription is active or trialing
            if (['active', 'trialing'].includes(userSubscription.status)) {
                hasActiveAccess = true;
                subscriptionInfo = {
                    type: 'owner',
                    status: userSubscription.status,
                    plan: userSubscription.plan,
                    seats: userSubscription.seats,
                    expires_at: userSubscription.expires_at
                };
                console.log('✅ Owner has active subscription access');
            } else {
                accessDeniedReason = `Your ${userSubscription.plan} subscription is ${userSubscription.status}. Please reactivate your subscription to continue using Closed AI.`;
                console.log('❌ Owner subscription inactive:', userSubscription.status);
            }
        } else {
            console.log('🔍 Not subscription owner, checking team member status...');
            
            // Check if user is a team member with active parent subscription
            const teamMember = await db('team_members')
                .join('subscriptions', 'team_members.subscription_id', 'subscriptions.id')
                .where('team_members.email', user.email)
                .select(
                    'team_members.*', 
                    'subscriptions.status as subscription_status', 
                    'subscriptions.plan',
                    'subscriptions.user_id as owner_id'
                )
                .first();
            
            if (teamMember) {
                console.log('👥 User is team member, subscription status:', teamMember.subscription_status, 'member status:', teamMember.status);
                
                // Check if team member is suspended
                if (teamMember.status === 'suspended') {
                    accessDeniedReason = 'Your team access has been suspended. Please contact your team administrator.';
                    console.log('❌ Team member is suspended');
                } 
                // Check if parent subscription is active
                else if (!['active', 'trialing'].includes(teamMember.subscription_status)) {
                    accessDeniedReason = `Team subscription is ${teamMember.subscription_status}. Please contact your team administrator to reactivate.`;
                    console.log('❌ Parent subscription inactive:', teamMember.subscription_status);
                } 
                // All good, grant access
                else {
                    hasActiveAccess = true;
                    subscriptionInfo = {
                        type: 'team_member',
                        status: teamMember.subscription_status,
                        plan: teamMember.plan,
                        member_status: teamMember.status,
                        owner_id: teamMember.owner_id
                    };
                    console.log('✅ Team member has active access');
                }
            } else {
                accessDeniedReason = 'No subscription found. Please subscribe to Closed AI or ask to be added to a team.';
                console.log('❌ No subscription or team membership found');
            }
        }
        
        // DENY ACCESS IF NO VALID SUBSCRIPTION 🚫
        if (!hasActiveAccess) {
            console.log('🚫 ACCESS DENIED:', accessDeniedReason);
            return res.status(403).json({
                success: false,
                error: accessDeniedReason,
                requiresSubscription: true,
                redirectUrl: 'http://localhost:4000/dashboard' // Redirect to web dashboard to subscribe
            });
        }
        
        // Clean up the token (one-time use)
        global.electronTokens.delete(token);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name
            },
            subscription: subscriptionInfo
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
router.post('/api/desktop/validate-access', async (req, res) => {
    try {
        const { userEmail } = req.body;
        
        if (!userEmail) {
            return res.status(400).json({
                success: false,
                error: 'User email is required'
            });
        }
        
        console.log('🔍 Periodic access validation for:', userEmail);
        
        // Get user
        const user = await db('users').where('email', userEmail).first();
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                shouldLogout: true
            });
        }
        
        // Same validation logic as token validation
        let hasActiveAccess = false;
        let subscriptionInfo = null;
        let accessDeniedReason = '';
        
        // Check if user is subscription owner
        const userSubscription = await db('subscriptions')
            .where('user_id', user.id)
            .first();
        
        if (userSubscription) {
            if (['active', 'trialing'].includes(userSubscription.status)) {
                hasActiveAccess = true;
                subscriptionInfo = {
                    type: 'owner',
                    status: userSubscription.status,
                    plan: userSubscription.plan,
                    seats: userSubscription.seats
                };
            } else {
                accessDeniedReason = `Your ${userSubscription.plan} subscription is ${userSubscription.status}. Please reactivate your subscription.`;
            }
        } else {
            // Check team member status
            const teamMember = await db('team_members')
                .join('subscriptions', 'team_members.subscription_id', 'subscriptions.id')
                .where('team_members.email', user.email)
                .select(
                    'team_members.*', 
                    'subscriptions.status as subscription_status', 
                    'subscriptions.plan'
                )
                .first();
            
            if (teamMember) {
                if (teamMember.status === 'suspended') {
                    accessDeniedReason = 'Your team access has been suspended. Please contact your team administrator.';
                } else if (!['active', 'trialing'].includes(teamMember.subscription_status)) {
                    accessDeniedReason = `Team subscription is ${teamMember.subscription_status}. Please contact your team administrator.`;
                } else {
                    hasActiveAccess = true;
                    subscriptionInfo = {
                        type: 'team_member',
                        status: teamMember.subscription_status,
                        plan: teamMember.plan,
                        member_status: teamMember.status
                    };
                }
            } else {
                accessDeniedReason = 'No subscription found. Please subscribe to access Closed AI.';
            }
        }
        
        if (!hasActiveAccess) {
            console.log('🚫 Periodic validation failed:', accessDeniedReason);
            return res.status(403).json({
                success: false,
                error: accessDeniedReason,
                shouldLogout: true,
                redirectUrl: 'http://localhost:4000/dashboard'
            });
        }
        
        console.log('✅ Periodic validation passed for:', userEmail);
        res.json({
            success: true,
            subscription: subscriptionInfo
        });
        
    } catch (error) {
        console.error('❌ Periodic validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during access validation'
        });
    }
});

// Logout
router.get('/logout', (req, res) => {
    const userEmail = req.session.user?.email;
    
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
            return res.redirect('/dashboard?error=logout_failed');
        }
        
        // Clear the session cookie
        res.clearCookie('connect.sid');
        
        // Log the logout
        if (userEmail) {
            console.log(`👋 User logged out: ${userEmail}`);
        }
        
        // Redirect to home with success message
        res.redirect('/?message=logged_out');
    });
});

// POST logout for AJAX requests
router.post('/logout', (req, res) => {
    const userEmail = req.session.user?.email;
    
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
            return res.status(500).json({
                success: false,
                error: 'Logout failed'
            });
        }
        
        // Clear the session cookie
        res.clearCookie('connect.sid');
        
        // Log the logout
        if (userEmail) {
            console.log(`👋 User logged out via API: ${userEmail}`);
        }
        
        res.json({
            success: true,
            message: 'Successfully logged out'
        });
    });
});

module.exports = router; 