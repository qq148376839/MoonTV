# 测试规范

## 🧪 单元测试

### 测试要求

- ✅ 核心业务逻辑必须编写单元测试
- ✅ 测试文件命名: `*.test.ts` 或 `*.spec.ts`
- ✅ 测试覆盖率目标: 核心服务 > 80%

### 测试组织

- ✅ 测试文件放在 `__tests__/` 目录或与源文件同级
- ✅ 使用 Jest 作为测试框架
- ✅ Mock 外部依赖（数据库、API）

### 测试结构

```typescript
describe('VideoSearch', () => {
  describe('searchVideos', () => {
    it('should search videos from multiple sources', async () => {
      // Arrange
      const query = '测试视频';
      const maxPages = 5;

      // Act
      const result = await searchVideos(query, maxPages);

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
```

## 🔍 测试场景

### 核心测试场景

1. **搜索功能测试**

   - ✅ 多源聚合搜索
   - ✅ 搜索结果去重
   - ✅ 错误容错处理
   - ✅ 搜索超时处理

2. **播放功能测试**

   - ✅ 播放源测速
   - ✅ 播放源优选
   - ✅ 播放记录保存
   - ✅ 播放源切换

3. **数据存储测试**
   - ✅ 播放记录持久化
   - ✅ 收藏数据同步
   - ✅ 多账户数据隔离

## 📋 测试检查清单

- [ ] 所有核心服务都有单元测试
- [ ] 测试覆盖主要业务逻辑路径
- [ ] 测试包含错误场景
- [ ] 测试包含边界条件
- [ ] Mock 所有外部依赖
