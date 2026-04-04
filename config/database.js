// config/database.js
const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'db_donate', 
  process.env.DB_USER || 'root', 
  process.env.DB_PASS || '', 
  {
    host: process.env.DB_HOST || '127.0.0.1',
    dialect: 'mysql',
    logging: false, // Set true jika ingin lihat query SQL di terminal
  }
);

module.exports = sequelize;