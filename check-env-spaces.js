const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, 'server', '.env');
const content = fs.readFileSync(envPath, 'utf8');
console.log('RAW CONTENT BEGIN');
console.log(content.split('\n').map(line => `|${line}|`).join('\n'));
console.log('RAW CONTENT END');

require('dotenv').config({ path: envPath });

console.log('Values from process.env:');
console.log(`URL: "${process.env.LIVEKIT_URL}"`);
console.log(`KEY: "${process.env.LIVEKIT_API_KEY}"`);
console.log(`SECRET: "${process.env.LIVEKIT_API_SECRET}"`);
