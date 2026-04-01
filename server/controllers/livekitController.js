const { AccessToken } = require('livekit-server-sdk');

// POST /api/livekit/token
const getToken = async (req, res) => {
    const { room, identity, name } = req.body;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
        return res.status(500).json({ message: 'LiveKit credentials not configured in .env' });
    }

    try {
        const at = new AccessToken(apiKey, apiSecret, {
            identity: identity || req.user.username,
            name: name || req.user.username,
            ttl: '2h',
        });
        at.addGrant({
            room,
            roomJoin: true,
            canPublish: req.body.canPublish === true,
            canSubscribe: true,
        });
        const token = await at.toJwt();
        res.json({ token, room });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = { getToken };
