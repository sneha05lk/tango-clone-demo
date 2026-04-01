const { db } = require('../config/db');

// GET /api/wallet - get wallet info
const getWallet = (req, res) => {
    const userId = req.user.id;
    db.get('SELECT coin_balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) return res.status(500).json({ message: err.message });

        db.all(
            `SELECT t.*, g.name as gift_name, g.icon as gift_icon,
              s.username as sender_name, r.username as receiver_name
       FROM transactions t
       LEFT JOIN gifts g ON t.gift_id = g.id
       LEFT JOIN users s ON t.sender_id = s.id
       LEFT JOIN users r ON t.receiver_id = r.id
       WHERE t.sender_id = ? OR t.receiver_id = ?
       ORDER BY t.created_at DESC LIMIT 50`,
            [userId, userId],
            (err, transactions) => {
                if (err) return res.status(500).json({ message: err.message });
                res.json({ coin_balance: user.coin_balance, transactions });
            }
        );
    });
};

// POST /api/wallet/withdraw - request a withdrawal
const requestWithdrawal = (req, res) => {
    const { amount } = req.body;
    const userId = req.user.id;

    db.get('SELECT coin_balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ message: 'User not found' });
        if (user.coin_balance < amount) return res.status(400).json({ message: 'Insufficient balance' });

        db.run(
            'INSERT INTO withdrawals (user_id, amount) VALUES (?, ?)',
            [userId, amount],
            function (err) {
                if (err) return res.status(500).json({ message: err.message });
                // Deduct coins immediately (pending admin approval)
                db.run('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?', [amount, userId]);

                // Record the transaction as a withdrawal
                db.run(
                    'INSERT INTO transactions (sender_id, receiver_id, stream_id, gift_id, gift_name, gift_icon, amount) VALUES (?, NULL, NULL, NULL, ?, ?, ?)',
                    [userId, 'Withdrawal', '💸', amount],
                    (err) => {
                        // We don't block the response on this transaction logging
                        if (err) console.error("Failed to log withdrawal transaction:", err);
                    }
                );

                res.status(201).json({ message: 'Withdrawal request submitted', id: this.lastID });
            }
        );
    });
};

// GET /api/wallet/withdrawals - user's own withdrawal history
const getWithdrawals = (req, res) => {
    db.all(
        'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC',
        [req.user.id],
        (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(rows);
        }
    );
};

// POST /api/wallet/buy - simulate purchasing coins
const buyCoins = (req, res) => {
    const { packageId, coins } = req.body;
    const userId = req.user.id;

    // Simulate payment success and grant coins
    db.run('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?', [coins, userId], function (err) {
        if (err) return res.status(500).json({ message: err.message });

        // Record the transaction as a purchase
        db.run(
            'INSERT INTO transactions (sender_id, receiver_id, stream_id, gift_id, gift_name, gift_icon, amount) VALUES (?, ?, NULL, NULL, ?, ?, ?)',
            [userId, userId, 'Coin Purchase', '💳', coins],
            (err) => {
                if (err) return res.status(500).json({ message: err.message });
                res.status(200).json({ message: 'Coins purchased successfully!', coinsAdded: coins });
            }
        );
    });
};

module.exports = {
    getWallet,
    requestWithdrawal,
    getWithdrawals,
    buyCoins
};
