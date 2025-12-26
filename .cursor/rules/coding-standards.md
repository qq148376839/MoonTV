# 编码规范

## 💻 TypeScript 规范

### 类型定义

- ✅ 所有函数必须定义明确的参数类型和返回类型
- ✅ 使用 `interface` 定义对象结构，使用 `type` 定义联合类型和工具类型
- ✅ 避免使用 `any`，优先使用 `unknown` 或具体类型
- ✅ 数据库查询结果必须定义类型

### 命名规范

- **文件命名**: 使用 kebab-case（如 `video-card.tsx`）或 PascalCase（如 `VideoCard.tsx` 用于组件）
- **类命名**: 使用 PascalCase（如 `VideoPlayer`）
- **函数/变量命名**: 使用 camelCase（如 `searchVideos`）
- **常量命名**: 使用 UPPER_SNAKE_CASE（如 `MAX_SEARCH_PAGES`）
- **接口/类型命名**: 使用 PascalCase（如 `SearchResult`、`VideoDetail`）

### 代码组织

- ✅ 每个服务文件只包含一个主要类或服务
- ✅ 工具函数放在 `utils/` 目录
- ✅ 配置相关代码放在 `config/` 目录
- ✅ 路由处理函数应该简洁，业务逻辑放在服务层

## 🔄 错误处理规范

### 统一错误处理

- ✅ API 路由返回标准错误响应格式
- ✅ 错误信息应该清晰明确，便于调试
- ✅ 使用 HTTP 状态码表示错误类型

### 错误处理模式

```typescript
// ✅ 正确：API 路由错误处理
try {
  const result = await someOperation();
  return NextResponse.json(result);
} catch (error) {
  console.error('Operation failed:', error);
  return NextResponse.json({ error: '操作失败' }, { status: 500 });
}

// ✅ 正确：客户端错误处理
try {
  const response = await fetch('/api/search?q=关键词');
  if (!response.ok) {
    throw new Error('搜索失败');
  }
  const data = await response.json();
} catch (error) {
  console.error('Search error:', error);
  // 显示错误提示给用户
}
```

## 📝 日志规范

### 日志级别

- `console.error()` - 错误和异常
- `console.warn()` - 警告信息
- `console.info()` - 重要业务信息（搜索请求、播放记录等）
- `console.debug()` - 调试信息（仅在开发环境）

### 日志规范

- ✅ 关键操作必须记录日志（搜索请求、播放记录保存、管理员操作）
- ✅ 错误日志应该包含足够的上下文信息
- ✅ 避免在生产环境输出过多调试日志
- ✅ 敏感信息（密码、Token）不应该记录到日志

## 🗄️ 数据库规范

### 数据库抽象层

- ✅ 通过统一的抽象层 (`src/lib/db.ts`) 访问数据库
- ✅ 支持多种存储方式（localStorage / Redis / D1 / Upstash）
- ✅ 数据库操作必须定义类型（TypeScript）

### 查询规范

- ✅ D1 数据库使用参数化查询防止 SQL 注入
- ✅ Redis 操作使用键值对存储
- ✅ 查询结果必须定义类型

### 数据迁移

- ✅ D1 数据库初始化脚本在 `D1初始化.md`
- ✅ 数据库结构变更需要更新初始化脚本

## 📝 代码注释

### 函数注释

```typescript
/**
 * 搜索影视资源
 * @param query - 搜索关键词
 * @param maxPages - 最大搜索页数（默认5）
 * @returns 搜索结果列表
 */
async searchVideos(query: string, maxPages: number = 5): Promise<SearchResult[]> {
  // ...
}
```

### 复杂逻辑注释

- ✅ 复杂算法必须添加注释说明
- ✅ 业务规则必须注释说明
- ✅ TODO 和 FIXME 注释必须包含问题描述

## ⚠️ 代码质量约束

### 禁止事项

- ❌ 禁止使用 `any` 类型（除非绝对必要）
- ❌ 禁止硬编码配置值
- ❌ 禁止忽略错误处理
- ❌ 禁止提交包含敏感信息的代码

### 必须事项

- ✅ 所有 API 路由必须包含错误处理
- ✅ 所有数据库操作必须通过抽象层访问
- ✅ 所有关键操作必须记录日志（搜索、播放记录、管理员操作）
- ✅ 所有新功能必须编写文档
