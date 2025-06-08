const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { engine } = require('express-handlebars');

// WebSocket and Deepgram for transcription
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const { WebSocketServer } = require("ws");

// Load environment variables
dotenv.config();

const config = require('./config');

const app = express();
const port = config.port;

// Handlebars helpers
const hbsHelpers = {
    formatDate: (date) => {
        return new Date(date).toLocaleDateString();
    },
    multiply: (a, b) => a * b,
    eq: (a, b) => a === b,
    gt: (a, b) => a > b
};

// Configure Handlebars
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: __dirname + '/views/layouts/',
    partialsDir: __dirname + '/views/partials/',
    helpers: hbsHelpers
}));
app.set('view engine', 'hbs');
app.set('views', __dirname + '/views');

// Middleware
app.use(cors());

// Static files
app.use(express.static('public'));

// Raw body parsing for webhooks (before JSON parsing)
app.use('/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }));

// JSON parsing for all other routes
app.use(express.json());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true in production with HTTPS
}));

// Import route modules
const webRoutes = require('./routes/web');
const authRoutes = require('./routes/auth');
const billingRoutes = require('./routes/billing');
const desktopRoutes = require('./routes/desktop');
const enterpriseRoutes = require('./routes/enterprise');
const licenseRoutes = require('./routes/license');

// Use route modules
app.use('/', webRoutes);              // Web UI routes (/, /login, /dashboard)
app.use('/auth', authRoutes);         // Auth routes (/auth/workos, /auth/callback, /auth/logout)
app.use('/', billingRoutes);          // Billing routes (/subscribe, /dashboard/*, /webhooks/lemonsqueezy)
app.use('/api', desktopRoutes);       // Desktop API routes (/api/*)
app.use('/enterprise', enterpriseRoutes); // Enterprise routes (/enterprise/*)
app.use('/api/license', licenseRoutes); // License API routes (/api/license/*)

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
const server = app.listen(port, () => {
    console.log(`🚀 Battle Cards Server running on port ${port}`);
    console.log(`🌐 Web Interface: http://localhost:${port}`);
    console.log(`🔧 Health Check: http://localhost:${port}/api/health`);
    console.log(`🎤 Transcription WebSocket: ws://localhost:${port}`);
    console.log(`📊 Service Status:`);
    console.log(`   - Database: ${config.database ? '✅' : '❌'}`);
    console.log(`   - WorkOS: ${config.workos.clientId && config.workos.apiKey ? '✅' : '❌'}`);
    console.log(`   - Lemon Squeezy: ${config.lemonSqueezy.apiKey && config.lemonSqueezy.storeId ? '✅' : '❌'}`);
    console.log(`   - Claude AI: ${config.claude.apiKey ? '✅' : '❌'}`);
    console.log(`   - Deepgram: ${config.deepgram.apiKey ? '✅' : '❌'}`);
    console.log(`\n📖 Setup Guide: See SETUP.md for configuration instructions`);
});

// Create WebSocket server for transcription
const wss = new WebSocketServer({ server });

// Handle WebSocket connections for transcription
wss.on("connection", (ws, req) => {
    console.log("🎤 New transcription client connected");

    // Parse query parameters from the URL
    const baseUrl = process.env.NODE_ENV === 'production'
        ? `ws://localhost:${port}`
        : `ws://localhost:${port}`;
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