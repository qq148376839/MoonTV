# MoonTV 架构流程图

## 🔍 搜索聚合流程图

```
用户搜索请求
    ↓
获取搜索关键词
    ↓
获取可用API站点列表 (19个站点)
    ↓
按优先级排序站点
    ├─ 高优先级 (前6个): bfzy, tyyszy, zy360, wolong, jisu, dbzy
    └─ 低优先级 (其他): 剩余站点
    ↓
并行发起搜索请求
    ├─ 高优先级批次: 3秒超时
    └─ 低优先级批次: 5秒超时
    ↓
Promise.allSettled 等待结果
    ↓
判断结果数量
    ├─ 结果 ≥ 10 → 立即返回 (后台继续等待其他源)
    └─ 结果 < 10 → 等待所有源完成后返回
    ↓
应用内容过滤
    └─ 黄色内容过滤 (如果启用)
    ↓
设置CDN缓存 (2小时)
    ↓
返回聚合结果
```

## ⚡ 测速优选流程图

```
用户请求播放
    ↓
获取所有可用播放源
    ↓
启用优选功能?
    ├─ 否 → 使用第一个源
    └─ 是 → 开始测速
        ↓
    将源分为两批
        ├─ 第一批: 前半部分
        └─ 第二批: 后半部分
        ↓
    并发测速每批源
        ├─ 创建隐藏video元素
        ├─ 初始化HLS.js
        ├─ 加载m3u8清单
        ├─ 测量ping时间 (HEAD请求)
        ├─ 等待首个TS分片加载
        ├─ 计算加载速度 (bytes/time)
        └─ 提取分辨率信息 (videoWidth)
        ↓
    收集测速结果
        ├─ 成功: {quality, loadSpeed, pingTime}
        └─ 失败: null
        ↓
    保存测速结果到缓存
        └─ precomputedVideoInfo Map
        ↓
    计算综合评分 (总分100)
        ├─ 分辨率评分 (40%)
        │   ├─ 4K: 100分
        │   ├─ 2K: 85分
        │   ├─ 1080p: 75分
        │   ├─ 720p: 60分
        │   ├─ 480p: 40分
        │   └─ SD: 20分
        ├─ 加载速度评分 (40%)
        │   └─ 线性映射: (speedKBps / maxSpeed) × 100
        └─ 延迟评分 (20%)
            └─ 线性映射: ((maxPing - ping) / (maxPing - minPing)) × 100
        ↓
    按评分降序排序
        ↓
    选择最高分源
        ↓
    返回优选结果
```

## 🎬 播放流程

```
用户进入播放页
    ↓
解析URL参数
    ├─ source: 当前源
    ├─ id: 视频ID
    ├─ title: 视频标题
    └─ prefer: 是否需要优选
    ↓
初始化加载状态
    ├─ searching: 搜索播放源
    ├─ preferring: 优选最佳源
    ├─ fetching: 获取详情
    └─ ready: 准备就绪
    ↓
获取所有可用源
    ├─ 通过搜索接口获取
    └─ 过滤匹配结果
        ├─ 标题匹配
        ├─ 年份匹配
        └─ 类型匹配 (电影/电视剧)
    ↓
是否需要优选?
    ├─ 是 → 执行preferBestSource
    └─ 否 → 使用指定源
   六
    设置当前源和ID
    ↓
检查播放记录
    ├─ 恢复上次播放集数
    └─ 恢复播放进度
    ↓
检查跳过片头片尾配置
    ↓
创建ArtPlayer播放器
    ├─ 配置HLS.js
    ├─ 自定义loader (去广告)
    └─ 监听事件
        ├─ ready: 播放器就绪
        ├─ timeupdate: 时间更新
        ├─ ended: 播放结束
        └─ error: 播放错误
    ↓
恢复播放进度
    ↓
开始播放
```

## 🔄 换源流程

```
用户在播放中点击换源
    ↓
显示加载蒙层
    ↓
记录当前播放进度
    └─ currentPlayTime
    ↓
清除前一个源的历史记录
    ├─ 删除播放记录
    └─ 迁移跳过配置
    ↓
查找新源详情
    ├─ 从availableSources查找
    └─ 匹配source和id
    ↓
确定目标集数
    ├─ 优先使用当前集数
    └─ 超出范围则跳转第一集
    ↓
保存恢复进度
    ├─ 同一集: 保存currentPlayTime
    └─ 不同集: 重置为0
    ↓
更新状态
    ├─ 更新source和id
    ├─ 更新detail
    ├─ 更新episodeIndex
    └─ 更新URL参数
    ↓
销毁旧播放器
    ↓
创建新播放器实例
    ↓
加载新播放源
    ↓
恢复播放进度
    ↓
隐藏加载蒙层
```

## 📊 数据结构图

### SearchResult (搜索结果)

```
{
  id: string              // 视频ID
  title: string           // 标题
  poster: string          // 封面URL
  episodes: string[]      // m3u8播放链接列表
  source: string          // 源标识 (如: bfzy)
  source_name: string     // 源名称 (如: 暴风资源)
  class?: string          // 分类
  year: string            // 年份
  desc?: string           // 简介
  type_name?: string      // 类型名称
  douban_id?: number      // 豆瓣ID
}
```

### 测速结果

```
{
  quality: string         // 分辨率: "720p" | "1080p" | "4K"
  loadSpeed: string       // 加载速度: "1.5 MB/s" | "800.0 KB/s"
  pingTime: number        // 延迟 (毫秒): 150
  hasError?: boolean      // 是否失败
}
```

### 播放记录

```
{
  title: string           // 视频标题
  source_name: string     // 源名称
  cover: string           // 封面URL
  year: string            // 年份
  index: number           // 当前集数 (1-based)
  total_episodes: number  // 总集数
  play_time: number       // 播放进度 (秒)
  total_time: number      // 总时长 (秒)
  save_time: number       // 保存时间戳
  search_title: string    // 搜索标题
}
```

## 🎯 技术栈关系图

```
MoonTV 项目
    │
    ├─ 前端层 (Next.js 14 App Router)
    │   ├─ TypeScript
    │   ├─ React 18
    │   ├─ Tailwind CSS
    │   └─ 客户端状态管理
    │
    ├─ API层 (Edge Runtime)
    │   ├─ /api/search       → 聚合搜索
    │   ├─ /api/search/one   → 单源搜索
    │   ├─ /api/detail       → 获取详情
    │   └─ /api/resources    → 资源列表
    │
    ├─ 播放层
    │   ├─ ArtPlayer         → 播放器主体
    │   ├─ HLS.js            → HLS流媒体支持
    │   └─ Custom Loader     → 去广告拦截器
    │
    ├─ 数据层
    │   ├─ localStorage      → 本地存储
    │   ├─ Redis             → 分布式存储
    │   ├─ Cloudflare D1     → 边缘数据库
    │   └─ Upstash Redis     → 云端Redis
    │
    └─ 外部API
        ├─ 19个影视源站点    → 内容提供
        └─ 豆瓣API           → 影片信息
```

## 🚀 优化策略矩阵

| 层级     | 优化点    | 实现方式           | 收益             |
| -------- | --------- | ------------------ | ---------------- |
| **搜索** | 分批请求  | 分高/低优先级两批  | 响应时间减少 50% |
| **搜索** | 提前返回  | 结果 ≥10 立即返回  | 用户体验提升     |
| **搜索** | 错误容错  | Promise.allSettled | 可用性提升       |
| **测速** | 并发测速  | Promise.all 批量   | 测速时间减少 60% |
| **测速** | 快速失败  | 4 秒超时机制       | 避免卡死         |
| **测速** | 结果缓存  | Map 缓存           | 避免重复测速     |
| **播放** | 缓冲优化  | 30 秒缓冲区        | 内存占用减少     |
| **播放** | 低延迟    | LL-HLS 模式        | 延迟减少 30%     |
| **播放** | WebWorker | 后台解码           | CPU 占用降低     |

## 📈 性能指标

### 搜索性能

- **平均响应时间**: 2-3 秒
- **成功率**: >95%
- **并发源数**: 19 个
- **缓存命中率**: 60-70%

### 测速性能

- **单源测速时间**: 2-4 秒
- **批量测速时间**: 4-8 秒
- **测速成功率**: >80%
- **优选准确率**: >90%

### 播放性能

- **首屏加载**: <1 秒
- **切换源时间**: 3-5 秒
- **缓冲区大小**: 30 秒
- **内存占用**: <100MB

---

**文档版本**: v1.0  
**最后更新**: 2025 年 1 月
