module.exports = (sequelize, DataTypes) => {
  const OverlaySetting = sequelize.define('OverlaySetting', {
    userId: { 
        type: DataTypes.INTEGER, 
        allowNull: false 
    },
    minDonate: { 
        type: DataTypes.DECIMAL(10, 2), 
        defaultValue: 10000 
    },
    maxDonate: { 
        type: DataTypes.DECIMAL(10, 2), 
        defaultValue: 10000000 
    },
    overlayTheme: { 
        type: DataTypes.STRING, 
        defaultValue: 'modern' 
    }, 
    backgroundColor: { 
        type: DataTypes.STRING, 
        defaultValue: '#ffffff' 
    },
    textColor: { 
        type: DataTypes.STRING, 
        defaultValue: '#000000' 
    },
    animationType: { 
        type: DataTypes.STRING, 
        defaultValue: 'fade' 
    },
    duration: { 
        type: DataTypes.INTEGER, 
        defaultValue: 5000 
    }, 
    soundUrl: { 
        type: DataTypes.STRING 
    },
    customCss: { 
        type: DataTypes.TEXT 
    } 
  });
  return OverlaySetting;
};