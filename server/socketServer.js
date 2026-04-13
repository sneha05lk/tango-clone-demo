const jwt = require('jsonwebtoken');
const { db } = require('./config/db');
const { getRequiredEnv } = require('./config/security');

// ─── ONLINE USERS (userId -> socketId) ───────────────────────────────────
const onlineUsers = {};
const rooms = {};

module.exports = (io) => {
    // Socket authentication middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token;
        if (token) {
            try {
                const decoded = jwt.verify(token, getRequiredEnv('JWT_SECRET'));
                const { data: user, error } = await db
                     .from('users')
                     .select('id, username, avatar, coin_balance, is_banned')
                     .eq('id', decoded.id)
                     .single();

                if (error || !user) {
                    socket.user = null;
                } else if (user.is_banned) {
                    return next(new Error('Your account has been banned.'));
                } else {
                    socket.user = user;
                }
                next();
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
            db.from('streams')
              .update({ viewer_count: viewerCount })
              .eq('livekit_room', roomName)
              .then(); // background

            // Notify room
            io.to(roomName).emit('viewer-count', { count: viewerCount });
            socket.to(roomName).emit('user-joined', { username });
            console.log(`${username} joined room: ${roomName}`);
        });

        // ── DIRECT MESSAGES ──────────────────────────────────────────────
        socket.on('direct-message', async ({ receiverId, message }) => {
            if (!socket.user) return;
            const msgData = {
                id: Date.now(),
                sender_id: socket.user.id,
                receiver_id: receiverId,
                message,
                created_at: new Date().toISOString()
            };

            // Save to DB
            const { data, error } = await db
                 .from('messages')
                 .insert([{ sender_id: socket.user.id, receiver_id: receiverId, message }])
                 .select('id')
                 .single();

            if (error) return;
            msgData.id = data.id;

            // Send to receiver if online
            const targetSocket = onlineUsers[receiverId];
            if (targetSocket) {
                io.to(targetSocket).emit('direct-message', msgData);
            }
            // Send back to sender for sync
            socket.emit('direct-message', msgData);
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
            db.from('streams')
              .update({ is_live: false })
              .eq('livekit_room', roomName)
              .then(); // background
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

        // ── GUEST / CO-STREAMING FLOW ─────────────────────────────────────
        socket.on('guest-invite', ({ userId, roomName }) => {
            if (!socket.user) return;
            const targetSocket = onlineUsers[userId];
            if (targetSocket) {
                io.to(targetSocket).emit('guest-invite-received', {
                    hostId: socket.user.id,
                    hostName: socket.user.username,
                    roomName
                });
            }
        });

        socket.on('guest-invite-response', ({ hostId, accepted, roomName }) => {
            if (!socket.user) return;
            const targetSocket = onlineUsers[hostId];
            if (targetSocket) {
                io.to(targetSocket).emit('guest-invite-reply', {
                    userId: socket.user.id,
                    username: socket.user.username,
                    accepted,
                    roomName
                });
            }
        });

        socket.on('end-guest-session', ({ roomName }) => {
            if (!socket.user) return;
            // Notify the room that a guest left
            io.to(roomName).emit('guest-left', { userId: socket.user.id });
        });

        socket.on('kick-guest', ({ userId, roomName }) => {
            if (!socket.user) return;
            const targetSocket = onlineUsers[userId];
            if (targetSocket) {
                io.to(targetSocket).emit('guest-kicked', { roomName });
            }
            // Also notify the room to remove the video
            io.to(roomName).emit('guest-left', { userId });
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
        db.from('streams')
          .update({ viewer_count: viewerCount })
          .eq('livekit_room', roomName)
          .then(); // run in background
          
        io.to(roomName).emit('viewer-count', { count: viewerCount });
    }
}
