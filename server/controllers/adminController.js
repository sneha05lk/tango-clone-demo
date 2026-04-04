const { db } = require('../config/db');

// GET /api/admin/stats
const getStats = (req, res) => {
    const stats = {};
    const run = (query, key) =>
        new Promise((resolve) =>
            db.get(query, [], (err, row) => {
                stats[key] = row ? Object.values(row)[0] : 0;
                resolve();
            })
        );

    Promise.all([
        run('SELECT COUNT(*) as total FROM users WHERE role != "admin"', 'totalUsers'),
        run('SELECT COUNT(*) as total FROM streams', 'totalStreams'),
        run('SELECT COUNT(*) as total FROM streams WHERE is_live = 1', 'liveStreams'),
        run('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = "gift"', 'platformRevenue'),
        run('SELECT COUNT(*) as total FROM withdrawals WHERE status = "pending"', 'pendingWithdrawals'),
        run('SELECT COUNT(*) as total FROM transactions WHERE type = "gift"', 'totalGiftsSent'),
    ]).then(() => res.json(stats));

};

// GET /api/admin/users
const getUsers = (req, res) => {
    db.all('SELECT id, username, email, coin_balance, role, created_at FROM users ORDER BY created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(rows);
    });
};

// GET /api/admin/streams
const getStreams = (req, res) => {
    db.all(
        `SELECT s.*, u.username FROM streams s JOIN users u ON s.host_id = u.id ORDER BY s.created_at DESC LIMIT 100`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(rows);
        }
    );
};

// GET /api/admin/withdrawals
const getWithdrawals = (req, res) => {
    db.all(
        `SELECT w.*, u.username FROM withdrawals w JOIN users u ON w.user_id = u.id ORDER BY w.created_at DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(rows);
        }
    );
};

// PUT /api/admin/withdrawals/:id
const updateWithdrawal = (req, res) => {
    const { status } = req.body; // 'approved' or 'rejected'
    db.run('UPDATE withdrawals SET status = ? WHERE id = ?', [status, req.params.id], function (err) {
        if (err) return res.status(500).json({ message: err.message });
        if (status === 'rejected') {
            // Refund coins if rejected
            db.get('SELECT * FROM withdrawals WHERE id = ?', [req.params.id], (_, w) => {
                if (w) db.run('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?', [w.amount, w.user_id]);
            });
        }
        res.json({ message: `Withdrawal ${status}` });
    });
};

// GET /api/admin/revenue-chart - daily gift revenue for last 7 days
const getRevenueChart = (req, res) => {
    db.all(
        `SELECT DATE(created_at) as date, SUM(amount) as total
     FROM transactions WHERE type='gift'
     GROUP BY DATE(created_at)
     ORDER BY date ASC LIMIT 7`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(rows);
        }
    );
};

const terminateStream = (req, res) => {
    const { id } = req.params;
    const io = req.app.get('io');

    db.get('SELECT livekit_room, title FROM streams WHERE id = ?', [id], (err, stream) => {
        if (err || !stream) return res.status(404).json({ message: 'Stream not found' });

        db.run('UPDATE streams SET is_live = 0 WHERE id = ?', [id], function (err) {
            if (err) return res.status(500).json({ message: err.message });
            
            if (io && stream.livekit_room) {
                io.to(stream.livekit_room).emit('stream-ended', { 
                    message: 'This stream has been terminated by an administrator for policy violations.' 
                });
            }
            res.json({ message: 'Stream terminated successfully' });
        });
    });
};

const toggleUserBan = (req, res) => {
    const { id } = req.params;
    const { is_banned } = req.body; // 1 for banned, 0 for active

    db.run('UPDATE users SET is_banned = ? WHERE id = ?', [is_banned, id], function (err) {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: `User ${is_banned ? 'banned' : 'unbanned'} successfully` });
    });
};

module.exports = { getStats, getUsers, getStreams, getWithdrawals, updateWithdrawal, getRevenueChart, terminateStream, toggleUserBan };
