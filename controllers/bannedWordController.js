const { BannedWord } = require('../models');

exports.get = async (req, res) => {
  const doc = await BannedWord.findOne({ userId: req.user.id }).lean();
  res.json({ words: doc?.words || [], action: doc?.action || 'censor', replacement: doc?.replacement || '' });
};

exports.save = async (req, res) => {
  const words = (req.body.words || []).map(w => w.toLowerCase().trim()).filter(Boolean);
  const action = ['block', 'censor', 'replace'].includes(req.body.action) ? req.body.action : 'censor';
  const replacement = req.body.replacement || '';
  const doc = await BannedWord.findOneAndUpdate(
    { userId: req.user.id },
    { words, action, replacement },
    { new: true, upsert: true }
  );
  res.json({ words: doc.words, action: doc.action, replacement: doc.replacement });
};

// Helper untuk dipakai di createDonation
exports.filterMessage = async (userId, text) => {
  if (!text) return { blocked: false, filtered: text };
  const doc = await BannedWord.findOne({ userId }).lean();
  if (!doc?.words?.length) return { blocked: false, filtered: text };

  const action = doc.action || 'censor';
  let filtered = text;
  let hasBanned = false;

  for (const word of doc.words) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (regex.test(filtered)) {
      hasBanned = true;
      if (action === 'block') break;
      if (action === 'censor') {
        filtered = filtered.replace(regex, (m) => '*'.repeat(m.length));
      } else if (action === 'replace') {
        filtered = filtered.replace(regex, doc.replacement || '***');
      }
    }
  }

  return { blocked: action === 'block' && hasBanned, filtered };
};