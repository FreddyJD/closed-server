const { lemonSqueezySetup, createCheckout } = require('@lemonsqueezy/lemonsqueezy.js');
const config = require('../config');

// Initialize Lemon Squeezy
if (config.lemonSqueezy.apiKey) {
    lemonSqueezySetup({
        apiKey: config.lemonSqueezy.apiKey,
        onError: (error) => console.error('Lemon Squeezy error:', error)
    });
}

// Check if Lemon Squeezy is properly configured
function isConfigured() {
    return !!(config.lemonSqueezy.apiKey && config.lemonSqueezy.storeId);
}

// Check if a specific plan is configured
function isPlanConfigured(plan) {
    return !!config.lemonSqueezy.plans[plan]?.variantId;
}

// Create checkout session for a plan
async function createCheckoutForPlan(plan, user) {
    if (!isConfigured()) {
        throw new Error('Lemon Squeezy not configured');
    }

    const planConfig = config.lemonSqueezy.plans[plan];
    
    if (!planConfig) {
        throw new Error(`Plan ${plan} does not exist in config`);
    }
    
    if (!planConfig.variantId) {
        throw new Error(`Plan ${plan} variantId not configured`);
    }

    // Correct API call format: createCheckout(storeId, variantId, options)
    const checkout = await createCheckout(
        config.lemonSqueezy.storeId,
        planConfig.variantId,
        {
            checkoutData: {
                email: user.email,
                name: `${user.first_name} ${user.last_name}`,
                custom: {
                    user_id: user.id,
                    plan: plan
                }
            },
            checkoutOptions: {
                embed: false,
                media: true,
                logo: true,
                desc: true,
                discount: true,
                dark: false,
                subscription_preview: true
            },
            productOptions: {
                name: `Battle Cards ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
                description: `AI-powered sales assistance - ${plan} plan`,
                redirect_url: `${process.env.BASE_URL || 'http://localhost:4000'}/payment/success?plan=${plan}`,
                receipt_button_text: "Go to Dashboard",
                receipt_link_url: `${process.env.BASE_URL || 'http://localhost:4000'}/dashboard`
            }
        }
    );
    
    return checkout;
}

// Get configuration error messages
function getConfigErrorMessage() {
    return `
        <h1>Payments Not Configured</h1>
        <p>Lemon Squeezy payment system is not configured yet.</p>
        <p>Please set up the following environment variables:</p>
        <ul>
            <li>LEMON_SQUEEZY_API_KEY</li>
            <li>LEMON_SQUEEZY_STORE_ID</li>
            <li>LEMON_SQUEEZY_BASIC_VARIANT_ID</li>
            <li>LEMON_SQUEEZY_PRO_VARIANT_ID</li>
        </ul>
        <p><a href="/dashboard">← Back to Dashboard</a></p>
    `;
}

function getPlanConfigErrorMessage(plan) {
    return `
        <h1>Plan Not Configured</h1>
        <p>The ${plan} plan is not configured yet.</p>
        <p>Please set LEMON_SQUEEZY_${plan.toUpperCase()}_VARIANT_ID environment variable.</p>
        <p><a href="/dashboard">← Back to Dashboard</a></p>
    `;
}

// Process webhook event
async function processWebhookEvent(event, db) {
    console.log('🪝 Lemon Squeezy webhook:', event.meta.event_name);
    
    const subscription = event.data.attributes;
    const customData = event.meta.custom_data || {};
    
    // Extract user ID from custom data
    console.log('🔍 User ID from webhook:', customData.user_id);
    
    switch (event.meta.event_name) {
        case 'subscription_created':
            console.log('📝 Creating new subscription...');
            
            if (customData.user_id) {
                // Insert new subscription
                await db('subscriptions').insert({
                    user_id: customData.user_id,
                    lemon_squeezy_subscription_id: event.data.id,
                    lemon_squeezy_customer_id: subscription.customer_id,
                    plan: customData.plan,
                    price_per_seat: config.lemonSqueezy.plans[customData.plan].price,
                    seats: 1,
                    status: subscription.status === 'on_trial' ? 'active' : subscription.status,
                    current_period_start: subscription.created_at,
                    current_period_end: subscription.renews_at || subscription.trial_ends_at
                });
                
                // Generate initial license key
                const { generateLicenseKey } = require('../utils/license');
                const licenseKey = generateLicenseKey();
                
                const [newSubscription] = await db('subscriptions')
                    .where('lemon_squeezy_subscription_id', event.data.id)
                    .select('id');
                
                if (newSubscription) {
                    await db('seats').insert({
                        subscription_id: newSubscription.id,
                        user_email: subscription.user_email,
                        license_key: licenseKey,
                        status: 'unused'
                    });
                }
                
                console.log('✅ Subscription created for user:', customData.user_id);
            }
            break;
            
        case 'subscription_updated':
            console.log('🔄 Updating subscription status...');
            
            if (customData.user_id) {
                // Map Lemon Squeezy statuses to our database statuses
                const dbStatus = subscription.status === 'on_trial' ? 'active' : subscription.status;
                
                await db('subscriptions')
                    .where('lemon_squeezy_subscription_id', event.data.id)
                    .update({
                        status: dbStatus,
                        current_period_start: subscription.created_at,
                        current_period_end: subscription.renews_at || subscription.trial_ends_at,
                        updated_at: new Date()
                    });
                    
                console.log('✅ Subscription updated to status:', dbStatus);
            }
            break;
            
        case 'subscription_cancelled':
            console.log('❌ Cancelling subscription...');
            await db('subscriptions')
                .where('lemon_squeezy_subscription_id', event.data.id)
                .update({
                    status: 'cancelled',
                    cancelled_at: new Date()
                });
                
            // Revoke all seats for this subscription
            const cancelledSub = await db('subscriptions')
                .where('lemon_squeezy_subscription_id', event.data.id)
                .first();
                
            if (cancelledSub) {
                await db('seats')
                    .where('subscription_id', cancelledSub.id)
                    .update({ status: 'revoked' });
            }
            
            console.log('✅ Subscription cancelled and seats revoked');
            break;
            
        case 'subscription_expired':
            console.log('⏰ Subscription expired...');
            await db('subscriptions')
                .where('lemon_squeezy_subscription_id', event.data.id)
                .update({
                    status: 'expired'
                });
                
            // Revoke all seats
            const expiredSub = await db('subscriptions')
                .where('lemon_squeezy_subscription_id', event.data.id)
                .first();
                
            if (expiredSub) {
                await db('seats')
                    .where('subscription_id', expiredSub.id)
                    .update({ status: 'revoked' });
            }
            
            console.log('✅ Subscription expired and seats revoked');
            break;
            
        case 'subscription_payment_success':
            console.log('💰 Payment successful...');
            await db('subscriptions')
                .where('lemon_squeezy_subscription_id', event.data.id)
                .update({
                    status: 'active',
                    current_period_start: subscription.created_at,
                    current_period_end: subscription.renews_at
                });
            console.log('✅ Subscription reactivated after successful payment');
            break;
            
        case 'subscription_payment_failed':
            console.log('💳 Payment failed...');
            await db('subscriptions')
                .where('lemon_squeezy_subscription_id', event.data.id)
                .update({
                    status: 'past_due'
                });
            console.log('⚠️ Subscription marked as past_due');
            break;
            
        default:
            console.log('ℹ️ Unhandled webhook event:', event.meta.event_name);
    }
}

/**
 * Get subscription details from Lemon Squeezy
 * @param {string} subscriptionId - Lemon Squeezy subscription ID
 * @returns {Promise<Object>} Subscription data
 */
async function getSubscription(subscriptionId) {
    if (!isConfigured()) {
        throw new Error('Lemon Squeezy not configured');
    }
    
    try {
        const response = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subscriptionId}`, {
            headers: {
                'Accept': 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
                'Authorization': `Bearer ${config.lemonSqueezy.apiKey}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Lemon Squeezy API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error('Error fetching subscription from Lemon Squeezy:', error);
        throw error;
    }
}

/**
 * Sync subscription status from Lemon Squeezy API
 * @param {string} subscriptionId - Lemon Squeezy subscription ID
 * @returns {Promise<Object>} Updated subscription data
 */
async function syncSubscriptionStatus(subscriptionId) {
    if (!isConfigured()) {
        throw new Error('Lemon Squeezy not configured');
    }
    
    try {
        // Get latest data from Lemon Squeezy
        const lemonSqueezySubscription = await getSubscription(subscriptionId);
        
        // Update our database with the latest status
        const db = require('../db');
        const updatedSubscription = await db('subscriptions')
            .where('lemon_squeezy_subscription_id', subscriptionId)
            .update({
                status: lemonSqueezySubscription.attributes.status,
                current_period_start: new Date(lemonSqueezySubscription.attributes.renews_at),
                current_period_end: new Date(lemonSqueezySubscription.attributes.ends_at),
                updated_at: new Date()
            })
            .returning('*')
            .first();
        
        console.log('✅ Synced subscription status:', {
            id: subscriptionId,
            status: lemonSqueezySubscription.attributes.status,
            renewsAt: lemonSqueezySubscription.attributes.renews_at
        });
        
        return updatedSubscription;
    } catch (error) {
        console.error('Error syncing subscription status:', error);
        throw error;
    }
}

/**
 * Update subscription quantity in Lemon Squeezy using Subscription Items API
 * @param {string} subscriptionId - Lemon Squeezy subscription ID
 * @param {number} newQuantity - New seat quantity
 * @returns {Promise<Object>} Updated subscription item data
 */
async function updateSubscriptionQuantity(subscriptionId, newQuantity) {
    if (!isConfigured()) {
        throw new Error('Lemon Squeezy not configured');
    }
    
    try {
        // First, get the subscription to find the subscription item ID
        console.log('🔍 Getting subscription details to find subscription item...');
        const subscriptionResponse = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subscriptionId}?include=subscription-items`, {
            headers: {
                'Accept': 'application/vnd.api+json',
                'Authorization': `Bearer ${config.lemonSqueezy.apiKey}`
            }
        });
        
        if (!subscriptionResponse.ok) {
            const errorText = await subscriptionResponse.text();
            throw new Error(`Lemon Squeezy API error getting subscription: ${subscriptionResponse.status} ${subscriptionResponse.statusText} - ${errorText}`);
        }
        
        const subscriptionData = await subscriptionResponse.json();
        
        // Find the subscription item ID from the included data or first_subscription_item
        let subscriptionItemId;
        
        if (subscriptionData.included && subscriptionData.included.length > 0) {
            // Look for subscription-items in included data
            const subscriptionItem = subscriptionData.included.find(item => item.type === 'subscription-items');
            subscriptionItemId = subscriptionItem?.id;
        } else if (subscriptionData.data.attributes.first_subscription_item) {
            // Fallback to first_subscription_item
            subscriptionItemId = subscriptionData.data.attributes.first_subscription_item.id;
        }
        
        if (!subscriptionItemId) {
            throw new Error('Could not find subscription item ID for quantity update');
        }
        
        console.log('🔍 Found subscription item ID:', subscriptionItemId);
        
        // Now update the subscription item quantity
        const response = await fetch(`https://api.lemonsqueezy.com/v1/subscription-items/${subscriptionItemId}`, {
            method: 'PATCH',
            headers: {
                'Accept': 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
                'Authorization': `Bearer ${config.lemonSqueezy.apiKey}`
            },
            body: JSON.stringify({
                data: {
                    type: 'subscription-items',
                    id: subscriptionItemId,
                    attributes: {
                        quantity: newQuantity,
                        invoice_immediately: true // Charge immediately for the change
                    }
                }
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Lemon Squeezy API error updating quantity: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('✅ Updated Lemon Squeezy subscription quantity:', {
            subscriptionId,
            subscriptionItemId,
            newQuantity,
            updated: data.data.attributes.quantity
        });
        
        return data.data;
    } catch (error) {
        console.error('Error updating subscription quantity:', error);
        throw error;
    }
}

/**
 * Check and sync all user subscriptions
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of updated subscriptions
 */
async function syncUserSubscriptions(userId) {
    if (!isConfigured()) {
        console.log('Lemon Squeezy not configured, skipping sync');
        return [];
    }
    
    try {
        const db = require('../db');
        
        // Get all user subscriptions that have Lemon Squeezy IDs
        const userSubscriptions = await db('subscriptions')
            .where('user_id', userId)
            .whereNotNull('lemon_squeezy_subscription_id')
            .where('status', '!=', 'cancelled');
        
        const syncedSubscriptions = [];
        
        for (const sub of userSubscriptions) {
            try {
                const synced = await syncSubscriptionStatus(sub.lemon_squeezy_subscription_id);
                syncedSubscriptions.push(synced);
            } catch (error) {
                console.error(`Failed to sync subscription ${sub.id}:`, error);
                // Continue with other subscriptions even if one fails
            }
        }
        
        return syncedSubscriptions;
    } catch (error) {
        console.error('Error syncing user subscriptions:', error);
        return [];
    }
}

module.exports = {
    isConfigured,
    isPlanConfigured,
    createCheckoutForPlan,
    getConfigErrorMessage,
    getPlanConfigErrorMessage,
    processWebhookEvent,
    getSubscription,
    syncSubscriptionStatus,
    syncUserSubscriptions,
    updateSubscriptionQuantity
}; 