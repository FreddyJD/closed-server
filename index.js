const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { engine } = require('express-handlebars');
const db = require('./db');

// WebSocket and Deepgram for transcription
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const { WebSocketServer } = require("ws");

// Load environment variables
dotenv.config();

const config = require('./config');

const app = express();
const PORT = process.env.PORT || 4000;

// Handlebars helpers
const hbsHelpers = {
    formatDate: (date) => {
        return new Date(date).toLocaleDateString();
    },
    multiply: (a, b) => a * b,
    subtract: (a, b) => a - b,
    add: (a, b) => a + b,
    eq: (a, b) => a === b,
    gt: (a, b) => a > b,
    lt: (a, b) => a < b,
    gte: (a, b) => a >= b,
    lte: (a, b) => a <= b,
    and: (a, b) => a && b
};

// Configure Handlebars
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: __dirname + '/views/layouts/',
    helpers: hbsHelpers
}));
app.set('view engine', 'hbs');
app.set('views', __dirname + '/views');

// Middleware
app.use(cors());

// Force HTTPS redirect middleware
app.use((req, res, next) => {
    // Skip HTTPS redirect in development
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }
    
    // Check if request is secure (HTTPS)
    if (req.header('x-forwarded-proto') !== 'https') {
        res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
        next();
    }
});

// Static files
app.use(express.static('public'));

// Raw body parsing for webhooks (before JSON parsing)
app.use('/billing/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON parsing for all other routes
app.use(express.json());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Changed to 'none' for HTTPS redirects
        domain: process.env.NODE_ENV === 'production' ? '.tryclosed.com' : undefined // Explicit domain for production
    },
    name: 'sessionId',
    proxy: process.env.NODE_ENV === 'production' // Trust proxy in production
}));

// Import route modules
const authRoutes = require('./routes/auth');
const webRoutes = require('./routes/web');
const billingRoutes = require('./routes/billing');
const desktopRoutes = require('./routes/desktop');

// Use route modules
app.use('/', webRoutes);
app.use('/auth', authRoutes);
app.use('/billing', billingRoutes); 
app.use('/desktop', desktopRoutes);

// Add API health check endpoint
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            authentication: true, // Our custom auth system
            stripe: !!(config.stripe.secretKey && config.stripe.publishableKey),
            claude: !!config.claude.apiKey,
            deepgram: !!config.deepgram.apiKey,
            database: false
        }
    };
    
    try {
        await db.raw('SELECT 1');
        health.services.database = true;
    } catch (error) {
        health.services.database = false;
        health.database_error = error.message;
    }
    
    res.json(health);
});

// Add transcription status endpoint for compatibility
app.get('/status', (req, res) => {
    res.json({
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).send(`
        <h1>404 - Not Found</h1>
        <p>The page you're looking for doesn't exist.</p>
        <p><a href="/">← Go Home</a></p>
    `);
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).send(`
        <h1>500 - Server Error</h1>
        <p>Something went wrong on our end.</p>
        <p><a href="/">← Go Home</a></p>
    `);
});

// Create HTTP server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔧 API Health: http://localhost:${PORT}/health`);
    console.log(`🎤 Transcription WebSocket: ws://localhost:${PORT}`);
    console.log(`📊 Service Status:`);
    
    try {
        db.raw('SELECT 1').then(() => {
            console.log(`   - Database: ✅`);
        }).catch(() => {
            console.log(`   - Database: ❌`);
        });
    } catch (error) {
        console.log(`   - Database: ❌`);
    }
    
    console.log(`   - Authentication: ✅ (Custom)`);
    console.log(`   - Stripe: ${config.stripe.secretKey && config.stripe.publishableKey ? '✅' : '❌'}`);
    console.log(`   - Claude AI: ${config.claude.apiKey ? '✅' : '❌'}`);
    console.log(`   - Deepgram: ${config.deepgram.apiKey ? '✅' : '❌'}`);
    console.log(`\n📖 Setup Guide:`);
    console.log(`   1. Configure Stripe keys in .env`);
    console.log(`   2. Set up Claude API key for AI features`);
    console.log(`   3. Add Deepgram API key for transcription`);
    console.log(`   4. Run migrations: npm run migrate`);
});

// Create WebSocket server for transcription
const wss = new WebSocketServer({ server: app });

// Handle WebSocket connections for transcription
wss.on("connection", (ws, req) => {
    console.log("🎤 New transcription client connected");

    // Parse query parameters from the URL
    const baseUrl = process.env.NODE_ENV === 'production'
        ? `ws://localhost:${PORT}`
        : `ws://localhost:${PORT}`;
    const url = new URL(req.url, baseUrl);
    const language = url.searchParams.get('language');
    const enableSpeakerDetection = url.searchParams.get('enableSpeakerDetection') === 'true';
    const macUser = url.searchParams.get('macUser') === 'true';

    console.log(`🔧 Transcription config: language=${language}, speakers=${enableSpeakerDetection}, mac=${macUser}`);

    // Check if Deepgram is configured
    if (!config.deepgram.apiKey) {
        console.error('❌ Deepgram API key not configured');
        ws.send(JSON.stringify({
            type: "error",
            message: "Transcription service not configured"
        }));
        ws.close();
        return;
    }

    // Create Deepgram client for this connection
    const deepgram = createClient(config.deepgram.apiKey);

    // Create live transcription connection with parsed parameters
    let dgConnection;
    if (macUser) {
        dgConnection = deepgram.listen.live({
            model: "nova-2",
            diarize: enableSpeakerDetection || false,
            no_delay: true,
            language: "multi",
            encoding: "linear16",
            sample_rate: 48000,
            channels: 2
        });
    } else {
        console.log("🪟 Using nova-3 with Windows user");
        dgConnection = deepgram.listen.live({
            model: "nova-3",
            diarize: enableSpeakerDetection || false,
            no_delay: true,
            language: "multi",
        });
    }

    // Handle Deepgram events
    dgConnection.on(LiveTranscriptionEvents.Open, () => {
        console.log("🟢 Deepgram connection opened");

        dgConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
            // Send transcription back to the client with speaker information
            const transcript = data.channel.alternatives[0].transcript;
            const speaker = data.channel.alternatives[0].words?.[0]?.speaker;
            
            if (transcript && transcript.trim().length > 0) {
                ws.send(JSON.stringify({
                    type: "transcript",
                    text: transcript,
                    speaker: speaker
                }));
                console.log(`📝 Transcript: ${transcript} ${speaker ? `(Speaker ${speaker})` : ''}`);
            }
        });

        dgConnection.on(LiveTranscriptionEvents.Error, (err) => {
            console.error("❌ Deepgram error:", err);
            ws.send(JSON.stringify({
                type: "error",
                message: "Transcription error occurred"
            }));
        });
    });

    // Handle incoming audio data from client
    ws.on("message", (data) => {
        if (dgConnection) {
            dgConnection.send(data);
        }
    });

    // Handle client disconnect
    ws.on("close", () => {
        console.log("🔴 Transcription client disconnected");
        if (dgConnection) {
            dgConnection.finish();
        }
    });

    // Handle WebSocket errors
    ws.on("error", (error) => {
        console.error("❌ WebSocket error:", error);
        if (dgConnection) {
            dgConnection.finish();
        }
    });
});

module.exports = app; 