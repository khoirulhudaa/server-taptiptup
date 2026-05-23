const express = require('express');
const router = express.Router();
const { checkYouTubeVideo } = require('../utils/checkYoutube');
const { isYouTubeUrl } = require('../utils/checkYoutube'); // atau helper kamu

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ safe: false, reason: 'URL tidak diberikan' });

  const isYT = /youtube\.com|youtu\.be/i.test(url);
  if (!isYT) return res.json({ safe: true }); // bukan YouTube, lolos

  try {
    const result = await checkYouTubeVideo(url);
    return res.json(result);
  } catch (err) {
    // API down / quota habis → loloskan saja
    return res.json({ safe: true, warn: 'Check gagal, tidak diblokir' });
  }
});

module.exports = router;