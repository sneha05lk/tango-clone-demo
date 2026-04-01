const fs = require('fs');
fs.writeFileSync('debug2.log', 'Starting...\n');
process.on('uncaughtException', err => fs.appendFileSync('debug2.log', '\nUNCAUGHT: ' + String(err.stack || err)));
process.on('unhandledRejection', err => fs.appendFileSync('debug2.log', '\nUNHANDLED: ' + String(err.stack || err)));
process.on('exit', code => fs.appendFileSync('debug2.log', '\nEXITING WITH CODE: ' + code));
try {
  require('./server/index.js');
  fs.appendFileSync('debug2.log', '\nRequired safely.\n');
} catch (e) {
  fs.appendFileSync('debug2.log', '\nSYNC ERROR: ' + String(e.stack || e));
}
