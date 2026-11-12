-- =============================================
-- HỆ THỐNG BIÊN BẢN BHYT - SỞ NỘI VỤ SƠN LA
-- Schema MySQL v4.0 - Năm 2026
-- Chạy file này 1 lần trong phpMyAdmin hoặc MySQL CLI
-- =============================================
SET NAMES utf8mb4;

DROP TABLE IF EXISTS bienban_chitiet;
DROP TABLE IF EXISTS bienban;
DROP TABLE IF EXISTS don_vi_cfg;
DROP TABLE IF EXISTS users;

-- NGƯỜI DÙNG
CREATE TABLE users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(50) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  role       ENUM('admin','xa') NOT NULL DEFAULT 'xa',
  name       VARCHAR(100) NOT NULL,
  xa         VARCHAR(100) NULL,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CẤU HÌNH ĐƠN VỊ
CREATE TABLE don_vi_cfg (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  xa           VARCHAR(100) NOT NULL UNIQUE,
  bhxh_cs_name VARCHAR(200) DEFAULT '',
  bhxh_list    TEXT,
  ubnd_list    TEXT,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BIÊN BẢN (đầu mối theo Quý)
CREATE TABLE bienban (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  xa            VARCHAR(100) NOT NULL,
  quy           ENUM('I','II','III','IV') NOT NULL,
  nam           SMALLINT NOT NULL DEFAULT 2026,
  status        ENUM('pending','approved','returned') NOT NULL DEFAULT 'pending',
  send_date     DATE NULL,
  approve_date  DATE NULL,
  return_date   DATE NULL,
  return_reason TEXT NULL,
  bx_list       TEXT NULL,
  ub_list       TEXT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_xa_quy_nam (xa, quy, nam)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CHI TIẾT SỐ LIỆU
CREATE TABLE bienban_chitiet (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  bienban_id INT NOT NULL,
  thang      TINYINT NOT NULL,
  doi_tuong  TINYINT NOT NULL,
  dk         INT NOT NULL DEFAULT 0,
  pt         INT NOT NULL DEFAULT 0,
  pg         INT NOT NULL DEFAULT 0,
  tt         BIGINT NOT NULL DEFAULT 0,
  thu        BIGINT NOT NULL DEFAULT 0,
  bs         BIGINT NOT NULL DEFAULT 0,
  cap        BIGINT NOT NULL DEFAULT 0,
  nsnn       BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (bienban_id) REFERENCES bienban(id) ON DELETE CASCADE,
  UNIQUE KEY uk_bb_thang_dt (bienban_id, thang, doi_tuong)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Tài khoản sẽ được tạo tự động khi chạy: node server/seed.js
