const express = require('express');
const router = express.Router();
const { getWallet, requestWithdrawal, getWithdrawals, buyCoins } = require('../controllers/walletController');
const { protect } = require('../middlewares/auth');

router.get('/', protect, getWallet);
router.post('/withdraw', protect, requestWithdrawal);
router.get('/withdrawals', protect, getWithdrawals);
router.post('/buy', protect, buyCoins);

module.exports = router;
