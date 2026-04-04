module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Donation', {
    externalId: { type: DataTypes.STRING, unique: true }, // ID dari Xendit (Invoice ID)
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    donorName: { type: DataTypes.STRING, defaultValue: 'Anonim' },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    message: { type: DataTypes.TEXT },
    status: { type: DataTypes.ENUM('PENDING', 'PAID', 'EXPIRED'), defaultValue: 'PENDING' },
    paymentUrl: { type: DataTypes.STRING } // Link invoice Xendit
  });
};