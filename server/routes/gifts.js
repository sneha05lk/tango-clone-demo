const express = require('express');
const router = express.Router();
const { getGifts, sendGift } = require('../controllers/giftController');
const { protect } = require('../middlewares/auth');

router.get('/', getGifts);
router.post('/send', protect, sendGift);

module.exports = router;
