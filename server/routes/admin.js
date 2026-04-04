const express = require('express');
const router = express.Router();
const { getStats, getUsers, getStreams, getWithdrawals, updateWithdrawal, getRevenueChart, terminateStream, toggleUserBan } = require('../controllers/adminController');
const { protect, adminOnly } = require('../middlewares/auth');

router.use(protect, adminOnly);
router.get('/stats', getStats);
router.get('/users', getUsers);
router.get('/streams', getStreams);
router.get('/withdrawals', getWithdrawals);
router.put('/withdrawals/:id', updateWithdrawal);
router.get('/revenue-chart', getRevenueChart);
router.put('/streams/:id/terminate', terminateStream);
router.put('/users/:id/ban', toggleUserBan);

module.exports = router;
