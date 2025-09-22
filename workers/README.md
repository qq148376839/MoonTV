# MoonTV Workers API

> 🚀 **MoonTV** 的 Cloudflare Workers 后端 API 服务，提供完整的用户系统和视频数据存储功能。

## ✨ 功能特性

### 🔐 用户系统 (兼容 MoonTV 原有功能)

- **用户认证**: 登录、注册、密码修改
- **播放记录**: 跨设备同步播放进度
- **收藏系统**: 视频收藏管理
- **搜索历史**: 智能搜索历史记录
- **管理员功能**: 用户管理、系统配置

### 📺 视频数据存储 (新增功能)

- **视频管理**: 完整的视频信息存储和检索
- **分类系统**: 支持层级分类结构
- **数据采集**: 兼容 autotasks 接口的数据采集功能
- **智能分类**: AI 辅助视频分类
- **统计分析**: 完整的数据统计功能

### ⚡ 技术特性

- **D1 数据库**: 高性能 SQLite 数据库存储
- **KV 存储**: 缓存和任务状态管理
- **定时任务**: 自动化数据同步和清理
- **CORS 支持**: 完整的跨域访问支持
- **错误处理**: 统一的错误处理和日志记录

## 🚀 快速开始

### 1. 环境准备

```bash
# 安装Wrangler CLI
npm install -g wrangler

# 登录Cloudflare
wrangler login

# 克隆项目到MoonTV/workers目录
cd /path/to/MoonTV
mkdir -p workers
cd workers
```

### 2. 创建云端资源

```bash
# 创建D1数据库
wrangler d1 create moontv-database

# 创建KV命名空间
wrangler kv:namespace create "CACHE"
wrangler kv:namespace create "TASK_STATUS"
```

### 3. 配置 wrangler.toml

将上述命令返回的 ID 更新到 `wrangler.toml` 中：

```toml
[[d1_databases]]
binding = "DB"
database_name = "moontv-database"
database_id = "your-actual-database-id"  # 替换为实际ID

[[kv_namespaces]]
binding = "CACHE"
id = "your-cache-kv-id"  # 替换为实际ID

[[kv_namespaces]]
binding = "TASK_STATUS"
id = "your-task-kv-id"  # 替换为实际ID
```

### 4. 初始化数据库

```bash
# 本地开发环境初始化
wrangler d1 execute moontv-database --file=./schema.sql

# 生产环境初始化
wrangler d1 execute moontv-database --file=./schema.sql --remote
```

### 5. 部署服务

```bash
# 开发环境部署
npm run dev

# 生产环境部署
npm run deploy:production
```

## 📋 API 接口文档

### 🔐 用户认证 API

#### 用户登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

#### 用户注册

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "newuser",
  "password": "password123"
}
```

### 📺 播放记录 API

#### 获取播放记录

```http
GET /api/playrecords
X-Username: admin
```

#### 保存播放记录

```http
POST /api/playrecords
X-Username: admin
Content-Type: application/json

{
  "key": "source+video_id",
  "record": {
    "title": "视频标题",
    "source_name": "资源站名称",
    "cover": "封面图片URL",
    "year": "2024",
    "index": 1,
    "total_episodes": 24,
    "play_time": 1800,
    "total_time": 2400,
    "save_time": 1703123456,
    "search_title": "搜索标题"
  }
}
```

### ❤️ 收藏 API

#### 获取收藏列表

```http
GET /api/favorites
X-Username: admin
```

#### 添加收藏

```http
POST /api/favorites
X-Username: admin
Content-Type: application/json

{
  "key": "source+video_id",
  "favorite": {
    "title": "视频标题",
    "source_name": "资源站名称",
    "cover": "封面图片URL",
    "year": "2024",
    "total_episodes": 24,
    "save_time": 1703123456,
    "search_title": "搜索标题"
  }
}
```

### 🔍 视频搜索 API

#### 搜索视频

```http
GET /api/videos/search?q=关键词&page=1&limit=20&type_id=1
```

#### 获取视频详情

```http
GET /api/videos/{video_id}
```

### 📊 分类管理 API

#### 获取分类列表

```http
GET /api/categories
```

#### 获取分类层级

```http
GET /api/categories/hierarchy
```

### 📈 统计 API

#### 获取系统统计

```http
GET /api/stats
```

### 🔧 数据采集 API (兼容 autotasks)

#### 更新视频数据

```http
POST /api/collection/update_data
Content-Type: multipart/form-data

vod_name=视频名称
vod_pic=封面URL
vod_actor=演员
vod_director=导演
vod_year=年份
vod_area=地区
vod_content=简介
vod_play_from=播放来源
vod_play_url=播放地址
type_name=分类名称
```

## 🔧 MoonTV 集成配置

### 1. 更新 MoonTV 的环境变量

```bash
# 在MoonTV项目中设置
NEXT_PUBLIC_STORAGE_TYPE=d1
WORKERS_API_URL=https://your-workers-domain.workers.dev
```

### 2. 修改 MoonTV 的 API 配置

在 MoonTV 的 `src/lib/config.ts` 中添加 Workers API 配置：

```typescript
const WORKERS_API_URL = process.env.WORKERS_API_URL || 'http://localhost:8787';

// 更新API端点
export const API_ENDPOINTS = {
  playrecords: `${WORKERS_API_URL}/api/playrecords`,
  favorites: `${WORKERS_API_URL}/api/favorites`,
  searchhistory: `${WORKERS_API_URL}/api/searchhistory`,
  auth: `${WORKERS_API_URL}/api/auth`,
  videos: `${WORKERS_API_URL}/api/videos`,
};
```

### 3. 更新 D1 数据库配置

将 MoonTV 的 `D1初始化.md` 替换为新的 `schema.sql`：

```bash
# 在MoonTV项目根目录
cp workers/schema.sql ./D1初始化.sql
```

## 🗂️ 数据库架构

### 核心表结构

- **users**: 用户表 (兼容原有结构)
- **play_records**: 播放记录表
- **favorites**: 收藏表
- **search_history**: 搜索历史表
- **mac_vod**: 视频数据表 (新增)
- **mac_type**: 分类表 (新增)
- **mac_actor**: 演员表 (新增)
- **mac_ai_classification**: AI 分类记录表 (新增)

### 数据迁移

如果您已有 MoonTV 的 D1 数据，新架构完全兼容，只需执行：

```bash
# 添加新表结构 (不会影响现有数据)
wrangler d1 execute moontv-database --file=./schema.sql --remote
```

## 🔍 开发和调试

### 本地开发

```bash
# 启动本地开发服务器
npm run dev

# 查看实时日志
npm run logs

# 执行数据库查询
npm run db:query "SELECT * FROM users LIMIT 5"
```

### 数据库操作

```bash
# 数据库备份
npm run db:backup

# 查看表结构
wrangler d1 execute moontv-database --command="PRAGMA table_info(mac_vod);"

# 查看数据统计
wrangler d1 execute moontv-database --command="SELECT COUNT(*) FROM mac_vod;"
```

## 📊 监控和维护

### 性能监控

- **Cloudflare Dashboard**: 查看请求量、延迟、错误率
- **D1 Analytics**: 监控数据库查询性能
- **Worker Logs**: 实时错误和调试信息

### 定期维护

- **数据备份**: 建议每日备份 D1 数据库
- **缓存清理**: 定时任务自动清理过期缓存
- **日志分析**: 定期分析错误日志优化性能

## 🛠️ 故障排除

### 常见问题

1. **数据库连接失败**

   ```bash
   # 检查数据库状态
   wrangler d1 list

   # 测试连接
   wrangler d1 execute moontv-database --command="SELECT 1;"
   ```

2. **CORS 错误**

   - 确保 Workers 已正确设置 CORS 头部
   - 检查 MoonTV 的 API 请求是否包含正确的头部

3. **权限问题**

   ```bash
   # 重新登录Cloudflare
   wrangler logout
   wrangler login
   ```

4. **数据不同步**
   - 检查 X-Username 请求头是否正确设置
   - 验证用户认证状态

## 📚 相关文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [MoonTV 项目文档](../README.md)

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 [MIT](../LICENSE) 许可证。

---

**文档版本**: v2.0  
**最后更新**: 2024-12-09  
**维护人员**: MoonTV 项目组
