const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'server', 'data', 'tangolive.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.all('SELECT id, username, email, role FROM users', [], (err, rows) => {
  if (err) {
    console.error('Error querying users:', err.message);
    process.exit(1);
  }
  
  console.log('\n=== Registered Users ===');
  console.table(rows);
  console.log('\nUse one of these emails to log back in.');
  db.close();
});
