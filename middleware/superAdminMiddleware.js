module.exports = (req, res, next) => {
  if (req.user?.role !== 'superAdmin' || req.user?.role !== 'streamerSuper') {
    return res.status(403).json({ message: 'Forbidden: SuperAdmin only' });
  }
  next();
};