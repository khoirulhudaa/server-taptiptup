const express = require('express');
const router = express.Router();
const overlayCtrl = require('../controllers/overlayController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/settings', authMiddleware, overlayCtrl.getSettings);
router.post('/settings', authMiddleware, overlayCtrl.updateSettings);
router.get('/public/:username', overlayCtrl.getPublicProfile);
router.get('/config/:token', overlayCtrl.getOverlaySettings);

module.exports = router;