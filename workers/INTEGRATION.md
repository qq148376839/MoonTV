# MoonTV + Workers 集成指南

## 🎯 架构说明

```
MoonTV前端应用 → Workers API → D1数据库
```

## 🔧 MoonTV 配置

### 1. 环境变量配置

在 MoonTV 项目中设置以下环境变量：

```bash
# 存储类型设置为workers
NEXT_PUBLIC_STORAGE_TYPE=workers

# Workers API地址
WORKERS_API_URL=https://moontv-database.x8bd542jnt.workers.dev

# 管理员账号
USERNAME=admin
PASSWORD=your_password_here

# 其他配置
NEXT_PUBLIC_ENABLE_REGISTER=false
SITE_NAME=MoonTV
```

### 2. Vercel 部署配置

在 Vercel 项目设置中添加环境变量：

1. 进入 Vercel 项目 → Settings → Environment Variables
2. 添加以下变量：
   ```
   NEXT_PUBLIC_STORAGE_TYPE = workers
   WORKERS_API_URL = https://moontv-database.x8bd542jnt.workers.dev
   USERNAME = admin
   PASSWORD = your_secure_password
   ```

### 3. Cloudflare Pages 配置

在 Cloudflare Pages 项目设置中：

1. 进入 Pages 项目 → Settings → Environment variables
2. 添加相同的环境变量（建议设为 encrypted）

## 🚀 部署步骤

### 步骤 1：部署 Workers API

```bash
cd MoonTV/workers
wrangler deploy --env production
```

### 步骤 2：更新 MoonTV 配置

1. 设置环境变量 `NEXT_PUBLIC_STORAGE_TYPE=workers`
2. 设置 `WORKERS_API_URL` 为您的 Workers 域名

### 步骤 3：重新部署 MoonTV

```bash
# Vercel
vercel --prod

# 或 Cloudflare Pages
npm run pages:build
```

## 🔍 验证部署

### 1. 测试 Workers API

```bash
# 测试统计接口
curl "https://moontv-database.x8bd542jnt.workers.dev/api/stats"

# 预期返回
{
  "code": 200,
  "msg": "获取统计信息成功",
  "data": {
    "users": 1,
    "videos": 0,
    "categories": 33,
    "play_records": 0,
    "favorites": 0
  }
}
```

### 2. 测试 MoonTV 集成

1. 访问 MoonTV 网站
2. 尝试登录（使用设置的管理员账号）
3. 测试播放记录和收藏功能
4. 检查浏览器开发者工具，确认 API 请求指向 Workers 地址

## 🛠️ 故障排除

### 问题 1：Cannot read properties of undefined (reading 'prepare')

**原因**：MoonTV 仍在尝试直接访问 D1 数据库
**解决**：确认 `NEXT_PUBLIC_STORAGE_TYPE=workers`

### 问题 2：Workers API 请求失败

**检查清单**：

1. Workers API 是否正常部署
2. WORKERS_API_URL 是否正确设置
3. CORS 配置是否正确

### 问题 3：用户认证失败

**检查**：

1. USERNAME 和 PASSWORD 环境变量是否正确设置
2. Workers API 中是否有对应的管理员用户

## 📊 API 端点映射

| MoonTV 功能 | Workers API 端点     |
| ----------- | -------------------- |
| 播放记录    | `/api/playrecords`   |
| 收藏        | `/api/favorites`     |
| 搜索历史    | `/api/searchhistory` |
| 用户认证    | `/api/auth/*`        |
| 管理员功能  | `/api/admin/*`       |

## 🔐 安全注意事项

1. **Workers API 域名**：不要公开分享，仅供 MoonTV 使用
2. **管理员密码**：使用强密码
3. **环境变量**：在生产环境中设为加密/私密
4. **CORS 配置**：仅允许 MoonTV 域名访问

## 📈 性能优化

1. **CDN 缓存**：Workers API 自动使用 Cloudflare CDN
2. **数据库连接**：D1 数据库自动优化连接池
3. **请求合并**：考虑在客户端合并多个 API 请求

---

**配置完成后，您的 MoonTV 将通过 Workers API 安全高效地访问 D1 数据库！** 🎉
