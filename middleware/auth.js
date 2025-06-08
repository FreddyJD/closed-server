const db = require('../db');

// Authentication middleware
async function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    
    try {
        // Get user from database
        const user = await db('users').where('id', req.session.user.id).first();
        if (!user) {
            req.session.destroy();
            return res.redirect('/login');
        }
        req.user = user;
        res.locals.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.redirect('/login');
    }
}

module.exports = {
    requireAuth
}; 