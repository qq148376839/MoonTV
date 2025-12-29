# MoonTV

<div align="center">
  <img src="public/logo.png" alt="LibreTV Logo" width="120">
</div>

> 🎬 **MoonTV** 是一个开箱即用的、跨平台的影视聚合播放器。它基于 **Next.js 14** + **Tailwind&nbsp;CSS** + **TypeScript** 构建，支持多资源搜索、在线播放、收藏同步、播放记录、本地/云端存储，让你可以随时随地畅享海量免费影视内容。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-4.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## ✨ 功能特性

- 🔍 **多源聚合搜索**：内置数十个免费资源站点，一次搜索立刻返回全源结果。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- 🎯 **直接播放路由**：通过 `/player?url=<视频地址>` 直接播放视频，无需搜索流程。
- ❤️ **收藏 + 继续观看**：支持 Redis/D1/Upstash 存储，多端同步进度。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸。
- 🚀 **极简部署**：一条 Docker 命令即可将完整服务跑起来，或免费部署到 Vercel 和 Cloudflare。
- 👿 **智能去广告**：自动跳过视频中的切片广告（实验性）

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot2.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot3.png" alt="项目截图" style="max-width:600px">
</details>

## 🗺 目录

- [技术栈](#技术栈)
- [部署](#部署)
- [Docker Compose 最佳实践](#Docker-Compose-最佳实践)
- [环境变量](#环境变量)
- [配置说明](#配置说明)
- [管理员配置](#管理员配置)
- [AndroidTV 使用](#AndroidTV-使用)
- [Roadmap](#roadmap)
- [安全与隐私提醒](#安全与隐私提醒)
- [License](#license)
- [致谢](#致谢)

## 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 14](https://nextjs.org/) · App Router                                                        |
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)                                                       |
| 语言      | TypeScript 4                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                                                              |
| 部署      | Docker · Vercel · CloudFlare pages · Zeabur                                                           |

## 部署

本项目**支持 Zeabur、Vercel、Docker 和 Cloudflare** 部署。

### Zeabur 一键部署（推荐）

#### 方式一：使用一键部署按钮

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates)

> **提示**: 如果您已创建 Zeabur 模板，请在按钮 URL 中添加模板 ID，例如：
> `https://zeabur.com/templates/YOUR_TEMPLATE_ID`

#### 方式二：通过 Zeabur 控制台部署

1. 访问 [Zeabur](https://zeabur.com) 并登录/注册
2. 点击 **"Create New Project"** 或 **"+ New"**
3. 选择 **"Import from Git Repository"** 或 **"Deploy from GitHub"**
4. 选择您的 GitHub 仓库（或直接导入 `https://github.com/your-username/MoonTV`）
5. Zeabur 会自动检测 `zeabur.yaml` 和 `Dockerfile`
6. 配置环境变量（见下方）
7. 点击 **"Deploy"** 开始部署

#### 配置环境变量

在 Zeabur 项目设置中的 **Environment Variables** 部分添加以下变量：

**必需变量：**

- `USERNAME`: 管理员账号（必填）
- `PASSWORD`: 管理员密码（必填）

**存储配置（根据需求选择一种）：**

1. **localStorage（默认）** - 无需额外配置，数据仅存储在浏览器本地
2. **Upstash Redis（推荐）** - 支持多端数据同步
3. **原生 Redis** - 需要自建 Redis 服务
4. **KvRocks** - 需要自建 KvRocks 服务

配置完成后，Zeabur 会自动重新部署。部署成功后，访问分配的域名即可使用。

**Upstash Redis 配置示例：**

如需使用 Upstash Redis 实现多端数据同步：

1. 在 [Upstash](https://upstash.com/) 注册并创建 Redis 实例
2. 复制 **HTTPS ENDPOINT** 和 **TOKEN**
3. 在 Zeabur 项目设置中添加环境变量：
   ```
   NEXT_PUBLIC_STORAGE_TYPE=upstash
   UPSTASH_URL=<你的 Upstash HTTPS Endpoint>
   UPSTASH_TOKEN=<你的 Upstash Token>
   ```

**其他存储类型配置：**

- **Redis**: `NEXT_PUBLIC_STORAGE_TYPE=redis` + `REDIS_URL=<redis连接地址>`
- **KvRocks**: `NEXT_PUBLIC_STORAGE_TYPE=kvrocks` + `KVROCKS_URL=<kvrocks连接地址>`

**其他可选配置：**

- `NEXT_PUBLIC_SITE_NAME`: 站点名称（默认: MoonTV）
- `ANNOUNCEMENT`: 站点公告文本
- `NEXT_PUBLIC_SEARCH_MAX_PAGE`: 搜索最大页数（默认: 5）
- `NEXT_PUBLIC_ENABLE_REGISTER`: 是否开放注册（默认: false）

> 更多环境变量配置请参考 [环境变量](#环境变量) 章节。

存储支持矩阵

|               | Docker | Vercel | Cloudflare | Zeabur |
| :-----------: | :----: | :----: | :--------: | :----: |
| localstorage  |   ✅   |   ✅   |     ✅     |   ✅   |
|  原生 redis   |   ✅   |        |            |   ✅   |
| Cloudflare D1 |        |        |     ✅     |        |
| Upstash Redis |   ☑️   |   ✅   |     ☑️     |   ✅   |
|    KvRocks    |   ✅   |        |            |   ✅   |

✅：经测试支持

☑️：理论上支持，未测试

除 localstorage 方式外，其他方式都支持多账户、记录同步和管理页面

### Vercel 部署

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Vercel](https://vercel.com/)，点击 **Add New → Project**，选择 Fork 后的仓库。
3. 设置 PASSWORD 环境变量。
4. 保持默认设置完成首次部署。
5. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
6. 每次 Push 到 `main` 分支将自动触发重新构建。

部署完成后即可通过分配的域名访问，也可以绑定自定义域名。

#### Upstash Redis 支持

0. 完成普通部署并成功访问。
1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 返回你的 Vercel 项目，新增环境变量 **UPSTASH_URL 和 UPSTASH_TOKEN**，值为第二步复制的 endpoint 和 token
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **upstash**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Cloudflare 部署

**Cloudflare Pages 的环境变量尽量设置为密钥而非文本**

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Cloudflare](https://cloudflare.com)，点击 **计算（Workers）-> Workers 和 Pages**，点击创建
3. 选择 Pages，导入现有的 Git 存储库，选择 Fork 后的仓库
4. 构建命令填写 **pnpm install --frozen-lockfile && pnpm run pages:build**，预设框架为无，**构建输出目录**为 `.vercel/output/static`
5. 保持默认设置完成首次部署。进入设置，将兼容性标志设置为 `nodejs_compat`，无需选择，直接粘贴
6. 首次部署完成后进入设置，新增 PASSWORD 密钥（变量和机密下），而后重试部署。
7. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
8. 每次 Push 到 `main` 分支将自动触发重新构建。

#### D1 支持

0. 完成普通部署并成功访问
1. 点击 **存储和数据库 -> D1 SQL 数据库**，创建一个新的数据库，名称随意
2. 进入刚创建的数据库，点击左上角的 Explore Data，将[D1 初始化](D1初始化.md) 中的内容粘贴到 Query 窗口后点击 **Run All**，等待运行完成
3. 返回你的 pages 项目，进入 **设置 -> 绑定**，添加绑定 D1 数据库，选择你刚创建的数据库，变量名称填 **DB**
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **d1**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Docker 部署

#### 1. 直接运行（最简单，localstorage）

```bash
# 拉取预构建镜像
docker pull ghcr.io/senshinya/moontv:latest

# 运行容器
# -d: 后台运行  -p: 映射端口 3000 -> 3000
docker run -d --name moontv -p 3000:3000 --env PASSWORD=your_password ghcr.io/senshinya/moontv:latest
```

访问 `http://服务器 IP:3000` 即可。（需自行到服务器控制台放通 `3000` 端口）

## Docker Compose 最佳实践

若你使用 docker compose 部署，以下是一些 compose 示例

### local storage 版本

```yaml
services:
  moontv:
    image: ghcr.io/senshinya/moontv:latest
    container_name: moontv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=your_password
    # 如需自定义配置，可挂载文件
    # volumes:
    #   - ./config.json:/app/config.json:ro
```

### Redis 版本（推荐，多账户数据隔离，跨设备同步）

```yaml
services:
  moontv-core:
    image: ghcr.io/senshinya/moontv:latest
    container_name: moontv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://moontv-redis:6379
      - NEXT_PUBLIC_ENABLE_REGISTER=true
    networks:
      - moontv-network
    depends_on:
      - moontv-redis
    # 如需自定义配置，可挂载文件
    # volumes:
    #   - ./config.json:/app/config.json:ro
  moontv-redis:
    image: redis
    container_name: moontv-redis
    restart: unless-stopped
    networks:
      - moontv-network
    # 如需持久化
    # volumes:
    #   - ./data:/data
networks:
  moontv-network:
    driver: bridge
```

## 自动同步最近更改

建议在 fork 的仓库中启用本仓库自带的 GitHub Actions 自动同步功能（见 `.github/workflows/sync.yml`）。

如需手动同步主仓库更新，也可以使用 GitHub 官方的 [Sync fork](https://docs.github.com/cn/github/collaborating-with-issues-and-pull-requests/syncing-a-fork) 功能。

## 环境变量

| 变量                              | 说明                                         | 可选值                           | 默认值                                                                                                                     |
| --------------------------------- | -------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| USERNAME                          | 非 localstorage 部署时的管理员账号           | 任意字符串                       | （空）                                                                                                                     |
| PASSWORD                          | 非 localstorage 部署时为管理员密码           | 任意字符串                       | （空）                                                                                                                     |
| SITE_NAME                         | 站点名称                                     | 任意字符串                       | MoonTV                                                                                                                     |
| ANNOUNCEMENT                      | 站点公告                                     | 任意字符串                       | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |
| NEXT_PUBLIC_STORAGE_TYPE          | 播放记录/收藏的存储方式                      | localstorage、redis、d1、upstash | localstorage                                                                                                               |
| REDIS_URL                         | redis 连接 url                               | 连接 url                         | 空                                                                                                                         |
| UPSTASH_URL                       | upstash redis 连接 url                       | 连接 url                         | 空                                                                                                                         |
| UPSTASH_TOKEN                     | upstash redis 连接 token                     | 连接 token                       | 空                                                                                                                         |
| NEXT_PUBLIC_ENABLE_REGISTER       | 是否开放注册，仅在非 localstorage 部署时生效 | true / false                     | false                                                                                                                      |
| NEXT_PUBLIC_SEARCH_MAX_PAGE       | 搜索接口可拉取的最大页数                     | 1-50                             | 5                                                                                                                          |
| NEXT_PUBLIC_IMAGE_PROXY           | 默认的浏览器端图片代理                       | url prefix                       | (空)                                                                                                                       |
| NEXT_PUBLIC_DOUBAN_PROXY          | 默认的浏览器端豆瓣数据代理                   | url prefix                       | (空)                                                                                                                       |
| NEXT_PUBLIC_DISABLE_YELLOW_FILTER | 关闭色情内容过滤                             | true/false                       | false                                                                                                                      |

## 配置说明

所有可自定义项集中在根目录的 `config.json` 中：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://caiji.dyttzyapi.com/api.php/provide/vod",
      "name": "电影天堂资源",
      "detail": "http://caiji.dyttzyapi.com"
    }
    // ...更多站点
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。
  - `official_parser`：（可选）是否为官方解析资源，默认为 `false`。当为 `true` 时，播放地址需要经过官方解析器解密后才能播放。
    - 解析器 URL 使用固定的默认值（`https://jx.789jiexi.com`），与 `detail` 字段无关
    - **搜索阶段**：从 `vod_play_url` 中提取所有播放源的第三方视频网站 URL（腾讯、优酷、爱奇艺等）
    - **API 层自动解密**：在 API 返回前自动解密所有 URL，返回真实的 m3u8 或 MP4 播放地址
    - **播放阶段**：网页端播放时也会自动调用解密 API（双重保障）
    - 支持 MP4 格式的试看片段播放
    - **OrionTV 兼容**：API 返回的 URL 可以直接播放，无需客户端解密
- `custom_category`：自定义分类配置，用于在导航中添加个性化的影视分类。以 type + query 作为唯一标识。支持以下字段：
  - `name`：分类显示名称（可选，如不提供则使用 query 作为显示名）
  - `type`：分类类型，支持 `movie`（电影）或 `tv`（电视剧）
  - `query`：搜索关键词，用于在豆瓣 API 中搜索相关内容

custom_category 支持的自定义分类已知如下：

- movie：热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈
- tv：热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片

也可输入如 "哈利波特" 效果等同于豆瓣搜索

MoonTV 支持标准的苹果 CMS V10 API 格式。

修改后 **无需重新构建**，服务会在启动时读取一次。

## 管理员配置

**该特性目前仅支持通过非 localstorage 存储的部署方式使用**

支持在运行时动态变更服务配置

设置环境变量 USERNAME 和 PASSWORD 即为站长用户，站长可设置用户为管理员

站长或管理员访问 `/admin` 即可进行管理员配置

## AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端。

### API 接口

MoonTV 提供以下 OrionTV 兼容的 API 接口：

- `/api/search/resources` - 获取资源站点列表
- `/api/search/one?q={query}&resourceId={sourceId}` - 单源搜索
- `/api/detail?id={id}&source={source}` - 获取视频详情
- `/api/image-proxy?url={imageUrl}` - 图片代理

### 官方解析资源支持

对于配置了 `official_parser: true` 的资源源，API 会自动解密第三方视频网站 URL，返回真实的 m3u8 或 MP4 播放地址，OrionTV 可以直接播放。

**配置示例**：

```json
{
  "api_site": {
    "789caiji": {
      "api": "https://www.caiji.cyou/api.php/provide/vod",
      "name": "789采集",
      "official_parser": true
    }
  }
}
```

**注意事项**：

- 解密失败时，API 会返回空数组（不返回无法播放的原始 URL）
- 解密过程需要 3-10 秒，请耐心等待
- 部分资源可能只能获取试看片段

暂时收藏夹与播放记录和网页端隔离，后续会支持同步用户数据

## 📢 重要更新

### 2025-01-28: 本地资源检测多平台优化 ⭐ 关键修复

修复了前端无限循环和 Edge Runtime 兼容性问题，提升了构建稳定性和运行性能。

**核心修复**：

- ✅ 修复前端无限循环问题，页面不再疯狂刷新
- ✅ 修复 Edge Runtime 构建错误，构建成功
- ✅ 升级 TypeScript 到 5.9.3，解决内存问题

**相关文档**：

- 📄 [本地资源检测多平台优化方案 - PRD](docs/optimization/250128-本地资源检测多平台优化方案-PRD.md)
- 📄 [本地资源检测多平台优化方案 - 实施总结](docs/optimization/250128-本地资源检测多平台优化方案-实施总结.md)
- 📄 [本地资源播放路径和 SSR 错误修复](docs/fixes/250128-本地资源播放路径和SSR错误修复-FIX.md)

---

### 2025-01-26: 官方解析 API 层自动解密功能 ⭐ 新功能

新增官方解析 API 层自动解密功能，支持在 API 返回前自动解密官方解析资源，返回真实的 m3u8 或 MP4 播放地址。OrionTV 等第三方客户端可以直接使用解密后的 URL，无需客户端解密。

**核心特性**：

- ✅ API 层自动解密，OrionTV 可直接使用
- ✅ Edge Runtime 兼容，通过 HTTP API 调用解密
- ✅ 解密失败时清空 episodes，不返回无法播放的 URL
- ✅ 只有 `official_parser: true` 的源才解密

**相关文档**：

- 📄 [功能 PRD](docs/features/250126-官方解析API层自动解密功能-PRD.md)
- 📄 [实现总结](docs/features/250126-官方解析API层自动解密功能-实现总结.md)
- 📄 [测试验证](docs/features/250126-官方解析API层自动解密功能-测试验证.md)

---

### 2025-01-24: 直接播放路由功能 ⭐ 新功能

新增直接播放路由功能，支持通过 `/player?url=<视频地址>` 直接播放视频，无需经过搜索、详情页等复杂流程。

**使用示例**：

```
/player?url=https://example.com/video.m3u8
```

**相关文档**：

- 📄 [直接播放路由 - 使用指南](docs/guides/250124-直接播放路由-使用指南.md)
- 📄 [功能实施总结](docs/features/250124-直接播放路由功能.md)

---

## Roadmap

- [x] 深色模式
- [x] 持久化存储
- [x] 多账户
- [x] 直接播放路由
- [x] 官方解析功能
- [x] 官方解析 API 层自动解密

## 📚 项目文档

### 功能文档

- 📄 [直接播放路由功能 - PRD](docs/features/direct-player-prd.md)
- 📄 [直接播放路由功能 - 实施总结](docs/features/250124-直接播放路由功能.md)
- 📄 [官方解析功能 - PRD](docs/features/250125-官方解析功能-PRD.md)
- 📄 [官方解析功能 - 实现总结](docs/features/250125-官方解析功能-实现总结.md)
- 📄 [官方解析 API 层自动解密功能 - PRD](docs/features/250126-官方解析API层自动解密功能-PRD.md)
- 📄 [官方解析 API 层自动解密功能 - 实现总结](docs/features/250126-官方解析API层自动解密功能-实现总结.md)

### 使用指南

- 📄 [直接播放路由 - 使用指南](docs/guides/250124-直接播放路由-使用指南.md)

### 测试文档

- 📄 [官方解析 API 层自动解密功能 - 测试验证](docs/features/250126-官方解析API层自动解密功能-测试验证.md)

### 优化文档

- 📄 [本地资源检测多平台优化方案 - PRD](docs/optimization/250128-本地资源检测多平台优化方案-PRD.md)
- 📄 [本地资源检测多平台优化方案 - 实施总结](docs/optimization/250128-本地资源检测多平台优化方案-实施总结.md)

### 修复文档

- 📄 [播放器容器初始化失败修复](docs/fixes/250124-播放器容器初始化失败-FIX.md)
- 📄 [本地资源播放路径和 SSR 错误修复](docs/fixes/250128-本地资源播放路径和SSR错误修复-FIX.md)

### 项目状态

- 📄 [更新日志](CHANGELOG.md)
- 📄 [项目状态](PROJECT_STATUS.md)
- 📄 [代码地图](CODE_MAP.md)

## 安全与隐私提醒

### 请设置密码保护并关闭公网注册

为了您的安全和避免潜在的法律风险，我们要求在部署时设置密码保护并**强烈建议关闭公网注册**：

- **避免公开访问**：不设置密码的实例任何人都可以访问，可能被恶意利用
- **防范版权风险**：公开的视频搜索服务可能面临版权方的投诉举报
- **保护个人隐私**：设置密码可以限制访问范围，保护您的使用记录

### 部署要求

1. **设置环境变量 `PASSWORD`**：为您的实例设置一个强密码
2. **仅供个人使用**：请勿将您的实例链接公开分享或传播
3. **遵守当地法律**：请确保您的使用行为符合当地法律法规

### 重要声明

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任

## License

[MIT](LICENSE) © 2025 MoonTV & Contributors

## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- 感谢所有提供免费影视接口的站点。
