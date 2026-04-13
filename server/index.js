require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./config/db');
const socketHandler = require('./socketServer');
const { errorHandler, notFound } = require('./middlewares/errorMiddleware');
const { getAllowedOrigins, isOriginAllowed, getRequiredEnv } = require('./config/security');

// Routes
const authRoutes = require('./routes/auth');
const streamRoutes = require('./routes/streams');
const giftRoutes = require('./routes/gifts');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const livekitRoutes = require('./routes/livekit');
const messageRoutes = require('./routes/messages');
const userRoutes = require('./routes/users');

const app = express();
const allowedOrigins = getAllowedOrigins();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin, allowedOrigins)) return callback(null, true);
            return callback(new Error('CORS blocked for this origin'));
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
});

  // Middleware
  app.use(cors({
      origin: (origin, callback) => {
          if (isOriginAllowed(origin, allowedOrigins)) return callback(null, true);
          return callback(new Error('CORS blocked for this origin'));
      },
      credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.set('io', io);

// Serve client static files
app.use(express.static(path.join(__dirname, '..', 'client')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/streams', streamRoutes);
app.use('/api/gifts', giftRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/livekit', livekitRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users', userRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Public config for frontend
app.get('/api/config', (req, res) => {
    res.json({
        livekitUrl: process.env.LIVEKIT_URL || null
    });
});


// Catch-all: serve client SPA for any non-API route
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

// Initialize Socket.io handler
socketHandler(io);

// Initialize DB then start server
const PORT = process.env.PORT || 3000;
getRequiredEnv('JWT_SECRET');
initDB();

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.warn(`\n⚠️  Port ${PORT} is busy, trying ${parseInt(PORT) + 1}...`);
        setTimeout(() => {
            server.close();
            server.listen(parseInt(PORT) + 1);
        }, 1000);
    }
});

server.listen(PORT, () => {
    console.log(`\n🚀 TangoLive server running at http://localhost:${PORT}`);
    console.log(`📺 Admin panel: http://localhost:${PORT}/admin.html`);
});
