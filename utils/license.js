const db = require('../db');

// Generate a unique license key
function generateLicenseKey() {
    return 'BC-' + Math.random().toString(36).substr(2, 9).toUpperCase() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

// Create trial subscription for new users
async function createTrialSubscription(userId) {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7); // 7 days from now
    
    await db('users').where('id', userId).update({
        trial_ends_at: trialEndsAt,
        trial_used: true
    });
    
    return trialEndsAt;
}

module.exports = {
    generateLicenseKey,
    createTrialSubscription
}; 