const jwt = require('jsonwebtoken');
const { db } = require('./config/db');

// ─── ONLINE USERS (userId -> socketId) ───────────────────────────────────
const onlineUsers = {};
const rooms = {};

module.exports = (io) => {
    // Socket authentication middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tangolive_secret_key');
                db.get('SELECT id, username, avatar, coin_balance, is_banned FROM users WHERE id = ?', [decoded.id], (err, user) => {
                    if (err || !user) {
                        socket.user = null;
                    } else if (user.is_banned) {
                        return next(new Error('Your account has been banned.'));
                    } else {
                        socket.user = user;
                    }
                    next();
                });
            } catch {
                socket.user = null;
                next();
            }
        } else {
            socket.user = null; // guest
            next();
        }
    });

    io.on('connection', (socket) => {
        const username = socket.user ? socket.user.username : 'Guest';
        if (socket.user) {
            onlineUsers[socket.user.id] = socket.id;
        }
        console.log(`Socket connected: ${username} (${socket.id})`);

        // ── JOIN STREAM ROOM ──────────────────────────────────────────────
        socket.on('join-room', ({ roomName }) => {
            socket.join(roomName);
            if (!rooms[roomName]) rooms[roomName] = new Set();
            rooms[roomName].add(socket.id);

            const viewerCount = rooms[roomName].size;
            // Update DB viewer count
            db.run('UPDATE streams SET viewer_count = ? WHERE livekit_room = ?', [viewerCount, roomName]);
            // Notify room
            io.to(roomName).emit('viewer-count', { count: viewerCount });
            socket.to(roomName).emit('user-joined', { username });
            console.log(`${username} joined room: ${roomName}`);
        });

        // ── DIRECT MESSAGES ──────────────────────────────────────────────
        socket.on('direct-message', ({ receiverId, message }) => {
            if (!socket.user) return;
            const msgData = {
                id: Date.now(),
                sender_id: socket.user.id,
                receiver_id: receiverId,
                message,
                created_at: new Date().toISOString()
            };

            // Save to DB
            db.run(
                'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
                [socket.user.id, receiverId, message],
                function (err) {
                    if (err) return;
                    msgData.id = this.lastID;

                    // Send to receiver if online
                    const targetSocket = onlineUsers[receiverId];
                    if (targetSocket) {
                        io.to(targetSocket).emit('direct-message', msgData);
                    }
                    // Send back to sender for sync
                    socket.emit('direct-message', msgData);
                }
            );
        });

        // ── LEAVE STREAM ROOM ────────────────────────────────────────────
        socket.on('leave-room', ({ roomName }) => {
            handleLeave(socket, roomName, io);
        });

        // ── CHAT MESSAGE ─────────────────────────────────────────────────
        socket.on('chat-message', ({ roomName, message }) => {
            const msgData = {
                id: Date.now(),
                username: socket.user ? socket.user.username : 'Guest',
                avatar: socket.user ? socket.user.avatar : '',
                message,
                timestamp: new Date().toISOString(),
            };
            io.to(roomName).emit('chat-message', msgData);
        });

        // ── REACTION (floating hearts) ────────────────────────────────────
        socket.on('reaction', ({ roomName, emoji }) => {
            io.to(roomName).emit('reaction', {
                emoji: emoji || '❤️',
                username: socket.user ? socket.user.username : 'Guest',
            });
        });

        // ── GIFT NOTIFICATION ─────────────────────────────────────────────
        socket.on('gift-sent', ({ roomName, gift, receiverUsername }) => {
            io.to(roomName).emit('gift-animation', {
                sender: socket.user ? socket.user.username : 'Guest',
                receiver: receiverUsername,
                gift,
            });
        });

        // ── HOST ENDS STREAM ──────────────────────────────────────────────
        socket.on('end-stream', ({ roomName }) => {
            io.to(roomName).emit('stream-ended', { message: 'The host has ended the stream.' });
            // Mark as offline in DB
            db.run('UPDATE streams SET is_live = 0 WHERE livekit_room = ?', [roomName]);
        });

        // ── JOIN REQUEST FLOW (private/group) ─────────────────────────────
        socket.on('join-request', ({ roomName, streamId }) => {
            if (!socket.user) return;
            // Notify the host's socket (host is in the room)
            socket.to(roomName).emit('join-request-received', {
                userId: socket.user.id,
                username: socket.user.username,
                avatar: socket.user.avatar,
                streamId,
            });
        });

        socket.on('join-request-response', ({ userId, approved, roomName }) => {
            // Emit back to the requesting user via their socket
            const targetSocket = onlineUsers[userId];
            if (targetSocket) {
                io.to(targetSocket).emit(`join-response-${userId}`, { approved, roomName });
            }
        });


        // ── DISCONNECT ────────────────────────────────────────────────────
        socket.on('disconnecting', () => {
            if (socket.user) {
                delete onlineUsers[socket.user.id];
            }
            socket.rooms.forEach((roomName) => {
                if (roomName !== socket.id) {
                    handleLeave(socket, roomName, io);
                }
            });
        });

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${username} (${socket.id})`);
        });
    });
};

function handleLeave(socket, roomName, io) {
    socket.leave(roomName);
    if (rooms[roomName]) {
        rooms[roomName].delete(socket.id);
        const viewerCount = rooms[roomName].size;
        db.run('UPDATE streams SET viewer_count = ? WHERE livekit_room = ?', [viewerCount, roomName]);
        io.to(roomName).emit('viewer-count', { count: viewerCount });
    }
}
