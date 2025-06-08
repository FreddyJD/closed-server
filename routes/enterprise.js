const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const lemonSqueezyService = require('../services/lemonSqueezy');

// WorkOS Enterprise Pricing (per month)
const WORKOS_PRICING = {
    sso: 125,              // $125/month per connection
    directorySync: 125,    // $125/month per connection  
    authorization: 0,      // Free tier (starts free)
    auditLogs: 5          // $5/month per organization
};

const SUPPORT_MARKUP = 0.30; // 30% markup for support

// Calculate enterprise pricing
function calculateEnterprisePricing(seats, plan = 'basic', features = {}) {
    const seatPrice = plan === 'pro' ? 25 : 5;
    const seatCost = seats * seatPrice;
    
    let workosFeatures = 0;
    if (features.sso) workosFeatures += WORKOS_PRICING.sso;
    if (features.directorySync) workosFeatures += WORKOS_PRICING.directorySync;
    if (features.authorization) workosFeatures += WORKOS_PRICING.authorization;
    if (features.auditLogs) workosFeatures += WORKOS_PRICING.auditLogs;
    
    const subtotal = seatCost + workosFeatures;
    const supportFee = subtotal * SUPPORT_MARKUP;
    const total = subtotal + supportFee;
    
    return {
        seats,
        seatPrice,
        seatCost,
        workosFeatures: {
            sso: features.sso ? WORKOS_PRICING.sso : 0,
            directorySync: features.directorySync ? WORKOS_PRICING.directorySync : 0,
            authorization: features.authorization ? WORKOS_PRICING.authorization : 0,
            auditLogs: features.auditLogs ? WORKOS_PRICING.auditLogs : 0,
            total: workosFeatures
        },
        subtotal,
        supportFee,
        total,
        breakdown: {
            'Battle Cards Seats': `$${seatPrice} × ${seats} seats = $${seatCost}`,
            'WorkOS Enterprise Features': `$${workosFeatures}`,
            'Support & Management (30%)': `$${supportFee.toFixed(2)}`,
            'Total Monthly': `$${total.toFixed(2)}`
        }
    };
}

// Enterprise landing page
router.get('/', (req, res) => {
    res.render('enterprise', {
        title: 'Enterprise Solutions',
        workos_pricing: WORKOS_PRICING,
        support_markup_percent: SUPPORT_MARKUP * 100
    });
});

// Enterprise pricing calculator API
router.post('/calculate-pricing', (req, res) => {
    try {
        const { seats, plan, features } = req.body;
        
        if (!seats || seats < 1) {
            return res.status(400).json({
                error: 'Number of seats must be at least 1'
            });
        }
        
        const pricing = calculateEnterprisePricing(
            parseInt(seats), 
            plan || 'basic',
            features || {}
        );
        
        res.json({
            success: true,
            pricing
        });
    } catch (error) {
        console.error('Pricing calculation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to calculate pricing'
        });
    }
});

// Enterprise signup form
router.get('/signup', (req, res) => {
    res.render('enterprise-signup', {
        title: 'Enterprise Signup'
    });
});

// Process enterprise signup
router.post('/signup', async (req, res) => {
    try {
        const {
            company_name,
            company_domain,
            contact_name,
            contact_email,
            contact_phone,
            estimated_seats,
            plan,
            features,
            notes
        } = req.body;
        
        // Validate required fields
        if (!company_name || !company_domain || !contact_name || !contact_email || !estimated_seats) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        // Calculate pricing
        const selectedFeatures = {
            sso: features && features.includes('sso'),
            directorySync: features && features.includes('directorySync'),
            authorization: features && features.includes('authorization'),
            auditLogs: features && features.includes('auditLogs')
        };
        
        const pricing = calculateEnterprisePricing(
            parseInt(estimated_seats),
            plan || 'basic',
            selectedFeatures
        );
        
        // Store enterprise inquiry in database
        await db('enterprise_inquiries').insert({
            company_name,
            company_domain,
            contact_name,
            contact_email,
            contact_phone,
            estimated_seats: parseInt(estimated_seats),
            plan: plan || 'basic',
            features: selectedFeatures,
            pricing_total: pricing.total,
            notes,
            status: 'pending_review'
        });
        
        // TODO: Send notification to sales team
        // TODO: Create initial quote/proposal
        
        res.json({
            success: true,
            message: 'Enterprise inquiry submitted successfully',
            pricing,
            next_steps: [
                'Our enterprise team will review your requirements',
                'We\'ll contact you within 24 hours to discuss your needs',
                'Custom pricing and implementation timeline will be provided',
                'SSO setup and team onboarding can begin immediately after agreement'
            ]
        });
        
    } catch (error) {
        console.error('Enterprise signup error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process enterprise signup'
        });
    }
});

// Enterprise dashboard (for existing enterprise customers)
router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const user = req.user;
        
        // Check if user is part of an enterprise organization
        const orgMembership = await db('user_organizations')
            .join('organizations', 'user_organizations.organization_id', 'organizations.id')
            .where('user_organizations.user_id', user.id)
            .where('user_organizations.role', 'in', ['owner', 'admin'])
            .first();
        
        if (!orgMembership) {
            return res.redirect('/enterprise/signup');
        }
        
        // Get organization details
        const organization = await db('organizations')
            .where('id', orgMembership.organization_id)
            .first();
        
        // Get organization subscription
        const subscription = await db('subscriptions')
            .where('organization_id', organization.id)
            .where('status', 'active')
            .first();
        
        // Get team members
        const teamMembers = await db('user_organizations')
            .join('users', 'user_organizations.user_id', 'users.id')
            .where('user_organizations.organization_id', organization.id)
            .select('users.*', 'user_organizations.role', 'user_organizations.joined_at')
            .orderBy('user_organizations.joined_at', 'desc');
        
        // Get license seats
        let seats = [];
        if (subscription) {
            seats = await db('seats')
                .where('subscription_id', subscription.id)
                .orderBy('created_at', 'desc');
        }
        
        res.render('enterprise-dashboard', {
            title: 'Enterprise Dashboard',
            user,
            organization,
            subscription,
            teamMembers,
            seats,
            userRole: orgMembership.role
        });
        
    } catch (error) {
        console.error('Enterprise dashboard error:', error);
        res.status(500).send('Server error');
    }
});

module.exports = router; 