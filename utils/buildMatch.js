const buildMatch = (period, userId, periodSince) => {
  const base = { userId: new mongoose.Types.ObjectId(userId), status: 'PAID' };
  const now = new Date();

  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { ...base, createdAt: { $gte: start } };
  }
  if (period === 'thismonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { ...base, createdAt: { $gte: start } };
  }
  if (period === 'since' && periodSince) {
    // Mulai dari jam 00:00:00 pada tanggal yang dipilih
    const start = new Date(periodSince);
    start.setHours(0, 0, 0, 0);
    return { ...base, createdAt: { $gte: start } };
  }
  return base; // alltime
};