const { AccessToken } = require('livekit-server-sdk');
const jwt = require('jsonwebtoken');

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
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tangolivemysecertqaz123');
            user = { username: identity || `User_${decoded.id}`, id: decoded.id }; 
        } catch (e) {
            console.error('[LiveKit Auth] Soft auth failed:', e.message);
        }
    }

    // Use provided identity, or the logged-in username, or a random Guest-ID
    const user_identity = identity || (user ? user.username : `Guest_${Math.floor(Math.random() * 10000)}`);
    const user_name = name || (user ? user.username : user_identity);

    // Only let authenticated users publish (e.g. hosts)
    const publishAllowed = !!(req.body.canPublish === true && user);

    if (!room) {
        return res.status(400).json({ message: 'Room name is required' });
    }

    try {
        const at = new AccessToken(apiKey, apiSecret, {
            identity: user_identity,
            name: user_name,
            ttl: '2h',
        });
        at.addGrant({
            room,
            roomJoin: true,
            canPublish: publishAllowed,
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
