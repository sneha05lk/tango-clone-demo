const { db } = require('../config/db');

// GET /api/messages - List all conversations for the current user
const getConversations = (req, res) => {
    const userId = req.user.id;
    // Query to get the latest message for each unique conversation partner
    const sql = `
        SELECT 
            u.id as partner_id,
            u.username as partner_name,
            u.avatar as partner_avatar,
            m.message as last_message,
            m.created_at as time,
            m.is_read
        FROM users u
        JOIN messages m ON (m.sender_id = u.id AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = u.id)
        WHERE m.id IN (
            SELECT MAX(id) FROM messages 
            WHERE sender_id = ? OR receiver_id = ? 
            GROUP BY CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
        )
        ORDER BY m.created_at DESC
    `;
    db.all(sql, [userId, userId, userId, userId, userId], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(rows);
    });
};

// GET /api/messages/:partnerId - Get message history with a specific user
const getMessageThread = (req, res) => {
    const userId = req.user.id;
    const partnerId = req.params.partnerId;

    const sql = `
        SELECT * FROM messages 
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ORDER BY created_at ASC
    `;
    db.all(sql, [userId, partnerId, partnerId, userId], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });

        // Mark as read
        db.run('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?', [partnerId, userId]);

        res.json(rows);
    });
};

// POST /api/messages - Send a message (also handled via socket for real-time)
const sendMessage = (req, res) => {
    const { receiver_id, message } = req.body;
    const sender_id = req.user.id;

    if (!message) return res.status(400).json({ message: 'Message content required' });

    db.run(
        'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
        [sender_id, receiver_id, message],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });
            res.status(201).json({ id: this.lastID, sender_id, receiver_id, message, created_at: new Date() });
        }
    );
};

module.exports = { getConversations, getMessageThread, sendMessage };
