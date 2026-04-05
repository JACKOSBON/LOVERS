require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const mongoose  = require('mongoose');
const jwt       = require('jsonwebtoken');
const path      = require('path');
const fs        = require('fs');
const { Message, User } = require('./models');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));

// Ensure uploads dir
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// Serve frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const onlineUsers = new Map(); // userId → socketId

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { next(new Error('Auth failed')); }
});

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);

  await User.findByIdAndUpdate(userId, { online: true, lastSeen: new Date() });
  io.emit('user_online', { userId, online: true });

  // Join personal room
  socket.join(userId);

  // ── Send message ────────────────────────────────────────────────────────────
  socket.on('send_message', async (data) => {
    try {
      const { toUserId, type, content, fileName } = data;
      const ids  = [userId, toUserId].sort();
      const convId = ids.join('_');

      const msg = await Message.create({
        conversationId: convId,
        sender: userId,
        type:   type || 'text',
        content,
        fileName: fileName || '',
      });

      const populated = await msg.populate('sender', 'username');

      // Send to both users
      io.to(toUserId).emit('new_message', { ...populated.toObject(), conversationId: convId });
      io.to(userId).emit('new_message',   { ...populated.toObject(), conversationId: convId });
    } catch (e) {
      socket.emit('error', e.message);
    }
  });

  // ── Typing indicator ────────────────────────────────────────────────────────
  socket.on('typing', ({ toUserId, typing }) => {
    io.to(toUserId).emit('typing', { fromUserId: userId, typing });
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    onlineUsers.delete(userId);
    await User.findByIdAndUpdate(userId, { online: false, lastSeen: new Date() });
    io.emit('user_online', { userId, online: false });
  });
});

// ── DB + Start ─────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
  })
  .catch(err => { console.error('MongoDB error:', err); process.exit(1); });
