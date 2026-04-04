const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = require('./user')(sequelize, DataTypes);
const Donation = require('./donation')(sequelize, DataTypes);
const OverlaySetting = require('./overlaySetting')(sequelize, DataTypes);
const Withdrawal = require('./withdrawl')(sequelize, DataTypes);

// Definisi Relasi
User.hasOne(OverlaySetting, { foreignKey: 'userId' });
OverlaySetting.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Donation, { foreignKey: 'userId' });
Donation.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Withdrawal, { foreignKey: 'userId' });
Withdrawal.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  Donation,
  OverlaySetting,
  Withdrawal
};