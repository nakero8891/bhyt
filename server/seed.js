// server/seed.js — Tạo tài khoản mặc định
// Chạy bằng: /usr/local/bin/node server/seed.js
// Hoặc dùng cPanel > Setup Node.js App > Run Script
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const pool   = require('./db');

const ACCOUNTS = [
  { username: 'admin',   password: 'Admin@2026',  role: 'admin', name: 'Sở Nội vụ Sơn La', xa: null },
];

async function seed() {
  console.log('Tao tai khoan mac dinh...');
  const conn = await pool.getConnection();
  try {
    for (const acc of ACCOUNTS) {
      const hash = await bcrypt.hash(acc.password, 10);
      await conn.execute(
        `INSERT INTO users (username, password, role, name, xa)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE password=VALUES(password), role=VALUES(role), name=VALUES(name), xa=VALUES(xa)`,
        [acc.username, hash, acc.role, acc.name, acc.xa]
      );
      console.log('OK: ' + acc.username + ' / ' + acc.password);
    }
    console.log('Seed hoan tat! Dang nhap bang admin / Admin@2026');
  } finally {
    conn.release();
    process.exit(0);
  }
}

seed().catch(err => { console.error('Loi:', err.message); process.exit(1); });
