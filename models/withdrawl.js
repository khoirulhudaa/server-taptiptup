module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Withdrawal', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    // 'BANK', 'DANA', 'GOPAY'
    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // Kode Bank (BCA/BNI/MANDIRI) atau E-Wallet (DANA/OVO/GOPAY)
    channelCode: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    accountName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'COMPLETED', 'FAILED'),
      defaultValue: 'PENDING',
    },
    // Ini adalah externalId yang kita kirim ke Xendit (format: wd-userId-timestamp)
    // Xendit akan kirim balik nilai ini di webhook sebagai `external_id`
    xenditReference: {
      type: DataTypes.STRING,
      unique: true, // Harus unik untuk idempotency
    },
  });
};