const { db } = require('../config/db');

// GET /api/messages - List all conversations for the current user
const getConversations = async (req, res) => {
    const userId = req.user.id;
    
    try {
        // Fetch all messages where user is sender or receiver
        const { data: messages, error } = await db
            .from('messages')
            .select(`
                *,
                sender:users!sender_id(id, username, avatar),
                receiver:users!receiver_id(id, username, avatar)
            `)
            .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ message: error.message });

        const partners = new Map();

        messages.forEach(m => {
            const isSender = m.sender_id === userId;
            const partner = isSender ? m.receiver : m.sender;
            
            if (!partners.has(partner.id)) {
                partners.set(partner.id, {
                    partner_id: partner.id,
                    partner_name: partner.username,
                    partner_avatar: partner.avatar,
                    last_message: m.message,
                    time: m.created_at,
                    is_read: m.is_read
                });
            }
        });

        res.json(Array.from(partners.values()));
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/messages/:partnerId - Get message history with a specific user
const getMessageThread = async (req, res) => {
    const userId = req.user.id;
    const partnerId = req.params.partnerId;

    try {
        const { data: messages, error } = await db
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`)
            .order('created_at', { ascending: true });

        if (error) return res.status(500).json({ message: error.message });

        // Mark as read asynchronously
        db.from('messages')
          .update({ is_read: true })
          .eq('sender_id', partnerId)
          .eq('receiver_id', userId)
          .then(); // fire and forget

        res.json(messages || []);
    } catch (e) {
         res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/messages - Send a message (also handled via socket for real-time)
const sendMessage = async (req, res) => {
    const { receiver_id, message } = req.body;
    const sender_id = req.user.id;

    if (!message) return res.status(400).json({ message: 'Message content required' });

    try {
        const { data, error } = await db
            .from('messages')
            .insert([{ sender_id, receiver_id, message }])
            .select()
            .single();

        if (error) return res.status(500).json({ message: error.message });
        res.status(201).json(data);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getConversations, getMessageThread, sendMessage };
