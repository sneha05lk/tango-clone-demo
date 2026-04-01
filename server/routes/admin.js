const express = require('express');
const router = express.Router();
const { getStats, getUsers, getStreams, getWithdrawals, updateWithdrawal, getRevenueChart } = require('../controllers/adminController');
const { protect, adminOnly } = require('../middlewares/auth');

router.use(protect, adminOnly);
router.get('/stats', getStats);
router.get('/users', getUsers);
router.get('/streams', getStreams);
router.get('/withdrawals', getWithdrawals);
router.put('/withdrawals/:id', updateWithdrawal);
router.get('/revenue-chart', getRevenueChart);

module.exports = router;
