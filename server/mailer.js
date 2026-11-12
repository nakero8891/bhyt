// server/mailer.js — Gửi email thông báo
'use strict';
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return null;
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host:   process.env.MAIL_HOST   || 'smtp.gmail.com',
      port:   parseInt(process.env.MAIL_PORT || '587'),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
    return transporter;
  } catch(e) {
    console.error('[mailer] Khởi tạo thất bại:', e.message);
    return null;
  }
}

// Gửi email — không throw, chỉ log lỗi
async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) {
    console.log('[mailer] Chưa cấu hình email — bỏ qua gửi tới:', to);
    return false;
  }
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to, subject, html,
    });
    console.log('[mailer] Đã gửi tới:', to);
    return true;
  } catch(e) {
    console.error('[mailer] Lỗi gửi email:', e.message);
    return false;
  }
}

// Template: Sở duyệt biên bản
function mailApproved({ xa, quy, nam, approveDate, soDien }) {
  return {
    subject: `✅ [BHYT] Biên bản Quý ${quy}/${nam} - ${xa} đã được Sở xác nhận`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
  <div style="background:#1a7a4a;color:#fff;padding:20px 24px">
    <h2 style="margin:0;font-size:18px">✅ Biên bản đã được xác nhận</h2>
  </div>
  <div style="padding:24px;background:#fff">
    <p style="font-size:15px;margin-top:0">Kính gửi <strong>UBND xã/phường ${xa}</strong>,</p>
    <p>Sở Nội vụ tỉnh Sơn La thông báo: Biên bản BHYT người có công đã được <strong>xác nhận</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 12px;background:#f5f5f5;width:40%;font-weight:bold">Xã/Phường</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${xa}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:bold">Quý / Năm</td><td style="padding:8px 12px;border-bottom:1px solid #eee">Quý ${quy} / ${nam}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:bold">Ngày xác nhận</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${approveDate}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:bold">Trạng thái</td><td style="padding:8px 12px;color:#1a7a4a;font-weight:bold">✅ Đã xác nhận</td></tr>
    </table>
    <p>Không cần thực hiện thêm thao tác nào. Nếu có thắc mắc, vui lòng liên hệ Sở Nội vụ.</p>
   <p>📞 Liên hệ hỗ trợ: <strong>038.636.8891</strong></p>
  </div>
  <div style="padding:12px 24px;background:#f9f9f9;color:#888;font-size:12px;text-align:center">
    Hệ thống biên bản BHYT — Sở Nội vụ tỉnh Sơn La
  </div>
</div>`
  };
}

// Template: Sở trả về biên bản
function mailReturned({ xa, quy, nam, reason, soDien }) {
  return {
    subject: `↩ [BHYT] Biên bản Quý ${quy}/${nam} - ${xa} bị trả về, cần chỉnh sửa`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
  <div style="background:#c0392b;color:#fff;padding:20px 24px">
    <h2 style="margin:0;font-size:18px">↩ Biên bản cần chỉnh sửa</h2>
  </div>
  <div style="padding:24px;background:#fff">
    <p style="font-size:15px;margin-top:0">Kính gửi <strong>UBND xã/phường ${xa}</strong>,</p>
    <p>Sở Nội vụ tỉnh Sơn La thông báo: Biên bản BHYT người có công cần được <strong>chỉnh sửa và gửi lại</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 12px;background:#f5f5f5;width:40%;font-weight:bold">Xã/Phường</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${xa}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:bold">Quý / Năm</td><td style="padding:8px 12px;border-bottom:1px solid #eee">Quý ${quy} / ${nam}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:bold">Trạng thái</td><td style="padding:8px 12px;color:#c0392b;font-weight:bold">↩ Bị trả về</td></tr>
    </table>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px 16px;margin:16px 0">
      <strong>📝 Lý do:</strong>
      <p style="margin:6px 0 0">${reason}</p>
    </div>
    <p><strong>Hướng dẫn:</strong> Đăng nhập hệ thống → Nhập & Gửi biên bản → Chỉnh sửa & Gửi lại.</p>
   <p>📞 Liên hệ hỗ trợ: <strong>038.636.8891</strong></p>
  </div>
  <div style="padding:12px 24px;background:#f9f9f9;color:#888;font-size:12px;text-align:center">
    Hệ thống biên bản BHYT — Sở Nội vụ tỉnh Sơn La
  </div>
</div>`
  };
}

module.exports = { sendMail, mailApproved, mailReturned };
