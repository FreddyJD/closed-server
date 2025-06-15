const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const stripeService = require('../services/stripe');
const bcrypt = require('bcrypt');

// Subscribe route - creates Stripe checkout session
router.get('/subscribe', requireAuth, async (req, res) => {
    try {
        const { plan } = req.query;
        
        if (!plan || !['basic', 'pro'].includes(plan)) {
            return res.redirect('/dashboard');
        }
        
        // Check if Stripe is configured
        if (!stripeService.isConfigured()) {
            console.error('Stripe not configured');
            return res.send(stripeService.getConfigErrorMessage());
        }
        
        const user = req.user;
        const tenant = req.tenant;
        
        // Update tenant plan
        await db('tenants')
            .where('id', tenant.id)
            .update({ 
                plan: plan,
                updated_at: new Date()
            });
        
        // Create Stripe checkout session
        const session = await stripeService.createCheckoutSession(
            plan,
            tenant,
            user,
            `${req.protocol}://${req.get('host')}/billing/success?plan=${plan}`,
            `${req.protocol}://${req.get('host')}/billing/cancelled`
        );
        
        console.log(`✅ Redirecting to Stripe checkout: ${session.url}`);
        res.redirect(session.url);
        
    } catch (error) {
        console.error('Subscribe error:', error);
        res.redirect('/dashboard?error=subscription_failed');
    }
});

// Add user to tenant (admin only)
router.post('/add-user', requireAuth, async (req, res) => {
    try {
        const { email } = req.body;
        const user = req.user;
        const tenant = req.tenant;
        
        // Only admins can add users
        if (user.role !== 'admin') {
            return res.redirect('/dashboard?error=not_authorized');
        }
        
        console.log('👥 Adding user:', email, 'to tenant:', tenant.id);
        
        // Check if tenant has active subscription
        if (tenant.status !== 'active') {
            console.log('❌ Tenant subscription not active:', tenant.status);
            return res.redirect('/dashboard?error=subscription_required');
        }
        
        // Count current users in tenant
        const currentUsers = await db('users')
            .where('tenant_id', tenant.id)
            .count('* as count')
            .first();
        
        const currentUserCount = parseInt(currentUsers.count);
        const newUserCount = currentUserCount + 1;
        
        // If adding user exceeds seat limit, we need to upgrade the subscription
        if (newUserCount > tenant.seats) {
            console.log('💰 Upgrading tenant seats from', tenant.seats, 'to', newUserCount);
            
            // Update Stripe subscription quantity if we have a subscription ID
            if (tenant.stripe_subscription_id) {
                try {
                    await stripeService.updateSubscriptionQuantity(
                        tenant.stripe_subscription_id, 
                        newUserCount
                    );
                    console.log('✅ Stripe subscription quantity updated to', newUserCount);
                } catch (stripeError) {
                    console.error('❌ Failed to upgrade Stripe subscription:', stripeError);
                    return res.redirect('/dashboard?error=billing_upgrade_failed');
                }
            } else {
                console.log('⚠️ No Stripe subscription ID found, but allowing seat increase');
            }
            
            // Update our database seat count
            await db('tenants')
                .where('id', tenant.id)
                .update({ 
                    seats: newUserCount,
                    updated_at: new Date()
                });
            
            console.log('✅ Tenant upgraded to', newUserCount, 'seats');
        }
        
        // Check if email is already in this tenant
        const existingUser = await db('users')
            .where('tenant_id', tenant.id)
            .where('email', email.toLowerCase())
            .first();
        
        if (existingUser) {
            console.log('❌ Email already in tenant');
            return res.redirect('/dashboard?error=email_already_added');
        }
        
        // Create a placeholder user record with temporary password
        // They'll need to register/login to set their actual password
        const tempPassword = await bcrypt.hash(`temp_${Date.now()}`, 10);
        
        const userData = {
            tenant_id: tenant.id,
            email: email.toLowerCase(),
            password_hash: tempPassword,
            first_name: 'Invited',
            last_name: 'User',
            role: 'member',
            status: 'active'
        };
        
        await db('users').insert(userData);
        console.log('✅ User invitation added successfully');
        
        res.redirect('/dashboard?success=user_invited');
    } catch (error) {
        console.error('❌ Add user error:', error);
        res.redirect('/dashboard?error=add_user_failed');
    }
});

// Remove user from tenant (admin only)
router.post('/remove-user', requireAuth, async (req, res) => {
    try {
        const { user_id } = req.body;
        const currentUser = req.user;
        const tenant = req.tenant;
        
        // Only admins can remove users
        if (currentUser.role !== 'admin') {
            return res.redirect('/dashboard?error=not_authorized');
        }
        
        console.log('🗑️ Removing user:', user_id, 'from tenant:', tenant.id);
        
        // Verify user belongs to this tenant and isn't the admin
        const userToRemove = await db('users')
            .where('id', user_id)
            .where('tenant_id', tenant.id)
            .first();
        
        if (userToRemove) {
            // Don't allow removing the admin
            if (userToRemove.role === 'admin') {
                return res.redirect('/dashboard?error=cannot_remove_admin');
            }
            
            // Remove the user first
            await db('users').where('id', user_id).del();
            console.log('✅ User removed successfully');
            
            // Update subscription quantity to reduce billing
            if (tenant.stripe_subscription_id && tenant.status === 'active') {
                try {
                    // Count remaining users
                    const remainingUsers = await db('users')
                        .where('tenant_id', tenant.id)
                        .count('* as count')
                        .first();
                    
                    const newUserCount = parseInt(remainingUsers.count);
                    
                    console.log('💰 Reducing subscription from', tenant.seats, 'to', newUserCount, 'seats');
                    
                    // Update Stripe subscription (with proration credit)
                    await stripeService.updateSubscriptionQuantity(
                        tenant.stripe_subscription_id, 
                        newUserCount
                    );
                    
                    // Update our database seat count
                    await db('tenants')
                        .where('id', tenant.id)
                        .update({ 
                            seats: newUserCount,
                            updated_at: new Date()
                        });
                    
                    console.log('✅ Subscription reduced - user will get prorated credit');
                    
                } catch (stripeError) {
                    console.error('❌ Failed to reduce Stripe subscription:', stripeError);
                    // Don't fail the user removal, just log the billing issue
                }
            }
        }
        
        res.redirect('/dashboard?success=user_removed');
    } catch (error) {
        console.error('❌ Remove user error:', error);
        res.redirect('/dashboard?error=remove_user_failed');
    }
});

// Cancel subscription (admin only)
router.post('/cancel-subscription', requireAuth, async (req, res) => {
    try {
        const user = req.user;
        const tenant = req.tenant;
        
        // Only admins can cancel subscription
        if (user.role !== 'admin') {
            return res.redirect('/dashboard?error=not_authorized');
        }
        
        if (tenant.stripe_subscription_id) {
            console.log('❌ Cancelling subscription:', tenant.stripe_subscription_id);
            
            // Cancel the Stripe subscription
            await stripeService.cancelSubscription(tenant.stripe_subscription_id);
            
            console.log('✅ Subscription cancellation scheduled');
        }
        
        res.redirect('/dashboard?success=subscription_cancelled');
    } catch (error) {
        console.error('❌ Cancel subscription error:', error);
        res.redirect('/dashboard?error=cancel_failed');
    }
});

// Payment success page
router.get('/success', async (req, res) => {
    try {
        const { plan } = req.query;
        res.render('success', {
            title: 'Payment Successful',
            plan: plan || 'your selected'
        });
    } catch (error) {
        console.error('Payment success error:', error);
        res.render('success', {
            title: 'Payment Successful',
            plan: 'your selected'
        });
    }
});

// Payment cancelled page
router.get('/cancelled', (req, res) => {
    res.render('billing', {
        title: 'Payment Cancelled',
        error: 'Payment was cancelled. Please try again.'
    });
});

// Stripe webhook - handles subscription status changes
router.post('/webhooks/stripe', async (req, res) => {
    try {
        console.log('🔔 Stripe webhook received');
        
        // Parse the raw body as JSON
        const event = JSON.parse(req.body.toString());
        console.log('📋 Webhook event type:', event.type);
        
        // Handle different webhook events
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object);
                break;
                
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object);
                break;
                
            case 'customer.subscription.deleted':
            case 'invoice.payment_failed':
            case 'customer.subscription.past_due':
                await handleSubscriptionDeactivated(event.data.object);
                break;
                
            case 'invoice.payment_succeeded':
                await handlePaymentSucceeded(event.data.object);
                break;
                
            default:
                console.log('🤷 Unhandled webhook event type:', event.type);
        }
        
        console.log('✅ Webhook processed successfully');
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(400).send('Error processing webhook');
    }
});

// Helper function to handle checkout completion (including trials)
async function handleCheckoutCompleted(session) {
    console.log('✅ Handling checkout completion:', session.id);
    
    if (session.client_reference_id) {
        const tenantId = session.client_reference_id;
        
        await db('tenants')
            .where('id', tenantId)
            .update({
                stripe_subscription_id: session.subscription,
                status: 'active',
                updated_at: new Date()
            });
        
        console.log('✅ Tenant activated after checkout:', tenantId);
    }
}

// Helper function to handle subscription updates
async function handleSubscriptionUpdated(subscription) {
    console.log('🔄 Handling subscription update:', subscription.id);
    
    const tenant = await db('tenants')
        .where('stripe_subscription_id', subscription.id)
        .first();
    
    if (tenant) {
        await db('tenants')
            .where('id', tenant.id)
            .update({
                status: 'active',
                seats: subscription.quantity || 1,
                updated_at: new Date()
            });
        
        console.log('✅ Tenant activated:', tenant.id);
    }
}

// Helper function to handle subscription deactivation  
async function handleSubscriptionDeactivated(subscription) {
    console.log('🚫 Handling subscription deactivation:', subscription.id);
    
    const tenant = await db('tenants')
        .where('stripe_subscription_id', subscription.id)
        .first();
    
    if (tenant) {
        // Set status based on subscription cancel behavior
        const status = subscription.canceled_at ? 'cancelled' : 'inactive';
        
        // Update tenant status but keep users active until period ends if cancelled
        await db('tenants')
            .where('id', tenant.id)
            .update({
                status: status,
                updated_at: new Date()
            });
        
        // Only deactivate users if truly deleted (not just cancelled)
        if (!subscription.canceled_at) {
            await db('users')
                .where('tenant_id', tenant.id)
                .update({
                    status: 'inactive',
                    updated_at: new Date()
                });
        }
        
        console.log(`🚫 Tenant ${status}:`, tenant.id);
    }
}

// Helper function to handle successful payments
async function handlePaymentSucceeded(invoice) {
    console.log('💳 Handling payment success for subscription:', invoice.subscription);
    
    if (invoice.subscription) {
        const tenant = await db('tenants')
            .where('stripe_subscription_id', invoice.subscription)
            .first();
        
        if (tenant) {
            // Reactivate tenant and users if they were deactivated
            await db('tenants')
                .where('id', tenant.id)
                .update({
                    status: 'active',
                    updated_at: new Date()
                });
            
            await db('users')
                .where('tenant_id', tenant.id)
                .update({
                    status: 'active',
                    updated_at: new Date()
                });
            
            console.log('✅ Tenant and users reactivated after payment:', tenant.id);
        }
    }
}

// Redirect to Stripe billing portal (admin only)
router.get('/portal', requireAuth, async (req, res) => {
    try {
        const user = req.user;
        const tenant = req.tenant;
        
        // Only admins can access billing
        if (user.role !== 'admin') {
            return res.redirect('/dashboard?error=not_authorized');
        }
        
        // Must have a Stripe customer ID
        if (!tenant.stripe_customer_id) {
            return res.redirect('/dashboard?error=no_billing_setup');
        }
        
        console.log('🏪 Creating billing portal session for:', tenant.stripe_customer_id);
        
        // Create Stripe billing portal session
        const session = await stripeService.createBillingPortalSession(
            tenant.stripe_customer_id,
            `${req.protocol}://${req.get('host')}/dashboard`
        );
        
        // Redirect to Stripe's managed billing portal
        res.redirect(session.url);
        
    } catch (error) {
        console.error('❌ Billing portal error:', error);
        res.redirect('/dashboard?error=billing_portal_failed');
    }
});

module.exports = router; 