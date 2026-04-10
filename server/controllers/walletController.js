const { db } = require('../config/db');

// GET /api/wallet - get wallet info
const getWallet = async (req, res) => {
    const userId = req.user.id;
    try {
        const { data: user, error: userError } = await db
            .from('users')
            .select('coin_balance')
            .eq('id', userId)
            .single();

        if (userError || !user) return res.status(500).json({ message: userError?.message || 'User not found' });

        const { data: transactions, error: txError } = await db
            .from('transactions')
            .select(`
                *,
                gifts!gift_id(name, icon),
                sender:users!sender_id (username),
                receiver:users!receiver_id (username)
            `)
            .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
            .order('created_at', { ascending: false })
            .limit(50);

        if (txError) return res.status(500).json({ message: txError.message });

        const formattedTxs = transactions.map(t => ({
             ...t,
             gift_name: t.gifts?.name || t.gift_name,
             gift_icon: t.gifts?.icon || t.gift_icon,
             sender_name: t.sender?.username,
             receiver_name: t.receiver?.username,
             gifts: undefined, sender: undefined, receiver: undefined
        }));

        res.json({ coin_balance: user.coin_balance, transactions: formattedTxs });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/wallet/withdraw - request a withdrawal
const requestWithdrawal = async (req, res) => {
    const { amount } = req.body;
    const userId = req.user.id;

    try {
        const { data: user } = await db
            .from('users')
            .select('coin_balance')
            .eq('id', userId)
            .single();

        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.coin_balance < amount) return res.status(400).json({ message: 'Insufficient balance' });

        const { data: withdrawal, error } = await db
            .from('withdrawals')
            .insert([{ user_id: userId, amount }])
            .select('id')
            .single();

        if (error) return res.status(500).json({ message: error.message });

        // Deduct coins immediately (pending admin approval)
        await db
            .from('users')
            .update({ coin_balance: user.coin_balance - amount })
            .eq('id', userId);

        // Record the transaction as a withdrawal
        db.from('transactions')
          .insert([{
              sender_id: userId,
              receiver_id: null,
              stream_id: null,
              gift_id: null,
              gift_name: 'Withdrawal',
              gift_icon: '💸',
              amount,
              type: 'withdrawal'
          }]).then(); // async, don't wait

        res.status(201).json({ message: 'Withdrawal request submitted', id: withdrawal.id });
    } catch (e) {
         res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/wallet/withdrawals - user's own withdrawal history
const getWithdrawals = async (req, res) => {
    try {
        const { data: withdrawals, error } = await db
            .from('withdrawals')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ message: error.message });
        res.json(withdrawals);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/wallet/buy - simulate purchasing coins
const buyCoins = async (req, res) => {
    const { packageId, coins } = req.body;
    const userId = req.user.id;

    try {
        const { data: user } = await db
             .from('users')
             .select('coin_balance')
             .eq('id', userId)
             .single();

        if (user) {
             await db
                 .from('users')
                 .update({ coin_balance: user.coin_balance + coins })
                 .eq('id', userId);

             await db.from('transactions')
                 .insert([{
                     sender_id: userId,
                     receiver_id: userId,
                     gift_name: 'Coin Purchase',
                     gift_icon: '💳',
                     amount: coins,
                     type: 'purchase'
                 }]);

             res.status(200).json({ message: 'Coins purchased successfully!', coinsAdded: coins });
        } else {
             res.status(404).json({ message: 'User not found' });
        }
    } catch (e) {
         res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getWallet,
    requestWithdrawal,
    getWithdrawals,
    buyCoins
};
