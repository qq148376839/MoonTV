-- ==================== 用户系统表 ====================

-- 用户表 (兼容MoonTV原有结构)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- 播放记录表
CREATE TABLE IF NOT EXISTS play_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    record_key TEXT NOT NULL,
    record_data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(username, record_key),
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
);

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    favorite_key TEXT NOT NULL,
    favorite_data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(username, favorite_key),
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
);

-- 搜索历史表
CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    keyword TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
);

-- 管理员配置表
CREATE TABLE IF NOT EXISTS admin_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT NOT NULL UNIQUE,
    config_data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- ==================== 视频数据表 ====================

-- 分类表
CREATE TABLE IF NOT EXISTS mac_type (
    type_id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_name TEXT NOT NULL UNIQUE,
    type_sort INTEGER DEFAULT 99,
    type_status INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- 演员表
CREATE TABLE IF NOT EXISTS mac_actor (
    actor_id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_name TEXT NOT NULL UNIQUE,
    actor_pic TEXT,
    actor_content TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- 视频数据表 (兼容苹果CMS结构)
CREATE TABLE IF NOT EXISTS mac_vod (
    vod_id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL DEFAULT 1,
    vod_name TEXT NOT NULL,
    vod_sub TEXT,
    vod_en TEXT,
    vod_pic TEXT,
    vod_actor TEXT,
    vod_director TEXT,
    vod_year TEXT,
    vod_area TEXT,
    vod_lang TEXT,
    vod_content TEXT,
    vod_remarks TEXT,
    vod_serial TEXT,
    vod_play_from TEXT,
    vod_play_url TEXT,
    vod_play_server TEXT,
    vod_play_note TEXT,
    vod_time INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    vod_time_add INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    vod_hits INTEGER DEFAULT 0,
    vod_hits_day INTEGER DEFAULT 0,
    vod_hits_week INTEGER DEFAULT 0,
    vod_hits_month INTEGER DEFAULT 0,
    vod_score REAL DEFAULT 0,
    vod_score_all INTEGER DEFAULT 0,
    vod_score_num INTEGER DEFAULT 0,
    vod_status INTEGER DEFAULT 1,
    FOREIGN KEY(type_id) REFERENCES mac_type(type_id) ON DELETE SET DEFAULT
);

-- AI分类记录表
CREATE TABLE IF NOT EXISTS mac_ai_classification (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vod_id INTEGER NOT NULL,
    classification_result TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(vod_id) REFERENCES mac_vod(vod_id) ON DELETE CASCADE
);

-- ==================== 索引优化 ====================

-- 用户相关索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_play_records_username ON play_records(username);
CREATE INDEX IF NOT EXISTS idx_favorites_username ON favorites(username);
CREATE INDEX IF NOT EXISTS idx_search_history_username ON search_history(username);

-- 视频数据索引
CREATE INDEX IF NOT EXISTS idx_mac_vod_type_id ON mac_vod(type_id);
CREATE INDEX IF NOT EXISTS idx_mac_vod_name ON mac_vod(vod_name);
CREATE INDEX IF NOT EXISTS idx_mac_vod_year ON mac_vod(vod_year);
CREATE INDEX IF NOT EXISTS idx_mac_vod_area ON mac_vod(vod_area);
CREATE INDEX IF NOT EXISTS idx_mac_vod_time ON mac_vod(vod_time);
CREATE INDEX IF NOT EXISTS idx_mac_vod_status ON mac_vod(vod_status);

-- ==================== 初始数据 ====================

-- 插入默认分类
INSERT OR IGNORE INTO mac_type (type_id, type_name, type_sort) VALUES 
(1, '电影', 1),
(2, '电视剧', 2),
(3, '综艺', 3),
(4, '动漫', 4),
(5, '纪录片', 5);

-- 插入默认管理员配置
INSERT OR IGNORE INTO admin_config (config_key, config_data) VALUES 
('main', json('{
  "SiteConfig": {
    "SiteName": "MoonTV",
    "Announcement": "本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。",
    "SearchDownstreamMaxPage": 5,
    "SiteInterfaceCacheTime": 7200,
    "ImageProxy": "",
    "DoubanProxy": "",
    "DisableYellowFilter": false
  },
  "UserConfig": {
    "AllowRegister": false,
    "Users": []
  },
  "SourceConfig": [],
  "CustomCategories": []
}'));
