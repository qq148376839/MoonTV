#!/bin/bash
# 修复 Docker 存储目录权限脚本
# 使用方法: ./scripts/fix-storage-permissions.sh

set -e

echo "=== 修复 Docker 存储目录权限 ==="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
  echo "❌ 错误: 请在项目根目录运行此脚本"
  exit 1
fi

# 存储目录路径
DATA_DIR="./data"
VIDEOS_DIR="./data/videos"

# 容器内 nextjs 用户的 UID/GID (在 Dockerfile 中定义为 1001)
NEXTJS_UID=1001
NEXTJS_GID=1001

echo "1. 检查目录..."
if [ ! -d "$DATA_DIR" ]; then
  echo "   创建目录: $DATA_DIR"
  mkdir -p "$DATA_DIR"
fi

if [ ! -d "$VIDEOS_DIR" ]; then
  echo "   创建目录: $VIDEOS_DIR"
  mkdir -p "$VIDEOS_DIR"
fi

echo ""
echo "2. 修复权限..."
echo "   目标 UID/GID: $NEXTJS_UID:$NEXTJS_GID"

# 修复所有者和权限
if sudo -n true 2>/dev/null; then
  echo "   使用 sudo 修复权限..."
  sudo chown -R $NEXTJS_UID:$NEXTJS_GID "$DATA_DIR"
  sudo chmod -R 755 "$DATA_DIR"
  sudo chmod -R 775 "$VIDEOS_DIR"  # videos 目录需要写权限
  echo "   ✓ 权限修复完成"
else
  echo "   ⚠️  需要 sudo 权限，请输入密码:"
  sudo chown -R $NEXTJS_UID:$NEXTJS_GID "$DATA_DIR"
  sudo chmod -R 755 "$DATA_DIR"
  sudo chmod -R 775 "$VIDEOS_DIR"
  echo "   ✓ 权限修复完成"
fi

echo ""
echo "3. 验证权限..."
if [ -w "$VIDEOS_DIR" ]; then
  echo "   ✓ $VIDEOS_DIR 可写"
else
  echo "   ✗ $VIDEOS_DIR 不可写"
  exit 1
fi

echo ""
echo "=== 修复完成 ==="
echo ""
echo "下一步:"
echo "  1. 重启容器: docker-compose restart"
echo "  2. 验证权限: docker exec -it moontv-container node scripts/check-docker-env.js"

