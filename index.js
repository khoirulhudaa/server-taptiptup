// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { sequelize } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

io.on('connection', (socket) => {
  socket.on('join-overlay', (token) => {
    socket.join(token);
  });
});

app.use(cors());
app.use(express.json());
app.set('socketio', io);

// Import Routes
const overlayRoutes = require('./routers/overlayRouter');
const xenditRoutes = require('./routers/xenditRouter'); // Buat file ini
const authRoutes = require('./routers/authRouter'); // Buat file ini

// Gunakan Routes
app.use('/api/overlay', overlayRoutes);
app.use('/api/xendit', xenditRoutes);
app.use('/api/auth', authRoutes);

// Sync Database & Jalankan Server
const PORT = process.env.PORT || 5101;
sequelize.sync({ alter: false }).then(() => {
  console.log('Database Synced');
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});