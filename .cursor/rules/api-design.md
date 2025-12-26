# API 设计规范

## 🔄 RESTful API 规范

### 路由命名

- ✅ 使用名词（如 `/api/search`, `/api/detail`）
- ✅ 查询参数使用 query string（如 `/api/search?q=关键词`）
- ✅ 使用 HTTP 动词: GET, POST, PUT, DELETE

### 响应格式

```typescript
// 搜索 API 响应
{
  "results": [
    {
      "id": "12345",
      "title": "影片标题",
      "poster": "封面URL",
      "episodes": ["m3u8链接1", "m3u8链接2"],
      "source": "bfzy",
      "source_name": "暴风资源",
      "year": "2024"
    }
  ]
}

// 错误响应
{
  "error": "错误描述"
}
```

### 状态码

- `200` - 成功
- `400` - 请求参数错误
- `401` - 未授权
- `404` - 资源不存在
- `500` - 服务器错误

## 🎬 影视资源 API 规范

### 资源站 API 格式

项目兼容**苹果 CMS V10 API 格式**：

```typescript
// 搜索接口
GET {api}/?ac=videolist&wd={query}
GET {api}/?ac=videolist&wd={query}&pg={page}

// 详情接口
GET {api}/?ac=videolist&ids={id}
```

### 响应格式

```json
{
  "code": 1,
  "msg": "数据列表",
  "page": 1,
  "pagecount": 5,
  "limit": 20,
  "total": 100,
  "list": [
    {
      "vod_id": "12345",
      "vod_name": "影片标题",
      "vod_pic": "封面URL",
      "vod_play_url": "播放链接",
      "vod_class": "类型",
      "vod_year": "2024",
      "vod_content": "简介"
    }
  ]
}
```

### 多源聚合搜索

- ✅ 支持同时搜索多个资源站点（默认 19 个站点）
- ✅ 使用分批请求策略（高优先级源 3 秒超时，低优先级源 5 秒超时）
- ✅ 结果充足时提前返回（≥10 个结果立即返回）
- ✅ 使用 `Promise.allSettled` 确保错误容错

### 播放源处理

- ✅ 使用正则表达式提取 m3u8 链接
- ✅ 支持多个播放源（使用 `$$$` 分割）
- ✅ 自动过滤无效链接

## 📊 API 优化

- ✅ 使用 CDN 缓存减少重复查询（默认 2 小时缓存）
- ✅ 搜索接口支持多页查询（默认最多 5 页）
- ✅ 使用 Edge Runtime 提升响应速度
- ✅ 错误容错机制（部分源失败不影响整体）
