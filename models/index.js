const User         = require('./user');
const Donation     = require('./donation');
const OverlaySetting = require('./overlaySetting');
const Withdrawal   = require('./withdrawl');
const Follow         = require('./follow'); // ← tambah ini
const Milestone         = require('./milestone'); // ← tambah ini
const BannedWord = require('./bannedWord');

module.exports = {
  User,
  Donation,
  OverlaySetting,
  Withdrawal,
  Follow,
  Milestone,
  BannedWord
};