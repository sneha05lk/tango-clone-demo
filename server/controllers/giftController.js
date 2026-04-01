const { db } = require('../config/db');

// GET /api/gifts - list all gifts
const getGifts = (req, res) => {
    db.all('SELECT * FROM gifts', [], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(rows);
    });
};

// POST /api/gifts/send - send a gift
const sendGift = (req, res) => {
    const { gift_id, stream_id, receiver_id } = req.body;
    const sender_id = req.user.id;

    db.get('SELECT * FROM gifts WHERE id = ?', [gift_id], (err, gift) => {
        if (err || !gift) return res.status(404).json({ message: 'Gift not found' });

        db.get('SELECT coin_balance FROM users WHERE id = ?', [sender_id], (err, sender) => {
            if (err || !sender) return res.status(404).json({ message: 'Sender not found' });
            if (sender.coin_balance < gift.coin_cost)
                return res.status(400).json({ message: 'Insufficient coins' });

            // Deduct from sender
            db.run('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?', [gift.coin_cost, sender_id]);
            // Credit to receiver
            db.run('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?', [gift.coin_cost, receiver_id]);

            // Record transaction
            db.run(
                'INSERT INTO transactions (sender_id, receiver_id, gift_id, stream_id, amount, type) VALUES (?, ?, ?, ?, ?, ?)',
                [sender_id, receiver_id, gift_id, stream_id, gift.coin_cost, 'gift'],
                function (err) {
                    if (err) return res.status(500).json({ message: err.message });
                    res.status(201).json({ message: 'Gift sent!', gift, transactionId: this.lastID });
                }
            );
        });
    });
};

module.exports = { getGifts, sendGift };
