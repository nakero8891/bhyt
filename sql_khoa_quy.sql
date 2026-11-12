-- Không bắt buộc: app.js tự tạo bảng này khi khởi động (sau ~3 giây).
-- Chỉ chạy trong phpMyAdmin nếu muốn tạo thủ công.
CREATE TABLE IF NOT EXISTS quy_lock (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  quy        ENUM('I','II','III','IV') NOT NULL,
  nam        SMALLINT NOT NULL,
  locked     TINYINT(1) NOT NULL DEFAULT 1,
  locked_by  VARCHAR(50) DEFAULT '',
  locked_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_quy_nam (quy, nam)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
