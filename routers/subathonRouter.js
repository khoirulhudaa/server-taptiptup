const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/subathonController');
const auth = require('../middleware/authMiddleware');

router.get('/',          auth, ctrl.getTimer);
router.put('/config',    auth, ctrl.updateConfig);
router.post('/start',    auth, ctrl.start);
router.post('/pause',    auth, ctrl.pause);
router.post('/reset',    auth, ctrl.reset);
router.post('/add-time', auth, ctrl.addTime);
router.get('/public/:token', ctrl.getPublic);

module.exports = router;