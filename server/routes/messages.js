const express = require('express');
const router = express.Router();
const { getConversations, getMessageThread, sendMessage } = require('../controllers/messageController');
const { protect } = require('../middlewares/auth');

router.get('/', protect, getConversations);
router.get('/:partnerId', protect, getMessageThread);
router.post('/', protect, sendMessage);

module.exports = router;
