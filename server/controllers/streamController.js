const { db } = require('../config/db');

// GET /api/streams - list all live public streams
const getStreams = (req, res) => {
    db.all(
        `SELECT s.*, u.username, u.avatar FROM streams s
     JOIN users u ON s.host_id = u.id
     WHERE s.is_live = 1 AND s.type = 'public'
     ORDER BY s.viewer_count DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(rows);
        }
    );
};

// GET /api/streams/all - list all streams (incl. group/private) for authenticated users
const getAllStreams = (req, res) => {
    db.all(
        `SELECT s.*, u.username, u.avatar FROM streams s
     JOIN users u ON s.host_id = u.id
     WHERE s.is_live = 1
     ORDER BY s.viewer_count DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(rows);
        }
    );
};

// GET /api/streams/:id
const getStreamById = (req, res) => {
    db.get(
        `SELECT s.*, u.username, u.avatar FROM streams s
     JOIN users u ON s.host_id = u.id
     WHERE s.id = ?`,
        [req.params.id],
        (err, row) => {
            if (err || !row) return res.status(404).json({ message: 'Stream not found' });
            res.json(row);
        }
    );
};

// POST /api/streams - create a stream
const createStream = (req, res) => {
    const { title, category, type } = req.body;
    const roomName = `room_${Date.now()}_${req.user.id}`;

    // Close any existing live stream by this host
    db.run('UPDATE streams SET is_live = 0 WHERE host_id = ? AND is_live = 1', [req.user.id]);

    db.run(
        'INSERT INTO streams (title, category, type, host_id, is_live, livekit_room) VALUES (?, ?, ?, ?, 1, ?)',
        [title || 'Untitled Stream', category || 'General', type || 'public', req.user.id, roomName],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });
            db.get(
                `SELECT s.*, u.username, u.avatar FROM streams s JOIN users u ON s.host_id = u.id WHERE s.id = ?`,
                [this.lastID],
                (err, stream) => res.status(201).json(stream)
            );
        }
    );
};

// PUT /api/streams/:id/end - end a stream
const endStream = (req, res) => {
    db.run(
        'UPDATE streams SET is_live = 0 WHERE id = ? AND host_id = ?',
        [req.params.id, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });
            if (this.changes === 0) return res.status(403).json({ message: 'Not authorized or stream not found' });
            res.json({ message: 'Stream ended' });
        }
    );
};

// POST /api/streams/:id/request - viewer requests to join private/group stream
const requestJoin = (req, res) => {
    const { id: stream_id } = req.params;
    const user_id = req.user.id;

    db.get('SELECT * FROM stream_requests WHERE stream_id = ? AND user_id = ?', [stream_id, user_id], (err, existing) => {
        if (existing) return res.json({ message: 'Request already sent', status: existing.status });
        db.run(
            'INSERT INTO stream_requests (stream_id, user_id) VALUES (?, ?)',
            [stream_id, user_id],
            function (err) {
                if (err) return res.status(500).json({ message: err.message });
                res.status(201).json({ message: 'Join request sent', requestId: this.lastID });
            }
        );
    });
};

// PUT /api/streams/requests/:requestId - host approves or rejects
const handleRequest = (req, res) => {
    const { status } = req.body; // 'approved' or 'rejected'
    db.run(
        'UPDATE stream_requests SET status = ? WHERE id = ?',
        [status, req.params.requestId],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: `Request ${status}` });
        }
    );
};

// GET /api/streams/:id/requests - get join requests for a stream (host only)
const getRequests = (req, res) => {
    db.all(
        `SELECT sr.*, u.username, u.avatar FROM stream_requests sr
     JOIN users u ON sr.user_id = u.id
     JOIN streams s ON sr.stream_id = s.id
     WHERE sr.stream_id = ? AND s.host_id = ? AND sr.status = 'pending'`,
        [req.params.id, req.user.id],
        (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json(rows);
        }
    );
};

module.exports = { getStreams, getAllStreams, getStreamById, createStream, endStream, requestJoin, handleRequest, getRequests };
