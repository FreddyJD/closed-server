const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const lemonSqueezyService = require('../services/lemonSqueezy');
const { generateLicenseKey } = require('../utils/license');

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

// Add seat
router.post('/dashboard/add-seat', requireAuth, async (req, res) => {
    try {
        const { email } = req.body;
        const user = req.user;
        
        console.log('🔍 DEBUG: Adding seat for user:', user.id, 'email:', email);
        
        const subscription = await db('subscriptions')
            .where('user_id', user.id)
            .where('status', 'active')
            .first();
        
        console.log('🔍 DEBUG: Found subscription for seat:', subscription ? subscription.id : 'NONE');
        
        if (!subscription) {
            console.log('❌ DEBUG: No active subscription found for user');
            return res.redirect('/dashboard?error=no_subscription');
        }
        
        // Count current seats
        const currentSeats = await db('seats')
            .where('subscription_id', subscription.id)
            .where('status', '!=', 'revoked')
            .count('* as count')
            .first();
        
        const currentSeatCount = parseInt(currentSeats.count);
        const newSeatCount = currentSeatCount + 1;
        
        console.log('🔍 DEBUG: Current seats:', currentSeatCount, '→ New seats:', newSeatCount);
        
        // Update Lemon Squeezy subscription quantity first
        if (subscription.lemon_squeezy_subscription_id) {
            console.log('💰 Updating Lemon Squeezy subscription quantity...');
            try {
                await lemonSqueezyService.updateSubscriptionQuantity(
                    subscription.lemon_squeezy_subscription_id, 
                    newSeatCount
                );
                console.log('✅ Lemon Squeezy subscription updated - billing will be processed');
            } catch (lemonSqueezyError) {
                console.error('❌ Failed to update Lemon Squeezy subscription:', lemonSqueezyError);
                return res.redirect('/dashboard?error=billing_update_failed');
            }
        }
        
        // Generate license key
        const licenseKey = generateLicenseKey();
        console.log('🔍 DEBUG: Generated license key:', licenseKey);
        
        const seatData = {
            subscription_id: subscription.id,
            user_email: email,
            license_key: licenseKey,
            status: 'unused'
        };
        
        // Update our database seat count
        await db('subscriptions')
            .where('id', subscription.id)
            .update({ 
                seats: newSeatCount,
                updated_at: new Date()
            });
        
        console.log('🔍 DEBUG: Inserting seat data:', seatData);
        const result = await db('seats').insert(seatData).returning('*');
        console.log('✅ DEBUG: Seat created successfully:', result);
        
        res.redirect('/dashboard?success=seat_added');
    } catch (error) {
        console.error('❌ Add seat error:', error);
        res.redirect('/dashboard?error=add_seat_failed');
    }
});

// Validate billing status
router.get('/dashboard/validate-billing', requireAuth, async (req, res) => {
    try {
        const user = req.user;
        
        // Get subscription from database
        const subscription = await db('subscriptions')
            .where('user_id', user.id)
            .where('status', 'active')
            .first();
        
        if (!subscription) {
            return res.json({ 
                error: 'No active subscription found',
                dbSubscription: null,
                lemonSqueezySubscription: null
            });
        }
        
        // Count seats in database
        const seats = await db('seats')
            .where('subscription_id', subscription.id)
            .where('status', '!=', 'revoked');
        
        let lemonSqueezyData = null;
        let billingStatus = 'unknown';
        
        // Get current status from Lemon Squeezy
        if (subscription.lemon_squeezy_subscription_id) {
            try {
                lemonSqueezyData = await lemonSqueezyService.getSubscription(subscription.lemon_squeezy_subscription_id);
                billingStatus = 'connected';
            } catch (error) {
                console.error('Failed to fetch Lemon Squeezy data:', error);
                billingStatus = 'api_error';
            }
        }
        
        const validation = {
            timestamp: new Date().toISOString(),
            billingStatus,
            database: {
                subscriptionId: subscription.id,
                lemonSqueezyId: subscription.lemon_squeezy_subscription_id,
                status: subscription.status,
                seats: subscription.seats,
                actualSeats: seats.length,
                plan: subscription.plan,
                pricePerSeat: subscription.price_per_seat
            },
            lemonSqueezy: lemonSqueezyData ? {
                id: lemonSqueezyData.id,
                status: lemonSqueezyData.attributes.status,
                // Check for subscription items to see quantity
                quantity: lemonSqueezyData.attributes.quantity || 'N/A',
                nextPayment: lemonSqueezyData.attributes.renews_at,
                createdAt: lemonSqueezyData.attributes.created_at
            } : null,
            seatsDetails: seats.map(seat => ({
                id: seat.id,
                email: seat.user_email,
                licenseKey: seat.license_key,
                status: seat.status,
                createdAt: seat.created_at
            })),
            validation: {
                seatsMatch: subscription.seats === seats.length,
                subscriptionActive: subscription.status === 'active',
                lemonSqueezyConnected: !!lemonSqueezyData
            }
        };
        
        res.json(validation);
    } catch (error) {
        console.error('❌ Billing validation error:', error);
        res.status(500).json({ error: 'Failed to validate billing', details: error.message });
    }
});

// Revoke seat
router.post('/dashboard/revoke-seat', requireAuth, async (req, res) => {
    try {
        const { seat_id } = req.body;
        const user = req.user;
        
        console.log('🔍 DEBUG: Revoking seat:', seat_id, 'for user:', user.id);
        
        // Verify seat belongs to user's subscription
        const seat = await db('seats')
            .join('subscriptions', 'seats.subscription_id', 'subscriptions.id')
            .where('seats.id', seat_id)
            .where('subscriptions.user_id', user.id)
            .select('seats.*', 'subscriptions.lemon_squeezy_subscription_id')
            .first();
        
        if (seat && seat.status !== 'revoked') {
            // Count active seats before revoking
            const currentSeats = await db('seats')
                .where('subscription_id', seat.subscription_id)
                .where('status', '!=', 'revoked')
                .count('* as count')
                .first();
            
            const currentSeatCount = parseInt(currentSeats.count);
            const newSeatCount = Math.max(1, currentSeatCount - 1); // Minimum 1 seat
            
            console.log('🔍 DEBUG: Current seats:', currentSeatCount, '→ New seats:', newSeatCount);
            
            // Update Lemon Squeezy subscription quantity first
            if (seat.lemon_squeezy_subscription_id && newSeatCount !== currentSeatCount) {
                console.log('💰 Reducing Lemon Squeezy subscription quantity...');
                try {
                    await lemonSqueezyService.updateSubscriptionQuantity(
                        seat.lemon_squeezy_subscription_id, 
                        newSeatCount
                    );
                    console.log('✅ Lemon Squeezy subscription reduced - billing will be adjusted');
                } catch (lemonSqueezyError) {
                    console.error('❌ Failed to update Lemon Squeezy subscription:', lemonSqueezyError);
                    return res.redirect('/dashboard?error=billing_update_failed');
                }
            }
            
            // Revoke the seat in our database
            await db('seats').where('id', seat_id).update({ status: 'revoked' });
            
            // Update our database seat count
            await db('subscriptions')
                .where('id', seat.subscription_id)
                .update({ 
                    seats: newSeatCount,
                    updated_at: new Date()
                });
            
            console.log('✅ DEBUG: Seat revoked successfully');
        }
        
        res.redirect('/dashboard?success=seat_revoked');
    } catch (error) {
        console.error('❌ Revoke seat error:', error);
        res.redirect('/dashboard?error=revoke_failed');
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
            await db('subscriptions').where('id', subscription.id).update({
                status: 'cancelled',
                cancelled_at: new Date()
            });
            
            // Revoke all seats
            await db('seats').where('subscription_id', subscription.id).update({
                status: 'revoked'
            });
        }
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.redirect('/dashboard?error=cancel_failed');
    }
});


// Payment success page
router.get('/payment/success', async (req, res) => {
    try {
        const { plan } = req.query;
        res.send(`
            <h1>🎉 Payment Successful!</h1>
            <p>Thank you for subscribing to the ${plan} plan!</p>
            <p>We're processing your subscription and you'll receive an email confirmation shortly.</p>
            <p><strong>What happens next:</strong></p>
            <ul>
                <li>✅ Your subscription is being activated</li>
                <li>📧 You'll receive email confirmation</li>
                <li>🔑 License keys will be available in your dashboard</li>
            </ul>
            <p><a href="/dashboard">Go to Dashboard →</a></p>
        `);
    } catch (error) {
        console.error('Payment success error:', error);
        res.send(`
            <h1>Payment Successful</h1>
            <p>Thank you for your subscription!</p>
            <p><a href="/dashboard">Go to Dashboard →</a></p>
        `);
    }
});

// Payment cancelled page
router.get('/payment/cancelled', (req, res) => {
    res.send(`
        <h1>Payment Cancelled</h1>
        <p>No worries! You can try again anytime.</p>
        <p><a href="/dashboard">← Back to Dashboard</a></p>
    `);
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
        
        // TODO: Verify webhook signature
        
        await lemonSqueezyService.processWebhookEvent(event, db);
        
        console.log('✅ Webhook processed successfully');
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook error:', error);
        console.error('Raw body type:', typeof req.body);
        console.error('Raw body:', req.body);
        res.status(400).send('Error processing webhook');
    }
});

module.exports = router; 