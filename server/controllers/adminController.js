const { db } = require('../config/db');

// GET /api/admin/stats
const getStats = async (req, res) => {
    try {
        const stats = {
            totalUsers: 0,
            totalStreams: 0,
            liveStreams: 0,
            platformRevenue: 0,
            pendingWithdrawals: 0,
            totalGiftsSent: 0
        };

        const [
            { count: totalUsers },
            { count: totalStreams },
            { count: liveStreams },
            { count: pendingWithdrawals },
            { count: totalGiftsSent },
            { data: revenueData }
        ] = await Promise.all([
            db.from('users').select('*', { count: 'exact', head: true }).neq('role', 'admin'),
            db.from('streams').select('*', { count: 'exact', head: true }),
            db.from('streams').select('*', { count: 'exact', head: true }).eq('is_live', true),
            db.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
            db.from('transactions').select('*', { count: 'exact', head: true }).eq('type', 'gift'),
            db.from('transactions').select('amount').eq('type', 'gift')
        ]);

        stats.totalUsers = totalUsers || 0;
        stats.totalStreams = totalStreams || 0;
        stats.liveStreams = liveStreams || 0;
        stats.pendingWithdrawals = pendingWithdrawals || 0;
        stats.totalGiftsSent = totalGiftsSent || 0;
        
        let platformRevenue = 0;
        if (revenueData) {
             platformRevenue = revenueData.reduce((sum, tx) => sum + tx.amount, 0);
        }
        stats.platformRevenue = platformRevenue;

        res.json(stats);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/users
const getUsers = async (req, res) => {
    try {
        const { data: users, error } = await db
            .from('users')
            .select('id, username, email, coin_balance, role, created_at, is_banned')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ message: error.message });
        res.json(users);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/streams
const getStreams = async (req, res) => {
    try {
        const { data: streams, error } = await db
            .from('streams')
            .select(`
                *,
                users!host_id (username)
            `)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) return res.status(500).json({ message: error.message });
        
        const formatted = streams.map(s => ({
            ...s,
            username: s.users?.username,
            users: undefined
        }));

        res.json(formatted);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/withdrawals
const getWithdrawals = async (req, res) => {
    try {
        const { data: withdrawals, error } = await db
            .from('withdrawals')
            .select(`
                *,
                users!user_id (username)
            `)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ message: error.message });
        
        const formatted = withdrawals.map(w => ({
             ...w,
             username: w.users?.username,
             users: undefined
        }));

        res.json(formatted);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// PUT /api/admin/withdrawals/:id
const updateWithdrawal = async (req, res) => {
    const { status } = req.body; // 'approved' or 'rejected'
    try {
        const { error } = await db
            .from('withdrawals')
            .update({ status })
            .eq('id', req.params.id);

        if (error) return res.status(500).json({ message: error.message });

        if (status === 'rejected') {
            // Refund coins if rejected
            const { data: w } = await db
                 .from('withdrawals')
                 .select('amount, user_id')
                 .eq('id', req.params.id)
                 .single();

            if (w) {
                const { data: u } = await db.from('users').select('coin_balance').eq('id', w.user_id).single();
                if (u) {
                    await db.from('users').update({ coin_balance: u.coin_balance + w.amount }).eq('id', w.user_id);
                }
            }
        }
        res.json({ message: `Withdrawal ${status}` });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/revenue-chart - daily gift revenue for last 7 days
const getRevenueChart = async (req, res) => {
    try {
        // Fetch last 7 days of transactions in JS
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const { data: transactions, error } = await db
             .from('transactions')
             .select('created_at, amount')
             .eq('type', 'gift')
             .gte('created_at', sevenDaysAgo.toISOString());
             
        if (error) return res.status(500).json({ message: error.message });
        
        const chartDataMap = {};
        transactions.forEach(tx => {
            const dateStr = tx.created_at.split('T')[0];
            chartDataMap[dateStr] = (chartDataMap[dateStr] || 0) + tx.amount;
        });
        
        const chartData = Object.keys(chartDataMap).map(date => ({
             date,
             total: chartDataMap[date]
        }));
        
        chartData.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json(chartData);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

const terminateStream = async (req, res) => {
    const { id } = req.params;
    const io = req.app.get('io');

    try {
        const { data: stream, error: getErr } = await db
            .from('streams')
            .select('livekit_room, title')
            .eq('id', id)
            .single();

        if (getErr || !stream) return res.status(404).json({ message: 'Stream not found' });

        const { error } = await db
            .from('streams')
            .update({ is_live: false })
            .eq('id', id);

        if (error) return res.status(500).json({ message: error.message });
            
        if (io && stream.livekit_room) {
            io.to(stream.livekit_room).emit('stream-ended', { 
                message: 'This stream has been terminated by an administrator for policy violations.' 
            });
        }
        res.json({ message: 'Stream terminated successfully' });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

const toggleUserBan = async (req, res) => {
    const { id } = req.params;
    const { is_banned } = req.body; 

    try {
        const { error } = await db
            .from('users')
            .update({ is_banned: !!is_banned })
            .eq('id', id);

        if (error) return res.status(500).json({ message: error.message });
        res.json({ message: `User ${is_banned ? 'banned' : 'unbanned'} successfully` });
    } catch (e) {
         res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getStats, getUsers, getStreams, getWithdrawals, updateWithdrawal, getRevenueChart, terminateStream, toggleUserBan };
