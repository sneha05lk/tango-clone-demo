try {
    require('dotenv').config({ path: 'server/.env' });
    console.log('dotenv loaded');
    const express = require('express');
    console.log('express loaded');
    const sqlite3 = require('sqlite3');
    console.log('sqlite3 loaded');
    const bcrypt = require('bcrypt');
    console.log('bcrypt loaded');
    const jwt = require('jsonwebtoken');
    console.log('jwt loaded');
    const livekit = require('livekit-server-sdk');
    console.log('livekit-server-sdk loaded');
    const socketio = require('socket.io');
    console.log('socket.io loaded');
    console.log('All dependencies loaded successfully!');
} catch (err) {
    console.error('Dependency load failed:', err.message);
    process.exit(1);
}
