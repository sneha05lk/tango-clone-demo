const { AccessToken } = require('livekit-server-sdk');

// POST /api/livekit/token
const getToken = async (req, res) => {
    const { room, identity, name } = req.body;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
        return res.status(500).json({ message: 'LiveKit credentials not configured in .env' });
    }

    // Use provided identity, or the logged-in username, or a random Guest-ID
    const user_identity = identity || (req.user ? req.user.username : `Guest_${Math.floor(Math.random() * 10000)}`);
    const user_name = name || (req.user ? req.user.username : user_identity);

    // Only let authenticated users publish (e.g. hosts)
    const publishAllowed = req.body.canPublish === true && req.user;

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
        res.status(500).json({ message: err.message });
    }
};

module.exports = { getToken };
