const { db } = require('../config/db');
const { debitCoins, creditCoins } = require('../utils/balance');

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
        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({ message: 'Amount must be a positive integer' });
        }

        const debitResult = await debitCoins(userId, amount);
        if (debitResult.error) return res.status(500).json({ message: debitResult.error.message });
        if (debitResult.insufficient) return res.status(400).json({ message: 'Insufficient balance' });

        const { data: withdrawal, error } = await db
            .from('withdrawals')
            .insert([{ user_id: userId, amount }])
            .select('id')
            .single();

        if (error) {
            await creditCoins(userId, amount);
            return res.status(500).json({ message: error.message });
        }

        // Record the transaction as a withdrawal
        const { error: txError } = await db.from('transactions')
          .insert([{
              sender_id: userId,
              receiver_id: null,
              stream_id: null,
              gift_id: null,
              gift_name: 'Withdrawal',
              gift_icon: '💸',
              amount,
              type: 'withdrawal'
          }]);

        if (txError) {
            await db.from('withdrawals').delete().eq('id', withdrawal.id);
            await creditCoins(userId, amount);
            return res.status(500).json({ message: txError.message });
        }

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
        if (!Number.isInteger(coins) || coins <= 0) {
            return res.status(400).json({ message: 'Coins must be a positive integer' });
        }

        const creditResult = await creditCoins(userId, coins);
        if (creditResult.error) return res.status(500).json({ message: creditResult.error.message });

        const { error: txError } = await db.from('transactions')
            .insert([{
                sender_id: userId,
                receiver_id: userId,
                gift_name: 'Coin Purchase',
                gift_icon: '💳',
                amount: coins,
                type: 'purchase'
            }]);

        if (txError) {
            await debitCoins(userId, coins);
            return res.status(500).json({ message: txError.message });
        }

        res.status(200).json({ message: 'Coins purchased successfully!', coinsAdded: coins, packageId });
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
