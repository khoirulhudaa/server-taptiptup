const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    username: { 
      type: DataTypes.STRING, 
      unique: true, 
      allowNull: false 
    },
    email: { 
      type: DataTypes.STRING, 
      unique: true, 
      allowNull: false,
      validate: { isEmail: true }
    },
    resetToken: DataTypes.STRING,
    resetTokenExpired: DataTypes.DATE,
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    verifyPin: DataTypes.STRING,
    verifyPinExpired: DataTypes.DATE,
    password: { 
      type: DataTypes.STRING, 
      allowNull: false 
    },
    walletBalance: { 
      type: DataTypes.DECIMAL(15, 2), 
      defaultValue: 0 
    },
    overlayToken: { 
      type: DataTypes.STRING, 
      unique: true 
    }
  }, {
    hooks: {
      // Menggunakan hooks lebih bersih daripada setter untuk hashing password
      beforeCreate: async (user) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      }
    }
  });

  // Method prototype untuk validasi password
  User.prototype.validPassword = function(password) {
    return bcrypt.compareSync(password, this.password);
  };

  return User;
};