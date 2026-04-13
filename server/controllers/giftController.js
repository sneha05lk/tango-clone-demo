const { db } = require('../config/db');
const { debitCoins, creditCoins } = require('../utils/balance');

// GET /api/gifts - list all gifts
const getGifts = async (req, res) => {
    try {
        const { data: gifts, error } = await db.from('gifts').select('*');
        if (error) return res.status(500).json({ message: error.message });
        res.json(gifts);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/gifts/send - send a gift
const sendGift = async (req, res) => {
    const { gift_id, stream_id, receiver_id } = req.body;
    const sender_id = req.user.id;

    try {
        // 1. Get Gift details
        const { data: gift, error: giftError } = await db
            .from('gifts')
            .select('*')
            .eq('id', gift_id)
            .single();

        if (giftError || !gift) return res.status(404).json({ message: 'Gift not found' });

        const debitResult = await debitCoins(sender_id, gift.coin_cost);
        if (debitResult.error) return res.status(500).json({ message: debitResult.error.message });
        if (debitResult.insufficient) return res.status(400).json({ message: 'Insufficient coins' });

        const creditResult = await creditCoins(receiver_id, gift.coin_cost);
        if (creditResult.error) {
            await creditCoins(sender_id, gift.coin_cost);
            return res.status(500).json({ message: 'Failed to credit receiver. Sender was refunded.' });
        }

        // 5. Record transaction
        const { data: tx, error: txError } = await db
            .from('transactions')
            .insert([{
                sender_id,
                receiver_id,
                gift_id,
                stream_id,
                amount: gift.coin_cost,
                type: 'gift',
                gift_name: gift.name,
                gift_icon: gift.icon
            }])
            .select('id')
            .single();

        if (txError) {
            await debitCoins(receiver_id, gift.coin_cost);
            await creditCoins(sender_id, gift.coin_cost);
            return res.status(500).json({ message: txError.message });
        }
        
        res.status(201).json({ message: 'Gift sent!', gift, transactionId: tx.id });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getGifts, sendGift };
