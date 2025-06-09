const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const lemonSqueezyService = require('../services/lemonSqueezy');

// Utility function to deactivate team members when subscription becomes inactive
async function deactivateTeamMembersForInactiveSubscription(subscriptionId) {
    try {
        console.log('🚫 Deactivating team members for inactive subscription:', subscriptionId);
        
        // Update all team members to 'suspended' status
        const updatedMembers = await db('team_members')
            .where('subscription_id', subscriptionId)
            .update({ 
                status: 'suspended',
                suspended_at: new Date()
            })
            .returning(['email', 'status']);
        
        console.log('✅ Deactivated team members:', updatedMembers);
        return updatedMembers;
    } catch (error) {
        console.error('❌ Error deactivating team members:', error);
        throw error;
    }
}

// Utility function to reactivate team members when subscription becomes active
async function reactivateTeamMembersForActiveSubscription(subscriptionId) {
    try {
        console.log('✅ Reactivating team members for active subscription:', subscriptionId);
        
        // Update suspended team members back to 'active' status
        const updatedMembers = await db('team_members')
            .where('subscription_id', subscriptionId)
            .where('status', 'suspended')
            .update({ 
                status: 'active',
                suspended_at: null
            })
            .returning(['email', 'status']);
        
        console.log('✅ Reactivated team members:', updatedMembers);
        return updatedMembers;
    } catch (error) {
        console.error('❌ Error reactivating team members:', error);
        throw error;
    }
}

// Subscribe route
router.get('/subscribe', requireAuth, async (req, res) => {
    try {
        const { plan } = req.query;
        
        if (!plan || !['basic', 'pro'].includes(plan)) {
            return res.redirect('/dashboard');
        }
        
        // Check if Lemon Squeezy is configured
        if (!lemonSqueezyService.isConfigured()) {
            console.error('Lemon Squeezy not configured');
            return res.send(lemonSqueezyService.getConfigErrorMessage());
        }
        
        const user = req.user;
        
        if (!lemonSqueezyService.isPlanConfigured(plan)) {
            console.error(`Variant ID not configured for ${plan} plan`);
            return res.send(lemonSqueezyService.getPlanConfigErrorMessage(plan));
        }

        // Create Lemon Squeezy checkout
        const checkout = await lemonSqueezyService.createCheckoutForPlan(plan, user);
        
        // Extract the checkout URL from the response
        const checkoutUrl = checkout?.data?.data?.attributes?.url;
        
        if (checkoutUrl) {
            console.log(`✅ Redirecting to checkout: ${checkoutUrl}`);
            res.redirect(checkoutUrl);
        } else {
            console.error('❌ No checkout URL found in response:', JSON.stringify(checkout, null, 2));
            throw new Error('Failed to create checkout - no URL returned');
        }
        
    } catch (error) {
        console.error('Subscribe error:', error);
        res.redirect('/dashboard?error=subscription_failed');
    }
});

// Add team member (simple email-based)
router.post('/dashboard/add-team-member', requireAuth, async (req, res) => {
    try {
        const { email } = req.body;
        const user = req.user;
        
        console.log('👥 Adding team member:', email, 'for user:', user.id);
        
        const subscription = await db('subscriptions')
            .where('user_id', user.id)
            .where('status', 'active')
            .first();
        
        if (!subscription) {
            console.log('❌ No active subscription found');
            return res.redirect('/dashboard?error=no_subscription');
        }
        
        // Count current team members
        const currentMembers = await db('team_members')
            .where('subscription_id', subscription.id)
            .count('* as count')
            .first();
        
        const currentMemberCount = parseInt(currentMembers.count);
        const newMemberCount = currentMemberCount + 1;
        
        // If adding member exceeds seat limit, we need to upgrade the subscription
        if (newMemberCount > subscription.seats) {
            console.log('💰 Upgrading subscription seats from', subscription.seats, 'to', newMemberCount);
            
            // Update Lemon Squeezy subscription quantity if we have a subscription ID
            if (subscription.lemon_squeezy_subscription_id) {
                try {
                    await lemonSqueezyService.updateSubscriptionQuantity(
                        subscription.lemon_squeezy_subscription_id, 
                        newMemberCount
                    );
                    console.log('✅ Lemon Squeezy subscription upgraded');
                } catch (lemonSqueezyError) {
                    console.error('❌ Failed to upgrade Lemon Squeezy subscription:', lemonSqueezyError);
                    return res.redirect('/dashboard?error=billing_upgrade_failed');
                }
            }
            
            // Update our database seat count
            await db('subscriptions')
                .where('id', subscription.id)
                .update({ 
                    seats: newMemberCount,
                    updated_at: new Date()
                });
            
            console.log('✅ Subscription upgraded to', newMemberCount, 'seats');
        }
        
        // Check if email is already added
        const existingMember = await db('team_members')
            .where('subscription_id', subscription.id)
            .where('email', email)
            .first();
        
        if (existingMember) {
            console.log('❌ Email already added to team');
            return res.redirect('/dashboard?error=email_already_added');
        }
        
        // Add team member
        const memberData = {
            subscription_id: subscription.id,
            email: email,
            status: 'invited'
        };
        
        await db('team_members').insert(memberData);
        console.log('✅ Team member added successfully');
        
        res.redirect('/dashboard?success=member_added');
    } catch (error) {
        console.error('❌ Add team member error:', error);
        res.redirect('/dashboard?error=add_member_failed');
    }
});

// Remove team member
router.post('/dashboard/remove-team-member', requireAuth, async (req, res) => {
    try {
        const { member_id } = req.body;
        const user = req.user;
        
        console.log('🗑️ Removing team member:', member_id, 'for user:', user.id);
        
        // Verify member belongs to user's subscription
        const member = await db('team_members')
            .join('subscriptions', 'team_members.subscription_id', 'subscriptions.id')
            .where('team_members.id', member_id)
            .where('subscriptions.user_id', user.id)
            .select('team_members.*')
            .first();
        
        if (member) {
            await db('team_members').where('id', member_id).del();
            console.log('✅ Team member removed successfully');
        }
        
        res.redirect('/dashboard?success=member_removed');
    } catch (error) {
        console.error('❌ Remove team member error:', error);
        res.redirect('/dashboard?error=remove_member_failed');
    }
});

// Cancel subscription
router.post('/dashboard/cancel-subscription', requireAuth, async (req, res) => {
    try {
        const user = req.user;
        
        const subscription = await db('subscriptions')
            .where('user_id', user.id)
            .where('status', 'active')
            .first();
        
        if (subscription) {
            console.log('❌ Cancelling subscription:', subscription.id);
            
            // First deactivate all team members
            await deactivateTeamMembersForInactiveSubscription(subscription.id);
            
            // Then cancel the subscription
            await db('subscriptions').where('id', subscription.id).update({
                status: 'cancelled',
                cancelled_at: new Date()
            });
            
            console.log('✅ Subscription cancelled successfully');
        }
        
        res.redirect('/dashboard?success=subscription_cancelled');
    } catch (error) {
        console.error('❌ Cancel subscription error:', error);
        res.redirect('/dashboard?error=cancel_failed');
    }
});

// Payment success page
router.get('/payment/success', async (req, res) => {
    try {
        const { plan } = req.query;
        res.render('payment-success', {
            title: 'Payment Successful',
            plan: plan || 'your selected'
        });
    } catch (error) {
        console.error('Payment success error:', error);
        res.render('payment-success', {
            title: 'Payment Successful',
            plan: 'your selected'
        });
    }
});

// Payment cancelled page
router.get('/payment/cancelled', (req, res) => {
    res.render('payment-cancelled', {
        title: 'Payment Cancelled'
    });
});

// Lemon Squeezy webhook
router.post('/webhooks/lemonsqueezy', async (req, res) => {
    try {
        console.log('🔔 Webhook received from Lemon Squeezy');
        
        // Convert Buffer to string, then parse JSON
        const rawBody = req.body.toString('utf8');
        console.log('📦 Raw webhook body:', rawBody.substring(0, 200) + '...');
        
        const event = JSON.parse(rawBody);
        console.log('📋 Webhook event type:', event.meta?.event_name);
        
        // Process the webhook with Lemon Squeezy service
        await lemonSqueezyService.processWebhookEvent(event, db);
        
        // Handle team member status based on subscription changes
        if (event.meta?.event_name === 'subscription_cancelled' || 
            event.meta?.event_name === 'subscription_expired') {
            
            const subscriptionId = event.data?.attributes?.first_subscription_item?.subscription_id;
            
            if (subscriptionId) {
                // Find our internal subscription
                const subscription = await db('subscriptions')
                    .where('lemon_squeezy_subscription_id', subscriptionId)
                    .first();
                
                if (subscription) {
                    console.log('🚫 Deactivating team members for cancelled/expired subscription');
                    await deactivateTeamMembersForInactiveSubscription(subscription.id);
                }
            }
        } else if (event.meta?.event_name === 'subscription_resumed' || 
                   event.meta?.event_name === 'subscription_unpaused') {
            
            const subscriptionId = event.data?.attributes?.first_subscription_item?.subscription_id;
            
            if (subscriptionId) {
                // Find our internal subscription
                const subscription = await db('subscriptions')
                    .where('lemon_squeezy_subscription_id', subscriptionId)
                    .first();
                
                if (subscription) {
                    console.log('✅ Reactivating team members for resumed subscription');
                    await reactivateTeamMembersForActiveSubscription(subscription.id);
                }
            }
        }
        
        console.log('✅ Webhook processed successfully');
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook error:', error);
        console.error('Raw body type:', typeof req.body);
        console.error('Raw body:', req.body);
        res.status(400).send('Error processing webhook');
    }
});

// Export utility functions for use in other parts of the app
module.exports = router;
module.exports.deactivateTeamMembersForInactiveSubscription = deactivateTeamMembersForInactiveSubscription;
module.exports.reactivateTeamMembersForActiveSubscription = reactivateTeamMembersForActiveSubscription; 