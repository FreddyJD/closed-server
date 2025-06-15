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

# Stripe Configuration (https://stripe.com/docs)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Stripe Price IDs (create these in your Stripe dashboard)
STRIPE_BASIC_PRICE_ID=price_basic_plan_id
STRIPE_PRO_PRICE_ID=price_pro_plan_id

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
  
  // Stripe Configuration
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    basicPriceId: process.env.STRIPE_BASIC_PRICE_ID,
    proPriceId: process.env.STRIPE_PRO_PRICE_ID
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
  },

  // Database (for any direct database config if needed)
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'battlecards_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD
  }
}; 