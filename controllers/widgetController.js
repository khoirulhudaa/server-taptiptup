const { User, Donation, Milestone, OverlaySetting } = require('../models');

// Helper ambil user by token (untuk OBS URL pakai token seperti overlay)
const getUserByToken = async (token) => {
  return await User.findOne({ overlayToken: token }).lean();
};

// ─── MILESTONES WIDGET ────────────────────────────────────────────────────────
exports.milestones = async (req, res) => {
  // Support dua mode: /widget/:token/milestones (OBS) dan query ?username=x
  const user = await getUserByToken(req.params.username) 
    || await User.findOne({ username: req.params.username }).lean();
  if (!user) return res.status(404).send('Not found');

  const milestones = await Milestone.find({ userId: user._id }).sort('order').lean();
  const agg = await Donation.aggregate([
    { $match: { userId: user._id, status: 'PAID' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const totalPaid = agg[0]?.total || 0;

  const enriched = milestones.map(m => ({
    ...m,
    currentAmount: Math.min(totalPaid, m.targetAmount),
    progress: Math.min(100, Math.round((totalPaid / m.targetAmount) * 100)),
    reached: totalPaid >= m.targetAmount,
  }));

  // Serve HTML langsung (untuk OBS Browser Source)
  res.send(renderMilestonesHTML(enriched, user.username, totalPaid));
};

// ─── LEADERBOARD WIDGET ───────────────────────────────────────────────────────
exports.leaderboard = async (req, res) => {
  const user = await getUserByToken(req.params.username)
    || await User.findOne({ username: req.params.username }).lean();
  if (!user) return res.status(404).send('Not found');

  // Ambil settings leaderboard
  const setting = await OverlaySetting.findOne({ userId: user._id }).lean();
  const limit        = setting?.leaderboardLimit      || 10;
  const showAmount   = setting?.leaderboardShowAmount !== false;
  const period       = setting?.leaderboardPeriod     || 'alltime';

  // Filter tanggal jika 'today'
  const matchExtra = {};
  if (period === 'today') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    matchExtra.createdAt = { $gte: startOfDay };
  }

  const donors = await Donation.aggregate([
    { $match: { userId: user._id, status: 'PAID', ...matchExtra } },
    { $group: { _id: '$donorName', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { totalAmount: -1 } },
    { $limit: limit },
    { $project: { name: '$_id', totalAmount: 1, count: 1, _id: 0 } },
  ]);

  res.send(renderLeaderboardHTML(donors, user.username, showAmount));
};

// ─── QRCODE WIDGET ────────────────────────────────────────────────────────────
exports.qrcode = async (req, res) => {
  const user = await getUserByToken(req.params.username)
    || await User.findOne({ username: req.params.username }).lean();
  if (!user) return res.status(404).send('Not found');

  const donateUrl = `${process.env.FRONTEND_URL || 'https://dukungin.com'}/${user.username}`;
  res.send(renderQrCodeHTML(donateUrl, user.username));
};

// ─── HTML RENDERERS ───────────────────────────────────────────────────────────

const renderMilestonesHTML = (milestones, username, totalPaid) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: transparent; 
      font-family: 'Segoe UI', sans-serif;
      padding: 16px;
      width: 400px;
    }
    .title {
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5);
      margin-bottom: 14px;
    }
    .milestone {
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 14px 16px;
      margin-bottom: 10px;
      animation: fadeIn 0.4s ease forwards;
    }
    .milestone.reached {
      border-color: rgba(99,246,147,0.4);
      background: rgba(99,246,147,0.08);
    }
    .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .label { font-size: 13px; font-weight: 800; color: #fff; }
    .badge {
      font-size: 9px; font-weight: 900; text-transform: uppercase;
      letter-spacing: 0.07em; padding: 3px 8px; border-radius: 20px;
    }
    .badge.reached { background: rgba(99,246,147,0.2); color: #6BF693; border: 1px solid rgba(99,246,147,0.3); }
    .badge.pending { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); border: 1px solid rgba(255,255,255,0.1); }
    .track { height: 6px; background: rgba(255,255,255,0.1); border-radius: 99px; overflow: hidden; }
    .fill { height: 100%; border-radius: 99px; transition: width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1); }
    .fill.reached { background: linear-gradient(90deg, #6BF693, #22c55e); }
    .fill.pending { background: linear-gradient(90deg, #818cf8, #6366f1); }
    .amounts { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.45); }
    @keyframes fadeIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
  </style>
  <script>
    // Auto-refresh setiap 30 detik
    setTimeout(() => location.reload(), 30000);
  </script>
</head>
<body>
  <div class="title">🎯 Milestones @${username}</div>
  ${milestones.length === 0 
    ? `<div style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:20px;">Belum ada milestone</div>`
    : milestones.map((m, i) => `
    <div class="milestone ${m.reached ? 'reached' : ''}" style="animation-delay:${i * 0.1}s">
      <div class="row">
        <span class="label">${m.title}</span>
        <span class="badge ${m.reached ? 'reached' : 'pending'}">${m.reached ? '✓ Tercapai' : `${m.progress}%`}</span>
      </div>
      <div class="track">
        <div class="fill ${m.reached ? 'reached' : 'pending'}" style="width:${m.progress}%"></div>
      </div>
      <div class="amounts">
        <span>Rp ${m.currentAmount.toLocaleString('id-ID')}</span>
        <span>Target: Rp ${m.targetAmount.toLocaleString('id-ID')}</span>
      </div>
    </div>`).join('')}
</body>
</html>`;

const renderLeaderboardHTML = (donors, username) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; font-family: 'Segoe UI', sans-serif; padding: 16px; width: 360px; }
    .title { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.5); margin-bottom: 14px; }
    .item {
      display: flex; align-items: center; gap: 12px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px; padding: 10px 14px;
      margin-bottom: 8px;
      animation: slideIn 0.4s ease forwards;
      opacity: 0;
    }
    .item.gold { background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.3); }
    .item.silver { background: rgba(148,163,184,0.12); border-color: rgba(148,163,184,0.25); }
    .item.bronze { background: rgba(251,146,60,0.12); border-color: rgba(251,146,60,0.25); }
    .rank { width: 28px; height: 28px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; background: rgba(255,255,255,0.08); }
    .info { flex: 1; min-width: 0; }
    .name { font-size: 13px; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .count { font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; margin-top: 1px; }
    .amount { font-size: 12px; font-weight: 900; color: #818cf8; flex-shrink: 0; }
    .item.gold .amount { color: #fbbf24; }
    .item.silver .amount { color: #94a3b8; }
    .item.bronze .amount { color: #fb923c; }
    @keyframes slideIn { from { opacity:0; transform: translateX(-12px); } to { opacity:1; transform: translateX(0); } }
  </style>
  <script>setTimeout(() => location.reload(), 60000);</script>
</head>
<body>
  <div class="title">🏆 Leaderboard @${username}</div>
  ${donors.length === 0
    ? `<div style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:20px;">Belum ada donor</div>`
    : donors.map((d, i) => {
        const cls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
        return `<div class="item ${cls}" style="animation-delay:${i*0.07}s">
          <div class="rank">${medal}</div>
          <div class="info">
            <div class="name">${d.name}</div>
            <div class="count">${d.count}x donasi</div>
          </div>
          <div class="amount">${showAmount ? `Rp ${d.totalAmount.toLocaleString('id-ID')}` : `${d.count}x donasi`}</div>
        </div>`;
      }).join('')}
</body>
</html>`;

const renderQrCodeHTML = (donateUrl, username) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; font-family: 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; width: 280px; padding: 12px; }
    .card {
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 24px;
      padding: 20px;
      text-align: center;
      width: 100%;
    }
    .label { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.45); margin-bottom: 14px; }
    .qr-wrap { background: #fff; border-radius: 16px; padding: 12px; display: inline-block; margin-bottom: 14px; }
    .qr-wrap img { display: block; width: 160px; height: 160px; }
    .url { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.6); word-break: break-all; }
    .username { font-size: 16px; font-weight: 900; color: #fff; margin-bottom: 4px; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
    .dot { display: inline-block; width: 6px; height: 6px; background: #4ade80; border-radius: 50; margin-right: 5px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="label"><span class="dot pulse"></span>Scan untuk Donasi</div>
    <div class="qr-wrap">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(donateUrl)}&color=0f172a&format=svg&margin=0" />
    </div>
    <div class="username">@${username}</div>
    <div class="url">${donateUrl}</div>
  </div>
</body>
</html>`;