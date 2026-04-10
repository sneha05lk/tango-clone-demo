const { db } = require('../config/db');

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

        // 2. Check Sender Balance
        const { data: sender, error: senderError } = await db
            .from('users')
            .select('coin_balance')
            .eq('id', sender_id)
            .single();

        if (senderError || !sender) return res.status(404).json({ message: 'Sender not found' });
        if (sender.coin_balance < gift.coin_cost)
            return res.status(400).json({ message: 'Insufficient coins' });

        // Get Receiver Balance
        const { data: receiver, error: receiverError } = await db
             .from('users')
             .select('coin_balance')
             .eq('id', receiver_id)
             .single();

        if (receiverError || !receiver) return res.status(404).json({ message: 'Receiver not found' });

        // Note: For a true production app, this should be done using a Postgres RPC to avoid race conditions.
        // 3. Deduct from sender
        const newSenderBalance = sender.coin_balance - gift.coin_cost;
        await db.from('users').update({ coin_balance: newSenderBalance }).eq('id', sender_id);

        // 4. Credit to receiver
        const newReceiverBalance = receiver.coin_balance + gift.coin_cost;
        await db.from('users').update({ coin_balance: newReceiverBalance }).eq('id', receiver_id);

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

        if (txError) return res.status(500).json({ message: txError.message });
        
        res.status(201).json({ message: 'Gift sent!', gift, transactionId: tx.id });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getGifts, sendGift };
