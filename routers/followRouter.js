// routers/followRouter.js
const express    = require('express');
const router     = express.Router();
const followCtrl = require('../controllers/followController');
const auth       = require('../middleware/authMiddleware');

router.post  ('/:userId/toggle',   auth, followCtrl.toggleFollow);
router.get   ('/:userId/followers', auth, followCtrl.getFollowers);
router.get   ('/:userId/following', auth, followCtrl.getFollowing);
router.get   ('/:userId/stats',     auth, followCtrl.getFollowStats);
router.get   ('/discover',          auth, followCtrl.discoverStreamers);

module.exports = router;