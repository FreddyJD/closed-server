const { WorkOS } = require('@workos-inc/node');
const config = require('../config');

const workos = new WorkOS(config.workos.apiKey);

// Check if WorkOS is properly configured
function isConfigured() {
    return !!(config.workos.clientId && config.workos.apiKey);
}

// Get authorization URL for WorkOS
function getAuthorizationUrl() {
    if (!isConfigured()) {
        throw new Error('WorkOS not configured');
    }
    
    return workos.userManagement.getAuthorizationUrl({
        provider: 'authkit',
        clientId: config.workos.clientId,
        redirectUri: config.workos.redirectUri
    });
}

// Authenticate user with authorization code
async function authenticateWithCode(code) {
    if (!isConfigured()) {
        throw new Error('WorkOS not configured');
    }
    
    return await workos.userManagement.authenticateWithCode({
        clientId: config.workos.clientId,
        code
    });
}

// Get configuration error message
function getConfigErrorMessage() {
    return `
        <h1>Authentication Not Configured</h1>
        <p>WorkOS authentication is not configured yet.</p>
        <p>Please set up the following environment variables:</p>
        <ul>
            <li>WORKOS_CLIENT_ID</li>
            <li>WORKOS_API_KEY</li>
            <li>WORKOS_REDIRECT_URI (optional, defaults to http://localhost:4000/auth/callback)</li>
        </ul>
        <p><a href="/login">← Back to Login</a></p>
    `;
}

module.exports = {
    isConfigured,
    getAuthorizationUrl,
    authenticateWithCode,
    getConfigErrorMessage
}; 