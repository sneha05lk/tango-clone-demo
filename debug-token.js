const { AccessToken } = require('livekit-server-sdk');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: './server/.env' });

const apiKey = process.env.LIVEKIT_API_KEY?.trim();
const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
const url = process.env.LIVEKIT_URL?.trim();

if (!apiKey || !apiSecret) {
    console.error('Missing credentials');
    process.exit(1);
}

const at = new AccessToken(apiKey, apiSecret, {
    identity: 'test_user',
    name: 'Test Artist',
    ttl: '2h',
});

at.addGrant({
    room: 'test_room',
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
});

async function run() {
    try {
        const token = await at.toJwt();
        console.log('Token generated successfully.');
        console.log('Token (start):', token.substring(0, 20) + '...');
        
        const decoded = jwt.decode(token, { complete: true });
        console.log('Decoded Payload:');
        console.log(JSON.stringify(decoded.payload, null, 2));
        
        console.log('\nVerifying signature locally with the secret...');
        try {
            jwt.verify(token, apiSecret);
            console.log('✅ Signature valid locally!');
        } catch (e) {
            console.error('❌ Signature INVALID locally:', e.message);
        }

        console.log('\nComparing Key in Token to Key in .env:');
        console.log('API Key from .env:', apiKey);
        console.log('API Key from Token (iss):', decoded.payload.iss);
        
        if (apiKey !== decoded.payload.iss) {
            console.error('❌ API KEY MISMATCH!');
        } else {
            console.log('✅ API Keys match.');
        }

    } catch (err) {
        console.error('Failed to generate token:', err);
    }
}

run();
