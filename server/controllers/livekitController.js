const { AccessToken } = require('livekit-server-sdk');
const jwt = require('jsonwebtoken');
const { getRequiredEnv } = require('../config/security');
const { db } = require('../config/db');

// POST /api/livekit/token
const getToken = async (req, res) => {
    const { room, identity, name } = req.body;
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

    if (!apiKey || !apiSecret) {
        return res.status(500).json({ message: 'LiveKit credentials not configured in .env' });
    }

    // Manual user extraction (since route is not protected to allow guests)
    let user = req.user;
    if (!user && req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, getRequiredEnv('JWT_SECRET'));
            user = { username: identity || `User_${decoded.id}`, id: decoded.id }; 
        } catch (e) {
            console.error('[LiveKit Auth] Soft auth failed:', e.message);
        }
    }

    // Use provided identity, or the logged-in username, or a random Guest-ID
    const user_identity = identity || (user ? user.username : `Guest_${Math.floor(Math.random() * 10000)}`);
    const user_name = name || (user ? user.username : user_identity);

    if (!room) {
        return res.status(400).json({ message: 'Room name is required' });
    }

    try {
        let stream = null;
        let isHost = false;
        let isApproved = false;

        const { data: liveStream } = await db
            .from('streams')
            .select('id, host_id, type')
            .eq('livekit_room', room)
            .eq('is_live', true)
            .maybeSingle();

        stream = liveStream || null;
        if (stream && user) {
            isHost = Number(stream.host_id) === Number(user.id);
            if (!isHost) {
                const { data: approvedRequest } = await db
                    .from('stream_requests')
                    .select('id')
                    .eq('stream_id', stream.id)
                    .eq('user_id', user.id)
                    .eq('status', 'approved')
                    .maybeSingle();
                isApproved = !!approvedRequest;
            }
        }

        if (stream && (stream.type === 'private' || stream.type === 'group')) {
            if (!user) {
                return res.status(403).json({ message: 'Login required for this stream type' });
            }
            if (!isHost && !isApproved) {
                return res.status(403).json({ message: 'Not authorized for this stream' });
            }
        }

        // Default: authenticated users may publish only when explicitly requested.
        // For protected stream types, publishing requires host ownership or approved membership.
        let publishAllowed = !!(req.body.canPublish === true && user);
        if (publishAllowed && stream) {
            if (stream.type === 'private') {
                publishAllowed = isHost;
            } else if (stream.type === 'group') {
                publishAllowed = isHost || isApproved;
            }
        }

        const at = new AccessToken(apiKey, apiSecret, {
            identity: user_identity,
            name: user_name,
            ttl: '2h',
        });
        at.addGrant({
            room,
            roomJoin: true,
            canPublish: publishAllowed,
            canPublishData: publishAllowed,
            canSubscribe: true,
        });
        const token = await at.toJwt();
        res.json({ token, room });
    } catch (err) {
        console.error('[LiveKit Token Error]:', err);
        res.status(500).json({ message: 'Failed to generate access token' });
    }
};

module.exports = { getToken };
