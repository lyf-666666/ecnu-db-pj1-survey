const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { hashPassword, verifyPassword } = require('../services/password');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;

router.post('/register', async (req, res, next) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: '用户名需为 3-20 位字母、数字、下划线或汉字' });
    }
    if (password.length < 6 || password.length > 64) {
      return res.status(400).json({ error: '密码长度需在 6 到 64 位之间' });
    }

    const users = getDb().collection('users');
    const exists = await users.findOne({ username });
    if (exists) {
      return res.status(409).json({ error: '用户名已被占用' });
    }

    const result = await users.insertOne({
      username,
      passwordHash: hashPassword(password),
      createdAt: new Date(),
      lastLoginAt: new Date()
    });

    req.session.userId = result.insertedId.toString();
    res.status(201).json({ user: { id: result.insertedId, username } });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: '用户名已被占用' });
    }
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    const user = await getDb().collection('users').findOne({ username });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    await getDb().collection('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    req.session.userId = user._id.toString();
    res.json({ user: { id: user._id, username: user.username } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('survey.sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res, next) => {
  try {
    if (!req.session.userId || !ObjectId.isValid(req.session.userId)) {
      return res.status(401).json({ error: '未登录' });
    }
    const user = await getDb()
      .collection('users')
      .findOne({ _id: new ObjectId(req.session.userId) }, { projection: { passwordHash: 0 } });
    if (!user) return res.status(401).json({ error: '未登录' });
    res.json({ user: { id: user._id, username: user.username, createdAt: user.createdAt } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
