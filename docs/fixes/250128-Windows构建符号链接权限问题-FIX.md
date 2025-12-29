# Windows 构建符号链接权限问题修复说明

## 📋 问题描述

在 Windows 上构建 Next.js standalone 输出时，出现以下错误：

```
Error: EPERM: operation not permitted, symlink
```

这是因为 Next.js 在构建 standalone 输出时尝试创建符号链接，但 Windows 需要特殊权限。

## ✅ 已修复的问题

### 1. 动态路由警告

已为以下 API 路由添加 `export const dynamic = 'force-dynamic'`：

- `src/app/api/local-video/route.ts`
- `src/app/api/local-resource/route.ts`
- `src/app/api/[episode]/[segment]/route.ts`

这解决了构建时的动态服务器使用警告。

### 2. 构建追踪堆栈溢出问题

**问题**：`experimental.outputFileTracingIncludes` 配置中的 `'./node_modules/**/*'` 路径过于宽泛，导致 Next.js 在追踪文件时出现 `Maximum call stack size exceeded` 错误。

**修复**：已移除该配置。Next.js 会自动追踪需要的文件，不需要手动配置包含所有 node_modules。

**注意**：如果遇到 Windows 符号链接权限问题，请使用下面的解决方案，而不是修改 `outputFileTracingIncludes` 配置。

## 🔧 Windows 符号链接权限问题解决方案

### 方案 1：启用 Windows 开发者模式（推荐）

1. 打开 **设置** → **更新和安全** → **开发者选项**
2. 启用 **开发人员模式**
3. 重启计算机（如果需要）
4. 重新运行构建命令

### 方案 2：以管理员权限运行

1. 右键点击 PowerShell 或命令提示符
2. 选择 **以管理员身份运行**
3. 导航到项目目录
4. 运行构建命令：

```bash
pnpm run build
```

### 方案 3：清理并重新构建

有时清理构建缓存可以解决问题：

```bash
# 删除 .next 目录
Remove-Item -Recurse -Force .next

# 重新构建
pnpm run build
```

### 方案 4：使用环境变量（临时方案）

如果上述方案都不行，可以尝试设置环境变量：

```powershell
# PowerShell
$env:NEXT_TELEMETRY_DISABLED=1
pnpm run build
```

### 方案 5：修改构建脚本（如果持续失败）

如果问题持续存在，可以考虑：

1. **临时禁用 standalone 输出**（仅用于本地构建测试）：

   - 修改 `next.config.js`，注释掉 `output: 'standalone'`
   - 注意：这会影响 Docker 部署，仅用于本地测试

2. **使用 Docker 构建**（推荐用于生产环境）：
   ```bash
   docker-compose build
   ```

## 📝 注意事项

1. **开发者模式是最佳解决方案**：启用后，Windows 会允许应用程序创建符号链接，无需管理员权限。

2. **Docker 构建不受影响**：如果在 Docker 容器中构建，不会遇到这个问题，因为 Linux 容器支持符号链接。

3. **构建警告不影响功能**：即使出现符号链接错误，如果构建最终完成，应用仍然可以正常运行。

## 🎯 验证修复

修复后，重新运行构建：

```bash
pnpm run build
```

应该看到：

- ✅ 没有动态服务器使用警告
- ✅ 构建成功完成（或只有符号链接警告，但不影响最终输出）

## 📚 相关文档

- [Next.js Standalone 输出文档](https://nextjs.org/docs/advanced-features/output-file-tracing)
- [Windows 开发者模式说明](https://docs.microsoft.com/zh-cn/windows/apps/get-started/enable-your-device-for-development)
