const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tangolive.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('SQLite database connected.');
  }
});

// Enable WAL mode for better concurrency
db.run('PRAGMA journal_mode=WAL');
db.run('PRAGMA foreign_keys = ON');

const initDB = () => {
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      coin_balance INTEGER DEFAULT 1000,
      role TEXT DEFAULT 'user',
      avatar TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Streams table
    db.run(`CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      type TEXT DEFAULT 'public',
      host_id INTEGER NOT NULL,
      is_live INTEGER DEFAULT 0,
      viewer_count INTEGER DEFAULT 0,
      livekit_room TEXT,
      thumbnail TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(host_id) REFERENCES users(id)
    )`);

    // Gifts catalog table
    db.run(`CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      coin_cost INTEGER NOT NULL
    )`);

    // Transactions table
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER,
      receiver_id INTEGER,
      gift_id INTEGER,
      stream_id INTEGER,
      gift_name TEXT,
      gift_icon TEXT,
      amount INTEGER NOT NULL,
      type TEXT DEFAULT 'gift',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id),
      FOREIGN KEY(gift_id) REFERENCES gifts(id)
    )`);

    // Withdrawals table
    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Stream join requests (for private/group)
    db.run(`CREATE TABLE IF NOT EXISTS stream_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(stream_id) REFERENCES streams(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Direct Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);

    // Followers table
    db.run(`CREATE TABLE IF NOT EXISTS followers (
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY(follower_id) REFERENCES users(id),
      FOREIGN KEY(following_id) REFERENCES users(id)
    )`);


    // Seed default gifts
    db.get('SELECT COUNT(*) as count FROM gifts', (err, row) => {
      if (!err && row.count === 0) {
        const gifts = [
          ['Rose', '🌹', 10],
          ['Star', '⭐', 50],
          ['Diamond', '💎', 200],
          ['Crown', '👑', 500],
        ];
        const stmt = db.prepare('INSERT INTO gifts (name, icon, coin_cost) VALUES (?, ?, ?)');
        gifts.forEach(g => stmt.run(g));
        stmt.finalize();
        console.log('Default gifts seeded.');
      }
    });

    // Seed default admin user
    db.get('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin'], async (err, row) => {
      if (!err && row.count === 0) {
        const hash = await bcrypt.hash('admin123', 10);
        db.run(
          'INSERT INTO users (username, email, password, coin_balance, role) VALUES (?, ?, ?, ?, ?)',
          ['admin', 'admin@tangolive.com', hash, 9999999, 'admin'],
          (err) => {
            if (!err) console.log('Default admin user created: admin / admin123');
          }
        );
      }
    });
  });
};

module.exports = { db, initDB };
