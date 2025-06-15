const db = require('../db');

// Authentication middleware
async function requireAuth(req, res, next) {
    try {
        // Check if user is logged in
        if (!req.session.user || !req.session.user.id) {
            return res.redirect('/login');
        }
        
        // Get user and tenant details
        const user = await db('users')
            .join('tenants', 'users.tenant_id', 'tenants.id')
            .where('users.id', req.session.user.id)
            .select(
                'users.id',
                'users.email',
                'users.first_name',
                'users.last_name',
                'users.role',
                'users.status',
                'users.tenant_id',
                'tenants.name as tenant_name',
                'tenants.stripe_customer_id',
                'tenants.stripe_subscription_id',
                'tenants.plan as tenant_plan',
                'tenants.seats as tenant_seats',
                'tenants.status as tenant_status'
            )
            .first();
        
        if (!user) {
            // User not found, clear session
            req.session.destroy();
            return res.redirect('/login');
        }
        
        // Check if user is inactive (suspended)
        if (user.status === 'inactive') {
            req.session.destroy();
            return res.redirect('/login?error=account_suspended');
        }
        
        // DON'T check tenant status here - let them access dashboard to choose plan!
        
        // Attach user and tenant info to request
        req.user = {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            status: user.status
        };
        
        req.tenant = {
            id: user.tenant_id,
            name: user.tenant_name,
            stripe_customer_id: user.stripe_customer_id,
            stripe_subscription_id: user.stripe_subscription_id,
            plan: user.tenant_plan,
            seats: user.tenant_seats,
            status: user.tenant_status
        };
        
        // Make user and tenant available to views
        res.locals.user = req.user;
        res.locals.tenant = req.tenant;
        
        next();
        
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).send('Authentication error');
    }
}

module.exports = {
    requireAuth
}; 