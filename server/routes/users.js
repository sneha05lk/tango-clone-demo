const express = require('express');
const router = express.Router();
const {
    getProfile,
    updateProfile,
    followUser,
    unfollowUser,
    getFollowStatus,
    searchUsers,
    getFollowers,
    getFollowing
} = require('../controllers/userController');
const { protect } = require('../middlewares/auth');

router.get('/profile/:id', getProfile);
router.put('/profile', protect, updateProfile);
router.post('/follow/:id', protect, followUser);
router.delete('/follow/:id', protect, unfollowUser);
router.get('/follow-status/:id', protect, getFollowStatus);
router.get('/search', searchUsers);
router.get('/:id/followers', getFollowers);
router.get('/:id/following', getFollowing);

module.exports = router;
