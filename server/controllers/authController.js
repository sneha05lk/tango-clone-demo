const jwt = require('jsonwebtoken');
const { db } = require('../config/db');
const bcrypt = require('bcrypt');

const generateToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET || 'tangolive_secret_key', { expiresIn: '30d' });

// POST /api/auth/register
const register = (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ message: 'All fields are required' });

    db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username], async (err, existing) => {
        if (existing) return res.status(400).json({ message: 'Username or email already taken' });

        const hash = await bcrypt.hash(password, 10);
        db.run(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, hash],
            function (err) {
                if (err) return res.status(500).json({ message: err.message });
                const token = generateToken(this.lastID);
                res.status(201).json({
                    id: this.lastID, username, email,
                    coin_balance: 1000, role: 'user', token
                });
            }
        );
    });
};

// POST /api/auth/login
const login = (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err || !user) return res.status(401).json({ message: 'Invalid email or password' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ message: 'Invalid email or password' });

        const token = generateToken(user.id);
        res.json({
            id: user.id, username: user.username, email: user.email,
            coin_balance: user.coin_balance, role: user.role,
            avatar: user.avatar, token
        });
    });
};

// GET /api/auth/me
const getMe = (req, res) => {
    db.get(
        `SELECT u.id, u.username, u.email, u.coin_balance, u.role, u.avatar, u.created_at,
         (SELECT COUNT(*) FROM streams WHERE host_id = u.id) as total_streams,
         (SELECT COUNT(*) FROM followers WHERE following_id = u.id) as followers
         FROM users u WHERE u.id = ?`,

        [req.user.id],
        (err, user) => {
            if (err || !user) return res.status(404).json({ message: 'User not found' });
            res.json(user);
        }
    );
};

module.exports = { register, login, getMe };
