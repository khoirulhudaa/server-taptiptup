// // server.js
// require('dotenv').config();
// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');
// const cors = require('cors');
// const { sequelize } = require('./models');

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: { origin: "*" }
// });

// io.on('connection', (socket) => {
//   socket.on('join-overlay', (token) => {
//     socket.join(token);
//   });
// });

// app.use(cors());
// app.use(express.json());
// app.set('socketio', io);

// // Import Routes
// const overlayRoutes = require('./routers/overlayRouter');
// const midtransRoutes = require('./routers/midtransRouter'); // Buat file ini
// const authRoutes = require('./routers/authRouter'); // Buat file ini

// // Gunakan Routes
// app.use('/api/overlay', overlayRoutes);
// app.use('/api/midtrans', midtransRoutes);
// app.use('/api/auth', authRoutes);

// // Sync Database & Jalankan Server
// const PORT = process.env.PORT || 5101;
// sequelize.sync({ alter: false }).then(() => {
//   console.log('Database Synced');
//   server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// });


require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/database'); // ← connectDB, bukan sequelize

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  // Tambah keduanya biar aman
  socket.on('join-room', (token) => {
    socket.join(token);
    console.log(`Client joined room: ${token}`);
  });
  
  socket.on('join-overlay', (token) => {
    socket.join(token);
    console.log(`Overlay joined room: ${token}`);
  });
});

app.use(cors());
app.use(express.json());
app.set('socketio', io);

// Import Routes
const overlayRoutes  = require('./routers/overlayRouter');
const midtransRoutes = require('./routers/midtransRouter');
const authRoutes     = require('./routers/authRouter');
const donationRoutes     = require('./routers/donationRouter');
const followRoutes = require('./routers/followRouter');

// ✅ Testing route
app.get('/testing', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running!',
    node_env: process.env.NODE_ENV,
  });
});

// Gunakan Routes
app.use('/api/overlay',   overlayRoutes);
app.use('/api/midtrans',  midtransRoutes);
app.use('/api/auth',      authRoutes);
app.use('/api/donations',      donationRoutes);
app.use('/api/follows', followRoutes);

// Koneksi ke MongoDB lalu jalankan server
const PORT = process.env.PORT || 5101;

connectDB().then(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});