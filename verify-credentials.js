const { RoomServiceClient } = require('livekit-server-sdk');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, 'server', '.env');
console.log('Reading .env from:', envPath);

if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file not found at', envPath);
    process.exit(1);
}

const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
const env = {};
envLines.forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
});

const url = env['LIVEKIT_URL'];
const apiKey = env['LIVEKIT_API_KEY'];
const apiSecret = env['LIVEKIT_API_SECRET'];

console.log('Values extracted:');
console.log('URL:', url);
console.log('API Key:', apiKey);
console.log('Secret length:', apiSecret ? apiSecret.length : 0);

if (!url || !apiKey || !apiSecret) {
    console.error('ERROR: Missing LiveKit variables in .env');
    process.exit(1);
}

async function test() {
    try {
        const svm = new RoomServiceClient(url, apiKey, apiSecret);
        console.log('Calling listRooms()...');
        const rooms = await svm.listRooms();
        console.log('SUCCESS! Connected to LiveKit.');
        console.log('Rooms found:', rooms.length);
    } catch (err) {
        console.error('CONNECTION FAILED:', err.message);
        if (err.stack) console.error(err.stack);
    }
}

test();
