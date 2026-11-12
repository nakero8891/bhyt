// server/db.js - Kết nối MySQL pool
'use strict';
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:            process.env.DB_HOST     || 'localhost',
  port:            parseInt(process.env.DB_PORT || '3306'),
  database:        process.env.DB_NAME,
  user:            process.env.DB_USER,
  password:        process.env.DB_PASS,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit:      0,
  charset:         'utf8mb4',
  timezone:        '+07:00',
  connectTimeout:  10000,
});

// Test kết nối khi khởi động và log lỗi rõ ràng
pool.getConnection()
  .then(conn => {
    console.log('[DB] Ket noi MySQL thanh cong:', process.env.DB_HOST, '/', process.env.DB_NAME);
    conn.release();
  })
  .catch(e => {
    console.error('[DB] LOI KET NOI:', e.message);
    console.error('[DB] Config:', {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
    });
  });

module.exports = pool;
