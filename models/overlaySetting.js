// module.exports = (sequelize, DataTypes) => {
//   const OverlaySetting = sequelize.define('OverlaySetting', {
//     userId: { 
//         type: DataTypes.INTEGER, 
//         allowNull: false 
//     },
//     minDonate: { 
//         type: DataTypes.DECIMAL(10, 2), 
//         defaultValue: 10000 
//     },
//     maxDonate: { 
//         type: DataTypes.DECIMAL(10, 2), 
//         defaultValue: 10000000 
//     },
//     overlayTheme: { 
//         type: DataTypes.STRING, 
//         defaultValue: 'modern' 
//     }, 
//     backgroundColor: { 
//         type: DataTypes.STRING, 
//         defaultValue: '#ffffff' 
//     },
//     textColor: { 
//         type: DataTypes.STRING, 
//         defaultValue: '#000000' 
//     },
//     animationType: { 
//         type: DataTypes.STRING, 
//         defaultValue: 'fade' 
//     },
//     duration: { 
//         type: DataTypes.INTEGER, 
//         defaultValue: 5000 
//     }, 
//     soundUrl: { 
//         type: DataTypes.STRING 
//     },
//     customCss: { 
//         type: DataTypes.TEXT 
//     } 
//   });
//   return OverlaySetting;
// };

const mongoose = require('mongoose');

// models/overlaySetting.js
const overlaySettingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    minDonate: { type: Number, default: 10000 },
    maxDonate: { type: Number, default: 10000000 },
    theme: { type: String, default: 'modern' },           // ← ganti overlayTheme
    primaryColor: { type: String, default: '#6366f1' },   // ← ganti backgroundColor
    textColor: { type: String, default: '#ffffff' },
    animation: { type: String, default: 'bounce' },       // ← ganti animationType
    baseDuration: { type: Number, default: 5 },           // ← ganti duration
    extraPerAmount: { type: Number, default: 10000 },     // ← tambah
    extraDuration: { type: Number, default: 1 },          // ← tambah
    soundUrl: String,
    customCss: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('OverlaySetting', overlaySettingSchema);