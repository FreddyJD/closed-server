const express = require('express');
const router = express.Router();
const db = require('../db');


// Validate license endpoint
router.post('/validate', async (req, res) => {
    try {
        const { licenseKey, machineId } = req.body;
        
        console.log('🔑 License validation request:', { licenseKey, machineId });
        
        if (!licenseKey || !machineId) {
            console.log('💥💥💥 VALIDATION FAILED! 💥💥💥');
            console.log('   licenseKey falsy:', !licenseKey, '(value:', licenseKey, ')');
            console.log('   machineId falsy:', !machineId, '(value:', machineId, ')');
            console.log('   Returning 400 error...');
            return res.status(400).json({
                success: false,
                error: 'License key and machine ID are required'
            });
        }

        // Find the seat with this license key
        const seat = await db('seats')
            .join('subscriptions', 'seats.subscription_id', 'subscriptions.id')
            .where('seats.license_key', licenseKey)
            .where('seats.status', '!=', 'revoked')
            .where('subscriptions.status', 'active')
            .select(
                'seats.*',
                'subscriptions.user_id',
                'subscriptions.plan',
                'subscriptions.status as subscription_status'
            )
            .first();

        if (!seat) {
            console.log('❌ License not found or invalid');
            return res.status(404).json({
                success: false,
                error: 'Invalid license key or license has been revoked'
            });
        }

        // Check if license is already activated on a different machine
        if (seat.machine_identifier && seat.machine_identifier !== machineId) {
            console.log('❌ License already activated on different machine');
            return res.status(409).json({
                success: false,
                error: 'License key is already activated on another device'
            });
        }

        // Activate or update the license
        const updateData = {
            machine_identifier: machineId,
            last_used_at: new Date(),
            updated_at: new Date()
        };

        // If not yet activated, mark as active
        if (seat.status === 'unused') {
            updateData.status = 'active';
            updateData.activated_at = new Date();
        }

        await db('seats')
            .where('id', seat.id)
            .update(updateData);

        console.log('✅ License validated and activated');

        res.json({
            success: true,
            data: {
                licenseKey: seat.license_key,
                status: updateData.status || seat.status,
                plan: seat.plan,
                userEmail: seat.user_email,
                activatedAt: updateData.activated_at || seat.activated_at
            }
        });

    } catch (error) {
        console.error('❌ License validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during license validation'
        });
    }
});
// Get license status endpoint (for periodic checks)
router.get('/status/:licenseKey', async (req, res) => {
    try {
        const { licenseKey } = req.params;
        const { machineId } = req.query;

        console.log('🔍 License status check:', { licenseKey, machineId });

        if (!licenseKey || !machineId) {
            return res.status(400).json({
                success: false,
                error: 'License key and machine ID are required'
            });
        }

        const seat = await db('seats')
            .join('subscriptions', 'seats.subscription_id', 'subscriptions.id')
            .where('seats.license_key', licenseKey)
            .where('seats.machine_identifier', machineId)
            .select(
                'seats.*',
                'subscriptions.user_id',
                'subscriptions.plan',
                'subscriptions.status as subscription_status'
            )
            .first();

        if (!seat) {
            console.log('❌ License not found or not activated on this machine');
            return res.status(404).json({
                success: false,
                error: 'License not found or not activated on this device'
            });
        }

        // Check if license/subscription is still active
        if (seat.status === 'revoked' || seat.subscription_status !== 'active') {
            console.log('❌ License revoked or subscription inactive');
            return res.status(403).json({
                success: false,
                error: 'License has been revoked or subscription is inactive'
            });
        }

        // Update last used timestamp
        await db('seats')
            .where('id', seat.id)
            .update({
                last_used_at: new Date(),
                updated_at: new Date()
            });

        console.log('✅ License status valid');

        res.json({
            success: true,
            data: {
                licenseKey: seat.license_key,
                status: seat.status,
                plan: seat.plan,
                userEmail: seat.user_email,
                activatedAt: seat.activated_at,
                lastUsedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ License status check error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during license status check'
        });
    }
});

// Deactivate license endpoint (for when user wants to move to different machine)
router.post('/deactivate', async (req, res) => {
    try {
        const { licenseKey, machineId } = req.body;

        console.log('🔓 License deactivation request:', { licenseKey, machineId });

        if (!licenseKey || !machineId) {
            return res.status(400).json({
                success: false,
                error: 'License key and machine ID are required'
            });
        }

        const seat = await db('seats')
            .where('license_key', licenseKey)
            .where('machine_identifier', machineId)
            .first();

        if (!seat) {
            return res.status(404).json({
                success: false,
                error: 'License not found on this device'
            });
        }

        // Reset machine identifier to allow activation on another device
        await db('seats')
            .where('id', seat.id)
            .update({
                machine_identifier: null,
                status: 'unused',
                updated_at: new Date()
            });

        console.log('✅ License deactivated');

        res.json({
            success: true,
            message: 'License deactivated successfully'
        });

    } catch (error) {
        console.error('❌ License deactivation error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during license deactivation'
        });
    }
});

// User self-reset endpoint (for when they want to move to a new machine)
router.post('/reset', async (req, res) => {
    console.log('🔄 USER SELF-RESET ENDPOINT HIT!');
    
    try {
        const { licenseKey } = req.body;

        console.log('🔄 User license reset request:', { licenseKey });

        if (!licenseKey) {
            return res.status(400).json({
                success: false,
                error: 'License key is required'
            });
        }

        // Find the seat - don't check machine_identifier for self-reset
        const seat = await db('seats')
            .join('subscriptions', 'seats.subscription_id', 'subscriptions.id')
            .where('seats.license_key', licenseKey)
            .where('subscriptions.status', 'active') // Must have active subscription
            .select(
                'seats.*',
                'subscriptions.user_id',
                'subscriptions.plan',
                'subscriptions.status as subscription_status'
            )
            .first();

        if (!seat) {
            console.log('❌ License not found or subscription inactive');
            return res.status(404).json({
                success: false,
                error: 'License not found or subscription is inactive'
            });
        }

        // Reset license to unused state (user can reassign it)
        await db('seats')
            .where('id', seat.id)
            .update({
                machine_identifier: null,
                status: 'unused',
                activated_at: null,
                last_used_at: null,
                updated_at: new Date()
            });

        console.log('✅ User license reset successful - can now be reassigned');

        res.json({
            success: true,
            message: 'License reset successfully! You can now activate it on any machine.',
            data: {
                licenseKey: seat.license_key,
                status: 'unused',
                plan: seat.plan,
                userEmail: seat.user_email
            }
        });

    } catch (error) {
        console.error('❌ User license reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during license reset'
        });
    }
});

// Admin endpoint to reset/reassign any license (for dashboard use)
router.post('/admin/reset', async (req, res) => {
    try {
        const { licenseKey } = req.body;

        console.log('🔧 Admin license reset request:', { licenseKey });

        if (!licenseKey) {
            return res.status(400).json({
                success: false,
                error: 'License key is required'
            });
        }

        const seat = await db('seats')
            .where('license_key', licenseKey)
            .first();

        if (!seat) {
            return res.status(404).json({
                success: false,
                error: 'License not found'
            });
        }

        // Reset license to unused state (reassignable)
        await db('seats')
            .where('id', seat.id)
            .update({
                machine_identifier: null,
                status: 'unused',
                activated_at: null,
                last_used_at: null,
                updated_at: new Date()
            });

        console.log('✅ Admin license reset successful');

        res.json({
            success: true,
            message: 'License reset successfully - can now be assigned to any machine'
        });

    } catch (error) {
        console.error('❌ Admin license reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during license reset'
        });
    }
});

module.exports = router; 