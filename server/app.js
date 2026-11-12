// server/app.js - BHYT Express API v4.3
'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const pool    = require('./db');
const { sign, requireAuth, requireAdmin } = require('./auth');
const { sendMail, mailApproved, mailReturned } = require('./mailer');

const app = express();
const NAM = parseInt(process.env.NAM || '2026');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
const requireViewer = (req, res, next) => {
  requireAuth(req, res, () => {
    // admin, bhxh: xem tất cả; xa: xem được nhưng bị giới hạn theo xa của mình (check trong từng route)
    if (['admin', 'bhxh', 'xa'].includes(req.user.role)) return next();
    res.status(403).json({ error: 'Không có quyền truy cập' });
  });
};
// ── MIGRATION ────────────────────────────────────────────────────────────────
async function colExists(table, col) {
  try {
    const [r] = await pool.execute(
      'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
      [table, col]
    );
    return r.length > 0;
  } catch(e) { return false; }
}

async function runMigrations() {
  try {
    const cols = [
      ['users',      'link', "VARCHAR(500) DEFAULT ''"],
      ['don_vi_cfg', 'cv',   "VARCHAR(100) DEFAULT ''"],
      ['don_vi_cfg', 'sdt',  "VARCHAR(20)  DEFAULT ''"],
      ['bienban',    'note',           'TEXT NULL'],
      ['bienban',    'prr',            'TEXT NULL'],
      ['bienban',    'note_history',   'JSON NULL'],
      ['bienban',    'return_history', 'JSON NULL'],
      ['don_vi_cfg', 'email',          "VARCHAR(200) DEFAULT ''"],
    ];
    for (const [tbl, col, def] of cols) {
      try {
        if (!(await colExists(tbl, col))) {
          await pool.execute(`ALTER TABLE \`${tbl}\` ADD COLUMN \`${col}\` ${def}`);
          console.log(`[migration] Added ${tbl}.${col}`);
        }
      } catch(e) { console.error(`[migration] skip ${tbl}.${col}: ${e.message}`); }
    }
    // Tạo bảng thông báo cấp kinh phí nếu chưa có
    await pool.execute(`CREATE TABLE IF NOT EXISTS thong_bao_cap (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      xa          VARCHAR(100) NOT NULL,
      thang       TINYINT NOT NULL,
      nam         SMALLINT NOT NULL,
      muc_I       BIGINT DEFAULT 0 COMMENT 'KP cap Muc I (Nguồn ưu đãi NCC)',
      muc_II      BIGINT DEFAULT 0 COMMENT 'KP cap Muc II (Nguồn DBXH)',
      ghi_chu     TEXT NULL,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_xa_thang_nam (xa, thang, nam)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS quy_lock (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      quy        ENUM('I','II','III','IV') NOT NULL,
      nam        SMALLINT NOT NULL,
      locked     TINYINT(1) NOT NULL DEFAULT 1,
      locked_by  VARCHAR(50) DEFAULT '',
      locked_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_quy_nam (quy, nam)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('[migration] quy_lock ready');
    console.log('[migration] thong_bao_cap ready');
    console.log('[migration] done');
  } catch(e) { console.error('[migration] fatal (non-crash):', e.message); }
}

// Chạy migration sau 3 giây để chắc chắn pool đã sẵn sàng
// Bọc trong try/catch để KHÔNG BAO GIỜ crash Passenger
setTimeout(function() {
  runMigrations().catch(function(e) {
    console.error('[migration] unhandled (non-crash):', e.message);
  });
}, 3000);

// ── API DEBUG (dùng /api/debug để không bị static file chặn) ────────────────
app.get('/api/debug', async (req, res) => {
  const out = { node: process.version, nam: NAM, db_name: process.env.DB_NAME || '?' };
  try {
    await pool.execute('SELECT 1');
    out.db = 'OK';
  } catch(e) { out.db = 'ERROR: ' + e.message; }

  for (const [tbl, col] of [['users','link'],['don_vi_cfg','cv'],['don_vi_cfg','sdt']]) {
    try { out[`${tbl}.${col}`] = (await colExists(tbl, col)) ? 'OK' : 'MISSING — upload server/app.js moi va Restart'; }
    catch(e) { out[`${tbl}.${col}`] = 'ERR'; }
  }
  try {
    const [[r]] = await pool.execute("SELECT COUNT(*) c FROM users WHERE role='xa'");
    out.xa_users = r.c;
    const [[r2]] = await pool.execute("SELECT COUNT(*) c FROM don_vi_cfg WHERE cv != '' AND cv IS NOT NULL");
    out.cfg_with_cv = r2.c;
    const [[r3]] = await pool.execute("SELECT COUNT(*) c FROM bienban WHERE status='pending'");
    out.bienban_pending = r3.c;
    const [[r4]] = await pool.execute("SELECT COUNT(*) c FROM bienban WHERE status='approved'");
    out.bienban_approved = r4.c;
    // Liệt kê bản ghi pending để dễ debug
    const [pendingList] = await pool.execute("SELECT xa, quy, nam, status, send_date FROM bienban WHERE status='pending' ORDER BY xa");
    out.pending_list = pendingList;
  } catch(e) { out.counts_error = e.message; }

  res.json(out);
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Thieu thong tin' });
    const [rows] = await pool.execute('SELECT * FROM users WHERE username=? AND active=1', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Tai khoan hoac mat khau khong dung' });
    const token = sign({ id: user.id, username: user.username, role: user.role, name: user.name, xa: user.xa });
    res.json({ token, user: { username: user.username, role: user.role, name: user.name, xa: user.xa } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Loi server: ' + e.message }); }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Mat khau moi phai co it nhat 6 ky tu' });
    const [rows] = await pool.execute('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(oldPassword, rows[0].password)))
      return res.status(401).json({ error: 'Mat khau hien tai khong dung' });
    await pool.execute('UPDATE users SET password=? WHERE id=?', [await bcrypt.hash(newPassword, 10), req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id,username,role,name,xa,link,active FROM users ORDER BY role,xa');
    res.json(rows.map(r => ({ ...r, link: r.link || '' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, name, xa } = req.body || {};
    if (!username || !password || !name || !xa) return res.status(400).json({ error: 'Thieu thong tin' });
    const hash = await bcrypt.hash(password, 10);
    await pool.execute("INSERT INTO users (username,password,role,name,xa) VALUES (?,?,'xa',?,?)", [username, hash, name, xa]);
    res.json({ ok: true });
  } catch(e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Tai khoan da ton tai' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users/reset-password', requireAdmin, async (req, res) => {
  try {
    const { username, newPassword } = req.body || {};
    if (!username || !newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Du lieu khong hop le' });
    const [r] = await pool.execute('UPDATE users SET password=? WHERE username=?', [await bcrypt.hash(newPassword, 10), username]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Khong tim thay' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:username/toggle', requireAdmin, async (req, res) => {
  try {
    await pool.execute('UPDATE users SET active=1-active WHERE username=?', [req.params.username]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/users/:username/link — admin gán link Drive cho xã
app.put('/api/users/:username/link', requireAdmin, async (req, res) => {
  try {
    const { link } = req.body || {};
    const [r] = await pool.execute("UPDATE users SET link=? WHERE username=? AND role='xa'", [link || '', req.params.username]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Khong tim thay tai khoan xa' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users/links-bulk — admin gán link hàng loạt
app.post('/api/users/links-bulk', requireAdmin, async (req, res) => {
  try {
    const { links } = req.body || {};
    if (!Array.isArray(links)) return res.status(400).json({ error: 'links phai la array' });
    let updated = 0;
    for (const item of links) {
      if (!item.xa) continue;
      const [r] = await pool.execute("UPDATE users SET link=? WHERE xa=? AND role='xa'", [item.link || '', item.xa]);
      if (r.affectedRows > 0) updated++;
    }
    res.json({ ok: true, updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users/all-links — tất cả link (admin)
app.get('/api/users/all-links', requireViewer, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT username,name,xa,link FROM users WHERE role='xa' ORDER BY xa");
    res.json(rows.map(r => ({ ...r, link: r.link || '' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mylink — xã lấy link của mình
app.get('/api/mylink', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT link FROM users WHERE id=?', [req.user.id]);
    res.json({ link: rows[0]?.link || '' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CFG — /api/cfg/all PHẢI TRƯỚC /api/cfg/:xa ───────────────────────────────
app.get('/api/cfg/all', requireViewer, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT u.xa, u.username, u.link,
             COALESCE(d.bhxh_cs_name,'') AS bhxh_cs_name,
             COALESCE(d.cv,'')           AS cv,
             COALESCE(d.sdt,'')          AS sdt,
             COALESCE(d.email,'')        AS email
      FROM users u
      LEFT JOIN don_vi_cfg d ON d.xa = u.xa
      WHERE u.role='xa'
      ORDER BY u.xa
    `);
    res.json(rows.map(r => ({ ...r, link: r.link || '', cv: r.cv || '', sdt: r.sdt || '', email: r.email || '' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/cfg/:xa', requireAuth, async (req, res) => {
  try {
    const xa = decodeURIComponent(req.params.xa);
    if (req.user.role !== 'admin' && req.user.xa !== xa) return res.status(403).json({ error: 'Khong co quyen' });
    // Lấy link từ users
    const [uRows] = await pool.execute('SELECT link FROM users WHERE xa=?', [xa]);
    const link = uRows[0]?.link || '';
    // Lấy cfg
    const [rows] = await pool.execute('SELECT * FROM don_vi_cfg WHERE xa=?', [xa]);
    if (!rows[0]) return res.json({ xa, bhxh_cs_name: '', bhxh_list: [], ubnd_list: [], cv: '', sdt: '', email: '', link });
    const cfg = rows[0];
    cfg.bhxh_list = JSON.parse(cfg.bhxh_list || '[]');
    cfg.ubnd_list = JSON.parse(cfg.ubnd_list || '[]');
    cfg.cv    = cfg.cv    || '';
    cfg.sdt   = cfg.sdt   || '';
    cfg.email = cfg.email || '';
    cfg.link  = link;
    res.json(cfg);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cfg/:xa', requireAuth, async (req, res) => {
  try {
    const xa = decodeURIComponent(req.params.xa);
    if (req.user.role !== 'admin' && req.user.xa !== xa) return res.status(403).json({ error: 'Khong co quyen' });
    const { bhxh_cs_name, bhxh_list, ubnd_list, cv, sdt, email } = req.body || {};
    await pool.execute(
      `INSERT INTO don_vi_cfg (xa, bhxh_cs_name, bhxh_list, ubnd_list, cv, sdt, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bhxh_cs_name = VALUES(bhxh_cs_name),
         bhxh_list    = VALUES(bhxh_list),
         ubnd_list    = VALUES(ubnd_list),
         cv           = VALUES(cv),
         sdt          = VALUES(sdt),
         email        = VALUES(email)`,
      [xa, bhxh_cs_name || '', JSON.stringify(bhxh_list || []), JSON.stringify(ubnd_list || []), cv || '', sdt || '', email || '']
    );
    res.json({ ok: true });
  } catch(e) {
    console.error('[cfg post]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── BIÊN BẢN ─────────────────────────────────────────────────────────────────

// Lấy email của xã từ don_vi_cfg (trả về '' nếu không có)
async function getXaEmail(xa) {
  try {
    const [rows] = await pool.execute('SELECT email FROM don_vi_cfg WHERE xa=?', [xa]);
    return (rows[0]?.email || '').trim();
  } catch(e) {
    console.error('[getXaEmail]', e.message);
    return '';
  }
}

async function getBienBan(xa, quy, nam) {
  const [bbs] = await pool.execute('SELECT * FROM bienban WHERE xa=? AND quy=? AND nam=?', [xa, quy, nam]);
  if (!bbs[0]) return null;
  const [details] = await pool.execute('SELECT * FROM bienban_chitiet WHERE bienban_id=? ORDER BY thang,doi_tuong', [bbs[0].id]);
  const mths = {};
  for (const d of details) {
    if (!mths[d.thang]) mths[d.thang] = {};
    mths[d.thang][d.doi_tuong] = { dk:d.dk, pt:d.pt, pg:d.pg, tt:d.tt, thu:d.thu, bs:d.bs, cap:d.cap, nsnn:d.nsnn };
  }
  return { xa:bbs[0].xa, q:bbs[0].quy, nam:bbs[0].nam, st:bbs[0].status, sd:bbs[0].send_date,
    ad:bbs[0].approve_date, rr:bbs[0].return_reason, note:bbs[0].note||'',
    prr:bbs[0].prr||'',
    noteHistory: (() => { try { return JSON.parse(bbs[0].note_history||'[]'); } catch(e) { return []; } })(),
    returnHistory: (() => { try { return JSON.parse(bbs[0].return_history||'[]'); } catch(e) { return []; } })(),
    bxList:JSON.parse(bbs[0].bx_list||'[]'), ubList:JSON.parse(bbs[0].ub_list||'[]'), mths };
}

async function upsertCT(conn, bbId, mths) {
  for (const [thang, objs] of Object.entries(mths)) {
    for (const [dt, d] of Object.entries(objs)) {
      const nsnn = (d.tt||0)+(d.thu||0)+(d.bs||0)-(d.cap||0);
      await conn.execute(
        `INSERT INTO bienban_chitiet (bienban_id,thang,doi_tuong,dk,pt,pg,tt,thu,bs,cap,nsnn)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE dk=VALUES(dk),pt=VALUES(pt),pg=VALUES(pg),
           tt=VALUES(tt),thu=VALUES(thu),bs=VALUES(bs),cap=VALUES(cap),nsnn=VALUES(nsnn)`,
        [bbId, parseInt(thang), parseInt(dt), d.dk||0,d.pt||0,d.pg||0,d.tt||0,d.thu||0,d.bs||0,d.cap||0,nsnn]
      );
    }
  }
}

app.get('/api/bienban', requireViewer, async (req, res) => {
  try {
    const { xa, quy, nam = NAM } = req.query;
    if (!xa || !quy) return res.status(400).json({ error: 'Thieu xa hoac quy' });
    // Bhxh được xem tất cả
    if (req.user.role !== 'admin' && req.user.role !== 'bhxh' && req.user.xa !== xa) {
      return res.status(403).json({ error: 'Khong co quyen' });
    }
    res.json(await getBienBan(xa, quy, parseInt(nam)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bienban/all', requireViewer, async (req, res) => {
  try {
    const { quy, nam = NAM } = req.query;
    const where = ['nam=?']; 
    const params = [parseInt(nam)];
    if (quy) { where.push('quy=?'); params.push(quy); }
    const [bbs] = await pool.execute(
      `SELECT b.*, (
        SELECT SUM(c.tt + c.thu + c.bs - c.cap) 
        FROM bienban_chitiet c 
        WHERE c.bienban_id = b.id 
          AND c.thang = (
            CASE b.quy 
              WHEN 'I' THEN 3 
              WHEN 'II' THEN 6 
              WHEN 'III' THEN 9 
              WHEN 'IV' THEN 12 
            END
          )
      ) AS totalNsnn
      FROM bienban b 
      WHERE ${where.join(' AND ')} 
      ORDER BY send_date DESC`, 
      params
    );
    
    res.json(bbs.map(b => ({
      xa: b.xa, q: b.quy, nam: b.nam, st: b.status, sd: b.send_date, ad: b.approve_date,
      rr: b.return_reason, note: b.note || '',
      bxList: JSON.parse(b.bx_list || '[]'), ubList: JSON.parse(b.ub_list || '[]'), 
      totalNsnn: b.totalNsnn || 0
    })));
  } catch(e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('/api/bienban/detail', requireViewer, async (req, res) => {
  try {
    const { xa, quy, nam = NAM } = req.query;
    // Bhxh được xem tất cả xã
    if (req.user.role !== 'admin' && req.user.role !== 'bhxh' && req.user.xa !== xa) {
      return res.status(403).json({ error: 'Khong co quyen' });
    }
    const bb = await getBienBan(xa, quy, parseInt(nam));
    if (!bb) return res.status(404).json({ error: 'Khong tim thay' });
    res.json(bb);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══ KHÓA QUÝ (admin) ═══════════════════════════════════════════════════════
async function isQuyLocked(quy, nam) {
  try {
    const [r] = await pool.execute('SELECT locked FROM quy_lock WHERE quy=? AND nam=?', [quy, parseInt(nam)]);
    return !!(r[0] && r[0].locked);
  } catch(e) { return false; }
}
const LOCK_MSG = 'Quy nay da bi So Noi vu khoa, khong the chinh sua. Lien he So de duoc mo khoa.';

// GET /api/admin/lock-status?nam=2026 — mọi tài khoản đăng nhập đều xem được
app.get('/api/admin/lock-status', requireAuth, async (req, res) => {
  try {
    const nam = parseInt(req.query.nam || NAM);
    const [rows] = await pool.execute('SELECT quy, locked, locked_by, locked_at FROM quy_lock WHERE nam=?', [nam]);
    const map = {};
    ['I','II','III','IV'].forEach(q => { map[q] = { locked: false }; });
    rows.forEach(r => { map[r.quy] = { locked: !!r.locked, by: r.locked_by, at: r.locked_at }; });
    res.json({ nam, quys: map });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/lock-quy', requireAdmin, async (req, res) => {
  try {
    const { quy, nam = NAM } = req.body || {};
    if (!['I','II','III','IV'].includes(quy)) return res.status(400).json({ error: 'Quy khong hop le' });
    await pool.execute(
      'INSERT INTO quy_lock (quy,nam,locked,locked_by,locked_at) VALUES (?,?,1,?,NOW()) ON DUPLICATE KEY UPDATE locked=1, locked_by=VALUES(locked_by), locked_at=NOW()',
      [quy, parseInt(nam), req.user.username]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/unlock-quy', requireAdmin, async (req, res) => {
  try {
    const { quy, nam = NAM } = req.body || {};
    if (!['I','II','III','IV'].includes(quy)) return res.status(400).json({ error: 'Quy khong hop le' });
    await pool.execute(
      'INSERT INTO quy_lock (quy,nam,locked,locked_by,locked_at) VALUES (?,?,0,?,NOW()) ON DUPLICATE KEY UPDATE locked=0, locked_by=VALUES(locked_by), locked_at=NOW()',
      [quy, parseInt(nam), req.user.username]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bienban/save', requireAuth, async (req, res) => {
  const { xa, quy, nam = NAM, mths } = req.body || {};
  if (!xa || !quy || !mths) return res.status(400).json({ error: 'Thieu du lieu' });
  if (req.user.role !== 'admin' && req.user.xa !== xa) return res.status(403).json({ error: 'Khong co quyen' });
  if (req.user.role !== 'admin' && await isQuyLocked(quy, nam)) return res.status(403).json({ error: LOCK_MSG, locked: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Kiểm tra trạng thái hiện tại
    const [existing] = await conn.execute(
      'SELECT id, status FROM bienban WHERE xa=? AND quy=? AND nam=?',
      [xa, quy, parseInt(nam)]
    );
    if (existing[0] && existing[0].status === 'pending') {
      await conn.rollback();
      return res.status(403).json({
        error: 'Bien ban dang cho So Noi vu xac nhan. Lien he So de duoc tra ve neu can chinh sua.'
      });
    }
    // Tạo bản ghi mới nếu chưa có (status mặc định là returned để cho phép sửa)
    if (!existing[0]) {
      await conn.execute(
        "INSERT INTO bienban (xa,quy,nam,status) VALUES (?,?,?,'returned')",
        [xa, quy, parseInt(nam)]
      );
    }
    const [[bb]] = await conn.execute(
      'SELECT id FROM bienban WHERE xa=? AND quy=? AND nam=?',
      [xa, quy, parseInt(nam)]
    );
    await upsertCT(conn, bb.id, mths);
    await conn.commit();
    res.json({ ok: true });
  } catch(e) { await conn.rollback(); res.status(500).json({ error: e.message }); }
  finally { conn.release(); }
});

app.post('/api/bienban/send', requireAuth, async (req, res) => {
  const { xa, quy, nam = NAM, mths, bxList, ubList, note } = req.body || {};
  if (!xa || !quy || !mths) return res.status(400).json({ error: 'Thieu du lieu' });
  if (req.user.role !== 'admin' && req.user.xa !== xa) return res.status(403).json({ error: 'Khong co quyen' });
  if (req.user.role !== 'admin' && await isQuyLocked(quy, nam)) return res.status(403).json({ error: LOCK_MSG, locked: true });
  // Bắt buộc xã phải có email để nhận thông báo từ Sở
  const xaEmail = await getXaEmail(xa);
  if (!xaEmail) {
    return res.status(400).json({ error: 'Don vi chua co Email. Vao Cai dat don vi de cap nhat Email truoc khi gui xet duyet.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Lấy note_history hiện tại để append
    const [[existing]] = await conn.execute(
      'SELECT note_history, note FROM bienban WHERE xa=? AND quy=? AND nam=?',
      [xa, quy, parseInt(nam)]
    );
    let noteHistory = [];
    try { noteHistory = JSON.parse(existing?.note_history || '[]'); } catch(e) {}
    // Append ý kiến lần này vào lịch sử (format cũ: {note, at, quy})
    if (note && note.trim()) {
      noteHistory.push({ note: note.trim(), at: new Date().toISOString(), quy });
    }
    await conn.execute(
      "INSERT INTO bienban (xa,quy,nam,status,send_date,bx_list,ub_list,note,return_reason,approve_date,note_history) VALUES (?,?,?,'pending',CURDATE(),?,?,?,NULL,NULL,?) ON DUPLICATE KEY UPDATE status='pending',send_date=CURDATE(),bx_list=VALUES(bx_list),ub_list=VALUES(ub_list),note=VALUES(note),return_reason=NULL,approve_date=NULL,note_history=VALUES(note_history)",
      [xa,quy,parseInt(nam),JSON.stringify(bxList||[]),JSON.stringify(ubList||[]),note||'',JSON.stringify(noteHistory)]
    );
    const [[bb]] = await conn.execute('SELECT id FROM bienban WHERE xa=? AND quy=? AND nam=?', [xa,quy,parseInt(nam)]);
    await upsertCT(conn, bb.id, mths);
    await conn.commit(); res.json({ ok: true });
  } catch(e) { await conn.rollback(); res.status(500).json({ error: e.message }); }
  finally { conn.release(); }
});

app.post('/api/bienban/approve', requireAdmin, async (req, res) => {
  try {
    const { xa, quy, nam = NAM } = req.body || {};
    const [r] = await pool.execute("UPDATE bienban SET status='approved',approve_date=CURDATE() WHERE xa=? AND quy=? AND nam=? AND status='pending'", [xa,quy,parseInt(nam)]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Khong tim thay hoac khong o trang thai pending' });
    res.json({ ok: true });
    // Gửi email không đồng bộ — không chặn response, lỗi chỉ log
    (async () => {
      try {
        const to = await getXaEmail(xa);
        if (!to) { console.log('[mail-approve] Khong co email cho xa:', xa); return; }
        const today = new Date().toLocaleDateString('vi-VN');
        const tpl = mailApproved({ xa, quy, nam: parseInt(nam), approveDate: today });
        await sendMail({ to, subject: tpl.subject, html: tpl.html });
      } catch(err) { console.error('[mail-approve]', err.message); }
    })();
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bienban/return', requireAdmin, async (req, res) => {
  try {
    const { xa, quy, nam = NAM, reason } = req.body || {};
    if (!reason?.trim()) return res.status(400).json({ error: 'Can nhap ly do' });
    // Lấy return_history và return_reason hiện tại
    const [[existing]] = await pool.execute(
      'SELECT return_history, return_reason FROM bienban WHERE xa=? AND quy=? AND nam=?',
      [xa, quy, parseInt(nam)]
    );
    let returnHistory = [];
    try { returnHistory = JSON.parse(existing?.return_history || '[]'); } catch(e) {}
    const prevReason = (existing?.return_reason || '').trim();
    // Push lý do trả về LẦN NÀY vào lịch sử (format cũ: history chứa mọi lần, kể cả lần hiện tại)
    returnHistory.push({
      reason: reason.trim(),
      at: new Date().toISOString(),
      by: 'Sở Nội vụ'
    });
    await pool.execute(
      "UPDATE bienban SET status='returned',return_date=CURDATE(),return_reason=?,prr=?,return_history=? WHERE xa=? AND quy=? AND nam=?",
      [reason.trim(), prevReason, JSON.stringify(returnHistory), xa, quy, parseInt(nam)]
    );
    res.json({ ok: true });
    // Gửi email không đồng bộ — không chặn response, lỗi chỉ log
    (async () => {
      try {
        const to = await getXaEmail(xa);
        if (!to) { console.log('[mail-return] Khong co email cho xa:', xa); return; }
        const tpl = mailReturned({ xa, quy, nam: parseInt(nam), reason: reason.trim() });
        await sendMail({ to, subject: tpl.subject, html: tpl.html });
      } catch(err) { console.error('[mail-return]', err.message); }
    })();
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin reset trạng thái về returned (mở khóa cho xã sửa lại)
app.post('/api/bienban/reset', requireAdmin, async (req, res) => {
  try {
    const { xa, quy, nam = NAM } = req.body || {};
    await pool.execute(
      "UPDATE bienban SET status='returned', return_reason='Admin reset de chinh sua lai', return_date=CURDATE() WHERE xa=? AND quy=? AND nam=?",
      [xa, quy, parseInt(nam)]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Xã hủy bản ghi pending của mình (nếu muốn nhập lại từ đầu)
app.delete('/api/bienban', requireAuth, async (req, res) => {
  try {
    const { xa, quy, nam = NAM } = req.query;
    if (req.user.role !== 'admin' && req.user.xa !== xa) return res.status(403).json({ error: 'Khong co quyen' });
    // Chỉ xóa được khi status=returned (không xóa pending/approved)
    const [r] = await pool.execute(
      "DELETE FROM bienban WHERE xa=? AND quy=? AND nam=? AND status='returned'",
      [xa, quy, parseInt(nam)]
    );
    res.json({ ok: true, deleted: r.affectedRows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bienban/tonghop', requireViewer, async (req, res) => {
  try {
    const { quy, nam = NAM } = req.query;
    if (!quy) return res.status(400).json({ error: 'Thieu quy' });
    const [rows] = await pool.execute(
      "SELECT b.xa,c.thang,c.doi_tuong,c.nsnn,c.dk,c.pt,c.pg,c.thu,c.bs,c.cap,c.tt FROM bienban b JOIN bienban_chitiet c ON c.bienban_id=b.id WHERE b.quy=? AND b.nam=? AND b.status='approved' ORDER BY b.xa,c.thang,c.doi_tuong",
      [quy, parseInt(nam)]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CHỐT SỐ LIỆU QUÝ ────────────────────────────────────────────────────────

// GET: kiểm tra trạng thái chốt và lấy snapshot đã chốt
app.get('/api/bienban/chot', requireViewer, async (req, res) => {
  try {
    const { quy, nam = NAM } = req.query;
    if (!quy) return res.status(400).json({ error: 'Thieu quy' });
    const [rows] = await pool.execute(
      'SELECT xa, muc_I, muc_II, chot_by, chot_at FROM quy_chot WHERE quy=? AND nam=? ORDER BY xa',
      [quy, parseInt(nam)]
    );
    if (!rows.length) return res.json({ chot: false });
    res.json({ chot: true, chot_at: rows[0].chot_at, chot_by: rows[0].chot_by, rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST: chốt số liệu — lưu snapshot vào quy_chot
app.post('/api/bienban/chot', requireAdmin, async (req, res) => {
  try {
    const { quy, nam, rows } = req.body;
    if (!quy || !nam || !Array.isArray(rows)) return res.status(400).json({ error: 'Du lieu khong hop le' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM quy_chot WHERE quy=? AND nam=?', [quy, parseInt(nam)]);
      for (const r of rows) {
        await conn.execute(
          'INSERT INTO quy_chot (quy, nam, xa, muc_I, muc_II, chot_by) VALUES (?,?,?,?,?,?)',
          [quy, parseInt(nam), r.xa, r.muc_I || 0, r.muc_II || 0, req.user.username]
        );
      }
      await conn.commit();
      res.json({ saved: rows.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE: bỏ chốt (cho phép tổng hợp lại)
app.delete('/api/bienban/chot', requireAdmin, async (req, res) => {
  try {
    const { quy, nam } = req.query;
    if (!quy || !nam) return res.status(400).json({ error: 'Thieu quy hoac nam' });
    await pool.execute('DELETE FROM quy_chot WHERE quy=? AND nam=?', [quy, parseInt(nam)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── THÔNG BÁO CẤP KINH PHÍ ──────────────────────────────────────────────────

// GET: lấy dữ liệu thông báo cấp — admin xem tất cả, xã chỉ xem của mình
app.get('/api/cap', requireViewer, async (req, res) => {
  // giữ nguyên logic: nếu là admin thì có thể truyền xa, nếu là bhxh thì xem tất cả xã? 
  // Nên cho bhxh xem tất cả xã (không cần lọc)
  try {
    const { thang, nam = NAM } = req.query;
    const where = ['nam=?']; const params = [parseInt(nam)];
    if (thang) { where.push('thang=?'); params.push(parseInt(thang)); }
    // Nếu là admin và có xa truyền vào thì lọc, còn bhxh xem hết
    if (req.user.role === 'admin' && req.query.xa) {
      where.push('xa=?'); params.push(req.query.xa);
    }
    const [rows] = await pool.execute(
      `SELECT xa,thang,nam,muc_I,muc_II,ghi_chu,updated_at FROM thong_bao_cap WHERE ${where.join(' AND ')} ORDER BY thang,xa`,
      params
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET: đối chiếu — so sánh thông báo cấp vs KP đã cấp trong biên bản (toàn năm)
app.get('/api/cap/doichieu', requireViewer, async (req, res) => {
  try {
    const { xa, nam = NAM } = req.query;
    // xa role: chỉ xem của mình; admin/bhxh: xem theo xa được truyền vào
    if (req.user.role === 'xa' && req.user.xa !== xa) return res.status(403).json({ error: 'Khong co quyen' });
    const xaFilter = (req.user.role === 'xa') ? req.user.xa : (xa || null);
    const xaWhere  = xaFilter ? 'AND xa=?' : '';
    const xaWhereB = xaFilter ? 'AND b.xa=?' : '';
    const xaParams = xaFilter ? [xaFilter] : [];

    const [capRows] = await pool.execute(
      `SELECT xa,thang,muc_I,muc_II,ghi_chu FROM thong_bao_cap WHERE nam=? ${xaWhere} ORDER BY thang`,
      [parseInt(nam), ...xaParams]
    );

    const [bbRows] = await pool.execute(
      `SELECT b.xa, c.thang,
        SUM(CASE WHEN c.doi_tuong<=3 THEN c.cap ELSE 0 END) AS bb_mucI,
        SUM(CASE WHEN c.doi_tuong>=4 THEN c.cap ELSE 0 END) AS bb_mucII
       FROM bienban b JOIN bienban_chitiet c ON c.bienban_id=b.id
       WHERE b.nam=? ${xaWhereB}
       GROUP BY b.xa, c.thang ORDER BY c.thang`,
      [parseInt(nam), ...xaParams]
    );

    res.json({ cap: capRows, bienban: bbRows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST: admin nhập/cập nhật thông báo cấp
app.post('/api/cap', requireAdmin, async (req, res) => {
  try {
    const { xa, thang, nam = NAM, muc_I, muc_II, ghi_chu } = req.body || {};
    if (!xa || !thang) return res.status(400).json({ error: 'Thieu xa hoac thang' });
    await pool.execute(
      `INSERT INTO thong_bao_cap (xa,thang,nam,muc_I,muc_II,ghi_chu) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE muc_I=VALUES(muc_I), muc_II=VALUES(muc_II), ghi_chu=VALUES(ghi_chu)`,
      [xa, parseInt(thang), parseInt(nam), parseInt(muc_I)||0, parseInt(muc_II)||0, ghi_chu||'']
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST batch: nhập nhiều xã cùng lúc (cho tháng)
app.post('/api/cap/batch', requireAdmin, async (req, res) => {
  try {
    const { thang, nam = NAM, rows } = req.body || {};
    if (!thang || !Array.isArray(rows)) return res.status(400).json({ error: 'Thieu du lieu' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const r of rows) {
        if (!r.xa) continue;
        await conn.execute(
          `INSERT INTO thong_bao_cap (xa,thang,nam,muc_I,muc_II,ghi_chu) VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE muc_I=VALUES(muc_I), muc_II=VALUES(muc_II), ghi_chu=VALUES(ghi_chu)`,
          [r.xa, parseInt(thang), parseInt(nam), parseInt(r.muc_I)||0, parseInt(r.muc_II)||0, r.ghi_chu||'']
        );
      }
      await conn.commit();
      res.json({ ok: true, saved: rows.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bienban/thuhoi — xã tự thu hồi biên bản (pending hoặc approved) về returned để chỉnh sửa
app.post('/api/bienban/thuhoi', requireAuth, async (req, res) => {
  try {
    const { xa, quy, nam = NAM } = req.body || {};
    if (req.user.role !== 'admin' && req.user.xa !== xa) return res.status(403).json({ error: 'Khong co quyen' });
    if (req.user.role !== 'admin' && await isQuyLocked(quy, nam)) return res.status(403).json({ error: LOCK_MSG, locked: true });
    const [r] = await pool.execute(
      "UPDATE bienban SET status='returned', return_reason=NULL, approve_date=NULL WHERE xa=? AND quy=? AND nam=? AND status IN ('pending','approved')",
      [xa, quy, parseInt(nam)]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Khong tim thay bien ban dang gui hoac da duyet' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/me - lấy thông tin user từ token
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT username, role, name, xa FROM users WHERE id=? AND active=1',
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(401).json({ error: 'User không tồn tại hoặc bị khóa' });
    }
    res.json({ user: rows[0] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STATIC + SPA fallback ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
module.exports = app;
