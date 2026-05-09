const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/pollController');
const auth = require('../middleware/authMiddleware');

// Dashboard (auth)
router.get('/',             auth, ctrl.getMyPolls);
router.post('/',            auth, ctrl.create);
router.post('/:id/close',   auth, ctrl.close);
router.delete('/:id',       auth, ctrl.remove);

// Publik
router.get('/active/:username',    ctrl.getActive);
router.post('/:id/vote',           ctrl.vote);
router.get('/widget/:token',       ctrl.getPublicByToken);

module.exports = router;