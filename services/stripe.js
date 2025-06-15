const Stripe = require('stripe');
const config = require('../config');

const stripe = new Stripe(config.stripe?.secretKey || 'sk_test_...', {
    apiVersion: '2023-10-16'
});

// Check if Stripe is properly configured
function isConfigured() {
    return !!(config.stripe?.secretKey && config.stripe?.publishableKey);
}

// Get configuration error message
function getConfigErrorMessage() {
    return `
        <div style="padding: 20px; font-family: monospace;">
            <h2>⚠️ Stripe Not Configured</h2>
            <p>Please configure your Stripe keys in your environment:</p>
            <pre>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
            </pre>
            <p>Get your keys from: <a href="https://dashboard.stripe.com/apikeys" target="_blank">Stripe Dashboard</a></p>
        </div>
    `;
}

// Create a customer
async function createCustomer(email, name) {
    try {
        const customer = await stripe.customers.create({
            email: email,
            name: name
        });
        
        console.log('✅ Stripe customer created:', customer.id);
        return customer;
    } catch (error) {
        console.error('❌ Error creating Stripe customer:', error);
        throw error;
    }
}

// Create checkout session for trial (requires credit card, 7-day trial)
async function createTrialCheckoutSession(plan, tenant, user, successUrl, cancelUrl) {
    try {
        const priceId = plan === 'pro' ? config.stripe.proPriceId : config.stripe.basicPriceId;
        
        if (!priceId) {
            throw new Error(`Price ID not configured for ${plan} plan`);
        }

        const session = await stripe.checkout.sessions.create({
            customer: tenant.stripe_customer_id,
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{
                price: priceId,
                quantity: tenant.seats
            }],
            subscription_data: {
                trial_period_days: 7, // 7-day trial
                trial_settings: {
                    end_behavior: {
                        missing_payment_method: 'pause' // Pause if no payment method
                    }
                }
            },
            payment_method_collection: 'always', // Require credit card upfront
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: tenant.id,
            metadata: {
                tenant_id: tenant.id,
                user_id: user.id,
                plan: plan,
                is_trial: 'true'
            }
        });

        console.log('✅ Stripe trial checkout session created:', session.id);
        return session;
    } catch (error) {
        console.error('❌ Error creating trial checkout session:', error);
        throw error;
    }
}

// Create checkout session for subscription
async function createCheckoutSession(plan, tenant, user, successUrl, cancelUrl) {
    try {
        const priceId = plan === 'pro' ? config.stripe.proPriceId : config.stripe.basicPriceId;
        
        if (!priceId) {
            throw new Error(`Price ID not configured for ${plan} plan`);
        }

        const session = await stripe.checkout.sessions.create({
            customer: tenant.stripe_customer_id,
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{
                price: priceId,
                quantity: tenant.seats
            }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: tenant.id,
            metadata: {
                tenant_id: tenant.id,
                user_id: user.id,
                plan: plan
            }
        });

        console.log('✅ Stripe checkout session created:', session.id);
        return session;
    } catch (error) {
        console.error('❌ Error creating checkout session:', error);
        throw error;
    }
}

// Update subscription quantity (when adding/removing users)
async function updateSubscriptionQuantity(subscriptionId, newQuantity) {
    try {
        console.log('🔄 Updating subscription quantity to:', newQuantity);
        
        // Get current subscription details
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const currentQuantity = subscription.items.data[0].quantity;
        
        if (currentQuantity === newQuantity) {
            console.log('📊 Quantity unchanged, skipping update');
            return subscription;
        }
        
        const isIncrease = newQuantity > currentQuantity;
        console.log(`${isIncrease ? '📈' : '📉'} ${isIncrease ? 'Increasing' : 'Decreasing'} seats: ${currentQuantity} → ${newQuantity}`);
        
        // Different proration behavior based on increase/decrease
        const prorationBehavior = isIncrease ? 'always_invoice' : 'create_prorations';
        
        const updated = await stripe.subscriptions.update(subscriptionId, {
            items: [{
                id: subscription.items.data[0].id,
                quantity: newQuantity
            }],
            proration_behavior: prorationBehavior,
            // For increases, invoice immediately
            // For decreases, create credit that applies to next invoice
            ...(isIncrease && { 
                billing_cycle_anchor: 'unchanged' // Keep current billing cycle
            })
        });

        if (isIncrease) {
            console.log('💳 User will be charged immediately for additional seats');
        } else {
            console.log('💰 User will receive prorated credit on next invoice');
        }
        
        console.log('✅ Stripe subscription updated successfully');
        return updated;
    } catch (error) {
        console.error('❌ Error updating subscription:', error);
        throw new Error(`Failed to update subscription: ${error.message}`);
    }
}

// Get subscription details
async function getSubscription(subscriptionId) {
    try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['latest_invoice', 'items.data.price']
        });
        return subscription;
    } catch (error) {
        console.error('❌ Error retrieving subscription:', error);
        throw error;
    }
}

// Get upcoming invoice preview
async function getUpcomingInvoice(customerId) {
    try {
        const invoice = await stripe.invoices.upcoming({
            customer: customerId
        });
        return invoice;
    } catch (error) {
        console.error('❌ Error retrieving upcoming invoice:', error);
        throw error;
    }
}

// Create Stripe billing portal session
async function createBillingPortalSession(customerId, returnUrl) {
    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl
        });
        
        console.log('✅ Billing portal session created:', session.id);
        return session;
    } catch (error) {
        console.error('❌ Error creating billing portal session:', error);
        throw error;
    }
}

// Cancel subscription
async function cancelSubscription(subscriptionId) {
    try {
        const subscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true
        });

        console.log('✅ Stripe subscription will cancel at period end:', subscription.id);
        return subscription;
    } catch (error) {
        console.error('❌ Error canceling subscription:', error);
        throw error;
    }
}

// Process webhook events
async function processWebhookEvent(event, db) {
    console.log('🔔 Processing Stripe webhook:', event.type);

    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(event.data.object, db);
            break;
            
        case 'invoice.payment_succeeded':
            await handlePaymentSucceeded(event.data.object, db);
            break;
            
        case 'invoice.payment_failed':
            await handlePaymentFailed(event.data.object, db);
            break;
            
        case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event.data.object, db);
            break;
            
        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object, db);
            break;
            
        default:
            console.log('📋 Unhandled webhook event:', event.type);
    }
}

// Handle successful checkout
async function handleCheckoutCompleted(session, db) {
    const tenantId = session.client_reference_id;
    const subscriptionId = session.subscription;
    
    if (tenantId && subscriptionId) {
        await db('tenants')
            .where('id', tenantId)
            .update({
                stripe_subscription_id: subscriptionId,
                status: 'active',
                updated_at: new Date()
            });
            
        console.log('✅ Tenant subscription activated:', tenantId);
    }
}

// Handle successful payment
async function handlePaymentSucceeded(invoice, db) {
    const subscriptionId = invoice.subscription;
    
    if (subscriptionId) {
        await db('tenants')
            .where('stripe_subscription_id', subscriptionId)
            .update({
                status: 'active',
                updated_at: new Date()
            });
            
        console.log('✅ Tenant payment succeeded:', subscriptionId);
    }
}

// Handle failed payment
async function handlePaymentFailed(invoice, db) {
    const subscriptionId = invoice.subscription;
    
    if (subscriptionId) {
        await db('tenants')
            .where('stripe_subscription_id', subscriptionId)
            .update({
                status: 'past_due',
                updated_at: new Date()
            });
            
        console.log('❌ Tenant payment failed:', subscriptionId);
    }
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription, db) {
    await db('tenants')
        .where('stripe_subscription_id', subscription.id)
        .update({
            status: subscription.status,
            seats: subscription.items.data[0]?.quantity || 1,
            updated_at: new Date()
        });
        
    console.log('✅ Tenant subscription updated:', subscription.id);
}

// Handle subscription deletion
async function handleSubscriptionDeleted(subscription, db) {
    await db('tenants')
        .where('stripe_subscription_id', subscription.id)
        .update({
            status: 'cancelled',
            updated_at: new Date()
        });
        
    // Suspend all users in this tenant
    const tenant = await db('tenants')
        .where('stripe_subscription_id', subscription.id)
        .first();
        
    if (tenant) {
        await db('users')
            .where('tenant_id', tenant.id)
            .update({
                status: 'suspended',
                updated_at: new Date()
            });
    }
        
    console.log('❌ Tenant subscription cancelled:', subscription.id);
}

module.exports = {
    isConfigured,
    getConfigErrorMessage,
    createCustomer,
    createTrialCheckoutSession,
    createCheckoutSession,
    updateSubscriptionQuantity,
    getSubscription,
    getUpcomingInvoice,
    createBillingPortalSession,
    cancelSubscription,
    processWebhookEvent
}; 