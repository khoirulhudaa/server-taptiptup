const { OverlaySetting, User } = require('../models');

exports.getSettings = async (req, res) => {
  try {
    const settings = await OverlaySetting.findOne({ where: { userId: req.user.id } });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const [setting, created] = await OverlaySetting.upsert({
      ...req.body,
      userId: req.user.id
    });
    res.json({ message: "Settings updated successfully", data: setting });
  } catch (err) {
    res.status(400).json({ message: "Update failed" });
  }
};

// Mengambil profil streamer untuk Halaman Donasi (berdasarkan username)
exports.getPublicProfile = async (req, res) => {
  try {
    const user = await User.findOne({ 
      where: { username: req.params.username },
      attributes: ['id', 'username'], // Jangan kirim email/password!
      include: [{ model: OverlaySetting }]
    });
    
    if (!user) return res.status(404).json({ message: "Streamer tidak ditemukan" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Mengambil setting untuk OBS (berdasarkan overlayToken)
exports.getOverlaySettings = async (req, res) => {
  try {
    const user = await User.findOne({ 
      where: { overlayToken: req.params.token },
      include: [{ model: OverlaySetting }]
    });
    
    if (!user) return res.status(404).json({ message: "Token tidak valid" });
    res.json(user.OverlaySetting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};