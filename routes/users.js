const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const auth    = require('../middleware/auth');
const { User, Message } = require('../models');

// Multer setup
const storage = multer.diskStorage({
  destination: 'public/uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Search user
router.get('/search/:username', auth, async (req, res) => {
  try {
    const users = await User.find({
      username: { $regex: req.params.username, $options: 'i' },
      _id: { $ne: req.user.id },
    }).select('username _id online lastSeen').limit(10);
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get my friends list
router.get('/friends', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('friends', 'username online lastSeen')
      .populate('friendRequests', 'username _id');
    res.json({ friends: user.friends, requests: user.friendRequests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send friend request
router.post('/friend-request/:targetId', auth, async (req, res) => {
  try {
    const target = await User.findById(req.params.targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.friendRequests.includes(req.user.id))
      return res.status(400).json({ error: 'Request already sent' });
    if (target.friends.includes(req.user.id))
      return res.status(400).json({ error: 'Already friends' });
    target.friendRequests.push(req.user.id);
    await target.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Accept / reject friend request
router.post('/friend-request/:senderId/accept', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id);
    const sender = await User.findById(req.params.senderId);
    me.friendRequests = me.friendRequests.filter(id => id.toString() !== req.params.senderId);
    me.friends.push(sender._id);
    sender.friends.push(me._id);
    await me.save(); await sender.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/friend-request/:senderId/reject', auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { friendRequests: req.params.senderId }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get conversation messages
router.get('/messages/:friendId', auth, async (req, res) => {
  try {
    const ids = [req.user.id, req.params.friendId].sort();
    const convId = ids.join('_');
    const msgs = await Message.find({ conversationId: convId })
      .sort({ createdAt: 1 }).limit(100)
      .populate('sender', 'username');
    // Mark as read
    await Message.updateMany(
      { conversationId: convId, sender: req.params.friendId, read: false },
      { $set: { read: true } }
    );
    res.json(msgs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload media
router.post('/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ path: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// Me
router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.json(user);
});

module.exports = router;
