const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const stripeService = require('../services/stripe');

// Handle login (web only - desktop uses /desktop/login)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🔐 Web login attempt:', { 
            email: email?.toLowerCase(), 
            hasPassword: !!password,
            sessionExists: !!req.session,
            headers: {
                'user-agent': req.headers['user-agent'],
                'x-forwarded-proto': req.headers['x-forwarded-proto'],
                'host': req.headers.host
            }
        });
        
        if (!email || !password) {
            console.log('❌ Missing email or password');
            req.session.error = 'Email and password are required';
            return res.redirect('/login');
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
            console.log('❌ User not found:', email?.toLowerCase());
            req.session.error = 'Invalid email or password';
            return res.redirect('/login');
        }
        
        console.log('✅ User found:', { 
            email: user.email, 
            status: user.status, 
            tenant_status: user.tenant_status,
            isInvited: user.first_name === 'Invited' && user.last_name === 'User'
        });
        
        // Check if this is an invited user who needs to set their password
        const isInvitedUser = user.first_name === 'Invited' && user.last_name === 'User';
        if (isInvitedUser) {
            req.session.error = 'You were invited to this team. Please register with this email to set your password.';
            return res.redirect('/register');
        }
        
        // Verify password
        console.log('🔍 About to check password for:', user.email, 'Hash exists:', !!user.password_hash);
        
        let isValidPassword = false;
        try {
            isValidPassword = await bcrypt.compare(password, user.password_hash);
            console.log('🔑 Password check result:', { email: user.email, isValid: isValidPassword });
        } catch (bcryptError) {
            console.error('❌ Bcrypt error:', bcryptError);
            req.session.error = 'Login failed. Please try again.';
            return res.redirect('/login');
        }
        
        if (!isValidPassword) {
            console.log('❌ Invalid password for:', user.email);
            req.session.error = 'Invalid email or password';
            return res.redirect('/login');
        }
        
        // Check if user is inactive (suspended)
        if (user.status === 'inactive') {
            console.log('❌ User account inactive:', user.email);
            req.session.error = 'Your account has been suspended. Please contact support.';
            return res.redirect('/login');
        }
        
        console.log('👋 Web user login successful:', user.email);
        
        // Normal web authentication
        console.log('💾 Creating session for user:', user.id);
        req.session.user = { id: user.id };
        
        // Save session explicitly and wait for it
        req.session.save((err) => {
            if (err) {
                console.error('❌ Session save error:', err);
                req.session.error = 'Login failed. Please try again.';
                return res.redirect('/login');
            }
            console.log('✅ Session saved for user:', user.id);
            res.redirect('/dashboard');
        });
        
    } catch (error) {
        console.error('Web login error:', error);
        req.session.error = 'Login failed. Please try again.';
        res.redirect('/login');
    }
});

// Handle registration (web only - desktop users register via web)
router.post('/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName } = req.body;
        
        if (!email || !password || !firstName || !lastName) {
            req.session.error = 'All fields are required';
            return res.redirect(`/register`);
        }
        
        if (password.length < 6) {
            req.session.error = 'Password must be at least 6 characters';
            return res.redirect(`/register`);
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
                
                // Normal web authentication
                req.session.user = { id: existingUser.id };
                res.redirect('/dashboard?welcome=true');
                return;
            } else {
                req.session.error = 'User with this email already exists';
                return res.redirect(`/register`);
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
        
        // For web users, set session and redirect to trial setup
        req.session.user = { id: newUser.id };
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('Registration error:', error);
        req.session.error = 'Registration failed. Please try again.';
        res.redirect(`/register`);
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