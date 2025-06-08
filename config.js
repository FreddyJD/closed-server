const dotenv = require('dotenv');
dotenv.config();

// Environment Variables Template
// Copy this to your .env file or set as environment variables

/*
# Database Configuration
DATABASE_URL=postgres://username:password@localhost:5432/battlecards_production
DB_HOST=localhost
DB_PORT=5432
DB_NAME=battlecards_dev
DB_USER=postgres
DB_PASSWORD=password

# WorkOS Configuration (https://workos.com/docs)
WORKOS_CLIENT_ID=your_workos_client_id_here
WORKOS_API_KEY=your_workos_api_key_here
WORKOS_REDIRECT_URI=http://localhost:4000/auth/callback

# Lemon Squeezy Configuration (https://docs.lemonsqueezy.com/api)
LEMON_SQUEEZY_API_KEY=your_lemon_squeezy_api_key_here
LEMON_SQUEEZY_STORE_ID=your_store_id_here
LEMON_SQUEEZY_WEBHOOK_SECRET=your_webhook_secret_here

# Product/Variant IDs for Lemon Squeezy
LEMON_SQUEEZY_BASIC_VARIANT_ID=your_basic_plan_variant_id
LEMON_SQUEEZY_PRO_VARIANT_ID=your_pro_plan_variant_id

# Claude AI Configuration
CLAUDE_API_KEY=your_claude_api_key_here

# Deepgram Configuration (for voice transcription)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Application Configuration
NODE_ENV=development
PORT=4000
SESSION_SECRET=your_session_secret_here
*/

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // WorkOS
  workos: {
    clientId: process.env.WORKOS_CLIENT_ID,
    apiKey: process.env.WORKOS_API_KEY,
    redirectUri: process.env.WORKOS_REDIRECT_URI || 'http://localhost:4000/auth/callback'
  },
  
  // Lemon Squeezy
  lemonSqueezy: {
    apiKey: process.env.LEMON_SQUEEZY_API_KEY,
    storeId: process.env.LEMON_SQUEEZY_STORE_ID,
    webhookSecret: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
    plans: {
      "basic": {
        variantId: process.env.LEMON_SQUEEZY_BASIC_VARIANT_ID,
        price: 18.00,
        name: "Starter"
      },
      "pro": {
        variantId: process.env.LEMON_SQUEEZY_PRO_VARIANT_ID,
        price: 32.00,
        name: "Professional"
      }
    }
  },
  
  // Claude AI
  claude: {
    apiKey: process.env.CLAUDE_API_KEY
  },

  // Deepgram (Voice Transcription)
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY
  },
  
  // Session
  session: {
    secret: process.env.SESSION_SECRET || 'battlecards-session-secret-change-in-production'
  }
}; 