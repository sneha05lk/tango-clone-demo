const { db } = require('../config/db');

// GET /api/users/profile/:id
const getProfile = (req, res) => {
    const userId = req.params.id;
    db.get(
        `SELECT id, username, avatar, bio, coin_balance, created_at,
         (SELECT COUNT(*) FROM followers WHERE following_id = ?) as followers_count,
         (SELECT COUNT(*) FROM followers WHERE follower_id = ?) as following_count,
         (SELECT SUM(amount) FROM transactions WHERE receiver_id = ? AND type = 'gift') as earned_coins
         FROM users WHERE id = ?`,
        [userId, userId, userId, userId],
        (err, user) => {
            if (err || !user) return res.status(404).json({ message: 'User not found' });
            res.json(user);
        }
    );
};

// PUT /api/users/profile
const updateProfile = (req, res) => {
    const { username, bio } = req.body;
    const userId = req.user.id;

    if (!username || username.trim().length < 3) {
        return res.status(400).json({ message: 'Username must be at least 3 characters' });
    }

    db.run(
        'UPDATE users SET username = ?, bio = ? WHERE id = ?',
        [username.trim(), bio, userId],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed: users.username')) {
                    return res.status(400).json({ message: 'Username already taken' });
                }
                return res.status(500).json({ message: err.message });
            }
            res.json({ message: 'Profile updated successfully' });
        }
    );
};

// POST /api/users/follow/:id
const followUser = (req, res) => {
    const followerId = req.user.id;
    const followingId = req.params.id;

    if (followerId == followingId) {
        return res.status(400).json({ message: 'You cannot follow yourself' });
    }

    db.run(
        'INSERT OR IGNORE INTO followers (follower_id, following_id) VALUES (?, ?)',
        [followerId, followingId],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: 'Followed successfully' });
        }
    );
};

// DELETE /api/users/follow/:id
const unfollowUser = (req, res) => {
    const followerId = req.user.id;
    const followingId = req.params.id;

    db.run(
        'DELETE FROM followers WHERE follower_id = ? AND following_id = ?',
        [followerId, followingId],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: 'Unfollowed successfully' });
        }
    );
};

// GET /api/users/follow-status/:id
const getFollowStatus = (req, res) => {
    const followerId = req.user.id;
    const followingId = req.params.id;

    db.get(
        'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ?',
        [followerId, followingId],
        (err, row) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ isFollowing: !!row });
        }
    );
};

// GET /api/users/search?q=query
const searchUsers = (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);

    db.all(
        'SELECT id, username, avatar FROM users WHERE username LIKE ? LIMIT 10',
        [`%${query}%`],
        (err, users) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(users);
        }
    );
};

// GET /api/users/:id/followers
const getFollowers = (req, res) => {
    const userId = req.params.id;
    db.all(
        `SELECT u.id, u.username, u.avatar 
         FROM users u 
         JOIN followers f ON f.follower_id = u.id 
         WHERE f.following_id = ?`,
        [userId],
        (err, users) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(users);
        }
    );
};

// GET /api/users/:id/following
const getFollowing = (req, res) => {
    const userId = req.params.id;
    db.all(
        `SELECT u.id, u.username, u.avatar 
         FROM users u 
         JOIN followers f ON f.following_id = u.id 
         WHERE f.follower_id = ?`,
        [userId],
        (err, users) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(users);
        }
    );
};

module.exports = {
    getProfile,
    updateProfile,
    followUser,
    unfollowUser,
    getFollowStatus,
    searchUsers,
    getFollowers,
    getFollowing
};
