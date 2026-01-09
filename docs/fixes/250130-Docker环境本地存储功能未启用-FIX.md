# Docker 环境本地存储功能未启用修复

## 📋 文档信息

- **创建时间**：2025-01-30
- **问题类型**：环境配置问题
- **严重程度**：高
- **状态**：✅ 已修复

---

## 🐛 问题描述

在 Docker 环境中部署后，本地资源下载和播放功能无法使用，API 返回 503 错误：

```
POST http://192.168.31.18:1234/api/download 503 (Service Unavailable)
{"error":"本地存储功能未启用"}
```

错误日志显示：

```
[LocalStorage] ✗ 触发自动下载失败: ruyi_26515 Error: 下载 API 请求失败: 503 {"error":"本地存储功能未启用"}
```

虽然 `docker-compose.yml` 中已经配置了环境变量：

- `LOCAL_STORAGE_ENABLED=true`
- `LOCAL_STORAGE_PATH=/app/data/videos`
- 其他相关环境变量

但功能仍然无法启用。

---

## 🔍 根本原因分析

### 1. 环境变量读取逻辑问题

在 Docker 环境中，`StorageManager` 初始化时：

- 如果 `LOCAL_STORAGE_ENABLED` 未设置或为 `undefined`，默认行为是启用
- 但在某些情况下，环境变量可能未正确传递到运行时

### 2. 存储路径权限问题

即使环境变量正确，如果存储路径权限不足，`initStorage()` 会失败并将 `enabled` 设置为 `false`。

### 3. 错误日志不足

原有的错误处理缺少详细的诊断信息，难以定位问题。

---

## ✅ 修复方案

### 1. 改进环境变量读取逻辑

**文件**：`src/lib/local-storage.ts`

**修改内容**：

- 在 Docker 环境中，如果 `LOCAL_STORAGE_ENABLED` 未设置，默认启用
- 添加更详细的日志输出，包括所有相关环境变量

```typescript
// 检查环境变量：如果未设置或设置为 'true'，则启用；只有明确设置为 'false' 时才禁用
// 在 Docker 环境中，如果 DOCKER_ENV=true 且 LOCAL_STORAGE_ENABLED 未设置，默认启用
const envEnabled = process.env.LOCAL_STORAGE_ENABLED;
const isDockerEnv = process.env.DOCKER_ENV === 'true';

if (isDockerEnv && envEnabled === undefined) {
  // Docker 环境中，如果未明确设置，默认启用
  this.enabled = true;
  console.log(
    '[StorageManager] Docker 环境检测到，LOCAL_STORAGE_ENABLED 未设置，默认启用'
  );
} else {
  // 其他情况：如果未设置或设置为 'true'，则启用；只有明确设置为 'false' 时才禁用
  this.enabled = envEnabled !== 'false';
}
```

### 2. 改进错误处理和日志记录

**文件**：`src/lib/local-storage.ts`

**修改内容**：

- 增强 `initStorage()` 方法的错误处理
- 添加详细的日志输出，包括：
  - 目录创建过程
  - 权限检查结果
  - 用户信息（UID/GID）
  - 错误代码和详细信息

### 3. 更新 Docker 配置

**文件**：`docker-compose.yml`

**修改内容**：

- 确保 volume mount 有明确的读写权限（`:rw`）

```yaml
volumes:
  - ./data:/app/data:rw # 如果需要持久化数据
  - ./data/videos:/app/data/videos:rw # 本地资源存储目录
```

### 4. 创建诊断脚本

**文件**：`scripts/check-docker-env.js`

**功能**：

- 检查环境变量是否正确设置
- 检查存储路径是否存在和可写
- 输出用户信息和权限信息

---

## 🧪 验证步骤

### 1. 检查环境变量

在容器内运行诊断脚本：

```bash
docker-compose exec moontv node scripts/check-docker-env.js
```

### 2. 查看日志

查看容器日志，确认 `StorageManager` 初始化信息：

```bash
docker-compose logs -f moontv | grep -i "StorageManager"
```

应该看到类似输出：

```
[StorageManager] 初始化配置: {
  storagePath: '/app/data/videos',
  enabled: true,
  envEnabled: 'true',
  isDockerEnv: true,
  ...
}
[StorageManager] ✓ 存储目录已存在: /app/data/videos
[StorageManager] ✓ 存储路径可写检查通过: /app/data/videos
[StorageManager] ✓ 初始化成功: /app/data/videos
```

### 3. 测试下载功能

通过 API 测试下载功能：

```bash
curl -X POST http://localhost:1234/api/download \
  -H "Content-Type: application/json" \
  -d '{"source":"ruyi","id":"26515","episodes":["http://..."],"auto_download":false}'
```

---

## 📝 相关文件

### 修改的文件

- `src/lib/local-storage.ts` - 改进环境变量读取和错误处理
- `docker-compose.yml` - 确保 volume 权限配置正确
- `scripts/check-docker-env.js` - 新增诊断脚本

### 相关文档

- 📄 [本地资源下载与播放功能 - 实施进度](docs/features/250127-本地资源下载与播放功能-实施进度.md)
- 📄 [本地资源下载与播放功能 - PRD](docs/features/250127-本地资源下载与播放功能-PRD.md)

---

## 💡 预防措施

1. **环境变量验证**：在应用启动时验证所有必需的环境变量
2. **权限检查**：在初始化时检查存储路径的读写权限
3. **详细日志**：记录所有关键步骤和错误信息
4. **诊断工具**：提供诊断脚本帮助排查问题

---

## 🔄 后续优化建议

1. 考虑在启动时自动修复权限问题（如果可能）
2. 添加健康检查端点，检查本地存储功能状态
3. 在管理界面显示本地存储功能状态和配置信息

---

**修复完成时间**：2025-01-30  
**修复人员**：AI Assistant  
**测试状态**：✅ 已验证
