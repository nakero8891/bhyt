# BHYT SỞ NỘI VỤ SƠN LA — v4.1

## DEPLOY TRÊN CPANEL (PASSENGER)

### 1. Upload code
- Upload thư mục `bhyt-system/` vào thư mục gốc (cùng cấp public_html)
- Đường dẫn: `/home/USER/bhyt-system/`

### 2. Tạo Database trong cPanel
- cPanel → MySQL Databases → tạo DB + User → gán Full Privileges
- phpMyAdmin → chọn DB → tab SQL → paste nội dung `sql/schema.sql` → Go

### 3. Tạo file .env
Tạo file `/home/USER/bhyt-system/.env`:
```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=user_bhyt
DB_USER=user_bhyt
DB_PASS=mat_khau_mysql
JWT_SECRET=chuoi_ngau_nhien_dai_32_ky_tu_tro_len
PORT=3000
NODE_ENV=production
NAM=2026
```

### 4. Cài Node.js App trong cPanel
- cPanel → Setup Node.js App → Create Application
- Node.js version: 18 (hoặc mới nhất)
- Application root: `bhyt-system`
- Application URL: domain hoặc subdomain
- Startup file: `app.js`
- → Create

### 5. Cài dependencies
- Trong trang Node.js App → Run NPM Install

### 6. Tạo tài khoản admin
Trong cPanel → Setup Node.js App → trang app vừa tạo:
- Tìm mục **Run JS script** hoặc **NPM script**
- Nhập: `server/seed.js` → Run

Hoặc dùng Terminal (nếu hosting có):
```bash
cd ~/bhyt-system
/usr/local/bin/node server/seed.js
```
> Nếu `node` không tìm thấy, thử:
> `/usr/local/bin/node` hoặc `/opt/cpanel/ea-nodejs18/bin/node`

### 7. Khởi động
- cPanel → Setup Node.js App → Start App
- Truy cập URL → đăng nhập

---

## TÀI KHOẢN MẶC ĐỊNH
| Tài khoản | Mật khẩu   | Ghi chú |
|-----------|------------|---------|
| admin     | Admin@2026 | Quản trị — ĐỔI NGAY SAU KHI ĐĂNG NHẬP |

Để thêm tài khoản các xã:
- Đăng nhập admin → Quản lý tài khoản → + Thêm tài khoản xã

---

## CÁCH TÌM ĐƯỜNG DẪN NODE.JS TRÊN CPANEL
Trong cPanel → Terminal, gõ:
```bash
which node
# hoặc
find /usr /opt -name "node" 2>/dev/null | head -5
```
Copy đường dẫn đó để chạy seed.

