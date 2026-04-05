const mongoose = require('mongoose');

// ── User ──────────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  avatar:    { type: String, default: '' },
  friends:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastSeen:  { type: Date, default: Date.now },
  online:    { type: Boolean, default: false },
}, { timestamps: true });

// ── Message ───────────────────────────────────────────────────────────────────
const messageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  sender:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:     { type: String, enum: ['text', 'image', 'video', 'voice'], default: 'text' },
  content:  { type: String, default: '' },   // text or file path
  fileName: { type: String, default: '' },
  read:     { type: Boolean, default: false },
}, { timestamps: true });

module.exports = {
  User:    mongoose.model('User',    userSchema),
  Message: mongoose.model('Message', messageSchema),
};
