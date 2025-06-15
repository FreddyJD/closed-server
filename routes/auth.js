const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const stripeService = require('../services/stripe');
const { handleElectronAuth } = require('./desktop');

// Handle login
router.post('/login', async (req, res) => {
    try {
        const { email, password, isElectron } = req.body;
        
        if (!email || !password) {
            req.session.error = 'Email and password are required';
            return res.redirect(`/login${isElectron ? '?isElectron=true' : ''}`);
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
            req.session.error = 'Invalid email or password';
            return res.redirect(`/login${isElectron ? '?isElectron=true' : ''}`);
        }
        
        // Check if this is an invited user who needs to set their password
        const isInvitedUser = user.first_name === 'Invited' && user.last_name === 'User';
        if (isInvitedUser) {
            req.session.error = 'You were invited to this team. Please register with this email to set your password.';
            return res.redirect(`/register${isElectron ? '?isElectron=true' : ''}`);
        }
        
        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect(`/login${isElectron ? '?isElectron=true' : ''}`);
        }
        
        // Check if user is inactive (suspended)
        if (user.status === 'inactive') {
            req.session.error = 'Your account has been suspended. Please contact support.';
            return res.redirect(`/login${isElectron ? '?isElectron=true' : ''}`);
        }
        
        // DON'T check tenant status - let them access dashboard to choose plan!
        
        console.log('👋 User login:', user.email);
        
        // Handle Electron authentication
        if (isElectron === 'true') {
            return handleElectronAuth(user, res);
        }
        
        // Normal web authentication
        req.session.user = { id: user.id };
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('Login error:', error);
        req.session.error = 'Login failed. Please try again.';
        res.redirect(`/login${req.body.isElectron ? '?isElectron=true' : ''}`);
    }
});

// Handle registration
router.post('/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, isElectron } = req.body;
        
        if (!email || !password || !firstName || !lastName) {
            req.session.error = 'All fields are required';
            return res.redirect(`/register${isElectron ? '?isElectron=true' : ''}`);
        }
        
        if (password.length < 6) {
            req.session.error = 'Password must be at least 6 characters';
            return res.redirect(`/register${isElectron ? '?isElectron=true' : ''}`);
        }
        
        // Check if user already exists
        const existingUser = await db('users').where('email', email.toLowerCase()).first();
        
        if (existingUser) {
            // Check if this is an invited user updating their info
            const isInvitedUser = existingUser.first_name === 'Invited' && existingUser.last_name === 'User';
            
            if (isInvitedUser) {
                // Update the invited user's information
                const passwordHash = await bcrypt.hash(password, 10);
                
                await db('users')
                    .where('id', existingUser.id)
                    .update({
                        password_hash: passwordHash,
                        first_name: firstName,
                        last_name: lastName,
                        updated_at: new Date()
                    });
                
                console.log('✅ Invited user completed registration:', email);
                
                // Handle Electron authentication
                if (isElectron === 'true') {
                    return handleElectronAuth({...existingUser, first_name: firstName, last_name: lastName}, res);
                }
                
                // Normal web authentication
                req.session.user = { id: existingUser.id };
                res.redirect('/dashboard?welcome=true');
                return;
            } else {
                req.session.error = 'User with this email already exists';
                return res.redirect(`/register${isElectron ? '?isElectron=true' : ''}`);
            }
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Create Stripe customer
        const customer = await stripeService.createCustomer(
            email.toLowerCase(),
            `${firstName} ${lastName}`
        );
        
        // Create tenant with INACTIVE status - only Stripe will activate it
        const tenantData = {
            name: `${firstName}'s Team`,
            stripe_customer_id: customer.id,
            plan: 'basic',
            seats: 1,
            status: 'inactive' // Start inactive until Stripe trial setup completes
        };
        
        const [tenant] = await db('tenants').insert(tenantData).returning('*');
        
        // Create user
        const userData = {
            tenant_id: tenant.id,
            email: email.toLowerCase(),
            password_hash: passwordHash,
            first_name: firstName,
            last_name: lastName,
            role: 'admin' // First user is always admin of their tenant
        };
        
        const [newUser] = await db('users').insert(userData).returning('*');
        
        console.log('🆕 New user registered:', newUser.email, 'tenant:', tenant.id);
        
        // For Electron, handle differently
        if (isElectron === 'true') {
            // Store user session first, then redirect to trial setup
            req.session.user = { id: newUser.id };
            return res.render('trial-setup-electron', {
                title: 'Complete Your Trial Setup',
                tenant: tenant,
                user: newUser,
                isElectron: true
            });
        }
        
        // For web users, set session and redirect to trial setup
        req.session.user = { id: newUser.id };
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('Registration error:', error);
        req.session.error = 'Registration failed. Please try again.';
        res.redirect(`/register${req.body.isElectron ? '?isElectron=true' : ''}`);
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