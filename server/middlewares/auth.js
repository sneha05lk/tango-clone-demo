const jwt = require('jsonwebtoken');
const { db } = require('../config/db');

const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tangolive_secret_key');
        
        const { data: user, error } = await db
            .from('users')
            .select('id, username, email, coin_balance, role, avatar, is_banned')
            .eq('id', decoded.id)
            .single();

        if (error || !user) return res.status(401).json({ message: 'Not authorized, user not found' });
        if (user.is_banned) return res.status(403).json({ message: 'Your account has been banned.' });
        
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Admin access required' });
    }
};

module.exports = { protect, adminOnly };
