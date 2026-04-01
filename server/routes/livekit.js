const express = require('express');
const router = express.Router();
const { getToken } = require('../controllers/livekitController');
const { protect } = require('../middlewares/auth');

router.post('/token', protect, getToken);

module.exports = router;
