# 当前待修复问题

## 🔴 高优先级 - 播放页面 SSR 错误

**问题描述：**

```
TypeError: Cannot read properties of undefined (reading 'length')
at app/play/page.js:705:47
```

**影响范围：**

- 播放页面 (`/play`) 在服务器端渲染时崩溃
- 可能导致页面无法正常加载

**已修复位置：**

- ✅ `src/app/play/page.tsx:2248` - 添加可选链
- ✅ `src/app/play/page.tsx:2500` - 添加数组检查

**待检查位置：**
需要全面检查所有 `.length` 访问，特别是：

- 组件顶层变量初始化
- JSX 渲染中的直接访问
- useEffect 中的数组访问

**修复步骤：**

1. 搜索所有未使用可选链的 `.length` 访问：

   ```bash
   grep -n "\.episodes\.length[^?]" src/app/play/page.tsx
   grep -n "\.length" src/app/play/page.tsx | grep -v "?\.length" | grep -v "Array.isArray"
   ```

2. 确保所有访问都使用：

   - 可选链：`detail?.episodes?.length`
   - 或先检查：`if (detail?.episodes && Array.isArray(detail.episodes))`

3. 测试 SSR：
   ```bash
   npm run build
   # 检查是否有构建错误
   ```

**相关文件：**

- `src/app/play/page.tsx` (主要问题文件)

---

## 📝 其他待办事项

### Cloudflare Worker 部署

- [ ] 部署 Worker 到 Cloudflare
- [ ] 配置 `NEXT_PUBLIC_CF_SEARCH_WORKER_URL` 环境变量
- [ ] 测试流式搜索功能

### M3U8 代理测试

- [ ] 验证广告清理功能
- [ ] 测试相对 URL 解析
- [ ] 确认播放器正常工作

---

**最后更新**: 2025-12-31  
**优先级**: 🔴 高 - 影响核心功能
