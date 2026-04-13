const { db } = require('../config/db');

const MAX_BALANCE_RETRIES = 4;

const getUserBalance = async (userId) => {
    const { data: user, error } = await db
        .from('users')
        .select('coin_balance')
        .eq('id', userId)
        .single();

    if (error || !user) {
        return { error: error || new Error('User not found') };
    }
    return { balance: user.coin_balance };
};

const creditCoins = async (userId, amount) => {
    for (let attempt = 0; attempt < MAX_BALANCE_RETRIES; attempt += 1) {
        const current = await getUserBalance(userId);
        if (current.error) return { error: current.error };

        const nextBalance = current.balance + amount;
        const { data, error } = await db
            .from('users')
            .update({ coin_balance: nextBalance })
            .eq('id', userId)
            .eq('coin_balance', current.balance)
            .select('id, coin_balance')
            .maybeSingle();

        if (error) return { error };
        if (data) return { balance: data.coin_balance };
    }

    return { error: new Error('Unable to update balance safely after retries') };
};

const debitCoins = async (userId, amount) => {
    for (let attempt = 0; attempt < MAX_BALANCE_RETRIES; attempt += 1) {
        const current = await getUserBalance(userId);
        if (current.error) return { error: current.error };
        if (current.balance < amount) return { insufficient: true };

        const nextBalance = current.balance - amount;
        const { data, error } = await db
            .from('users')
            .update({ coin_balance: nextBalance })
            .eq('id', userId)
            .eq('coin_balance', current.balance)
            .select('id, coin_balance')
            .maybeSingle();

        if (error) return { error };
        if (data) return { balance: data.coin_balance };
    }

    return { error: new Error('Unable to update balance safely after retries') };
};

module.exports = {
    creditCoins,
    debitCoins,
};
