// server/auth.js - Middleware xác thực JWT
'use strict';
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'change_me_in_production';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

function verify(token) {
  return jwt.verify(token, SECRET);
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    req.user = verify(token);
    next();
  } catch {
    res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Không có quyền truy cập' });
    next();
  });
}

module.exports = { sign, verify, requireAuth, requireAdmin };
