# Battle Cards Web Application

AI-powered sales assistance tool with desktop app licensing and subscription management.

## Features

- **Web Dashboard**: Subscription and seat management
- **WorkOS Authentication**: Secure user authentication
- **Lemon Squeezy Payments**: Subscription billing with 7-day free trials
- **Per-Seat Licensing**: Manage licenses for team members
- **Desktop App Integration**: License validation for desktop clients
- **AI-Powered Cards**: Real-time sales assistance during calls

## Architecture

- **Frontend**: Handlebars templates (simple HTML, no CSS framework)
- **Backend**: Express.js with PostgreSQL
- **Authentication**: WorkOS
- **Payments**: Lemon Squeezy
- **Database**: PostgreSQL with Knex.js migrations
- **AI**: Claude (Anthropic) for battle card generation

## Setup

### 1. Environment Variables

Copy the configuration template and set up your environment variables:

```bash
# Copy the template
cp config.template.js .env

# Edit .env with your actual values
```

Required environment variables:
```bash
# Database
DATABASE_URL=postgres://username:password@host:port/database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=battlecards_dev
DB_USER=postgres
DB_PASSWORD=password

# WorkOS (https://workos.com/docs)
WORKOS_CLIENT_ID=your_workos_client_id
WORKOS_API_KEY=your_workos_api_key
WORKOS_REDIRECT_URI=http://localhost:4000/auth/callback

# Lemon Squeezy (https://docs.lemonsqueezy.com/api)
LEMON_SQUEEZY_API_KEY=your_api_key
LEMON_SQUEEZY_STORE_ID=your_store_id
LEMON_SQUEEZY_WEBHOOK_SECRET=your_webhook_secret
LEMON_SQUEEZY_BASIC_VARIANT_ID=basic_plan_variant_id
LEMON_SQUEEZY_PRO_VARIANT_ID=pro_plan_variant_id

# Claude AI
CLAUDE_API_KEY=your_claude_api_key

# Application
NODE_ENV=development
PORT=4000
SESSION_SECRET=your_session_secret
```

### 2. Database Setup

```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Check migration status
npm run migrate:status
```

### 3. Service Configuration

#### WorkOS Setup
1. Create a WorkOS account at https://workos.com
2. Create a new application
3. Set redirect URI to `http://localhost:4000/auth/callback`
4. Copy Client ID and API Key to your .env file

#### Lemon Squeezy Setup
1. Create a Lemon Squeezy account at https://lemonsqueezy.com
2. Create your store and products:
   - Basic Plan: $5/month per seat
   - Pro Plan: $25/month per seat
3. Set up webhook endpoint: `https://yourdomain.com/webhooks/lemonsqueezy`
4. Copy API keys and variant IDs to your .env file

### 4. Run the Application

```bash
# Development
npm run dev

# Production
npm start
```

The application will be available at http://localhost:4000

## API Routes

### Web Routes
- `GET /` - Marketing homepage
- `GET /login` - Login page
- `GET /dashboard` - User dashboard (requires auth)
- `GET /subscribe?plan=basic|pro` - Subscribe to plan (requires auth)
- `POST /auth/login` - WorkOS authentication
- `GET /auth/callback` - WorkOS callback
- `GET /auth/logout` - Logout

### Desktop App API
- `POST /api/license/validate` - Validate license key for desktop app
- `POST /api/cards/analyze` - Analyze transcription for AI cards
- `POST /api/cards/manual-generate` - Generate manual cards
- `POST /api/cards/reset` - Reset session state

### Webhooks
- `POST /webhooks/lemonsqueezy` - Lemon Squeezy webhook handler

## Database Schema

### Users
- User accounts with WorkOS integration
- Trial tracking (7-day free trial)
- Basic profile information

### Subscriptions
- Lemon Squeezy subscription management
- Plan tracking (basic/pro)
- Per-seat pricing
- Status management (active, cancelled, etc.)

### Seats
- License key generation for desktop app
- Seat assignment to team members
- Usage tracking and revocation

## Pricing

- **Basic Plan**: $5 per seat/month
- **Pro Plan**: $25 per seat/month (same features for now)
- **Free Trial**: 7 days, no credit card required

## Deployment

### Heroku Deployment

1. Create Heroku app:
```bash
heroku create your-app-name
```

2. Add PostgreSQL addon:
```bash
heroku addons:create heroku-postgresql:mini
```

3. Set environment variables:
```bash
heroku config:set WORKOS_CLIENT_ID=your_client_id
heroku config:set WORKOS_API_KEY=your_api_key
# ... set all other env vars
```

4. Deploy:
```bash
git push heroku main
```

5. Run migrations:
```bash
heroku run npm run migrate
```

## Development

### Adding New Features

1. **Database Changes**: Create new migrations with `npx knex migrate:make migration_name`
2. **Routes**: Add routes to `index.js`
3. **Templates**: Add Handlebars templates to `views/`
4. **Authentication**: Use `requireAuth` middleware for protected routes

### Testing License Validation

The desktop app should call `/api/license/validate` with:
```json
{
  "license_key": "BC-XXXXXXXXX-XXXXXXXXX",
  "machine_id": "unique_machine_identifier"
}
```

Response:
```json
{
  "success": true,
  "license": {
    "valid": true,
    "plan": "basic",
    "status": "active",
    "user_email": "user@example.com"
  }
}
```

## Support

For questions or issues, please create an issue in the repository. 