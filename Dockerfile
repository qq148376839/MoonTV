# ---- 第 1 阶段：安装依赖 ----
FROM node:20-alpine AS deps

# 设置国内镜像源并激活 pnpm
RUN corepack enable && \
  corepack prepare pnpm@10.12.4 --activate && \
  npm config set registry https://registry.npmmirror.com/ && \
  pnpm config set registry https://registry.npmmirror.com/ && \
  pnpm config set network-timeout 300000

WORKDIR /app

# 仅复制依赖清单，提高构建缓存利用率
COPY package.json pnpm-lock.yaml ./

# 安装所有依赖（含 devDependencies，后续会裁剪），增加重试机制
RUN pnpm install --frozen-lockfile || \
  (echo "第一次安装失败，重试..." && pnpm install --frozen-lockfile)

# ---- 第 2 阶段：构建项目 ----
FROM node:20-alpine AS builder

# 构建参数：是否跳过类型检查（默认跳过以避免内存溢出）
ARG SKIP_TYPE_CHECK=true
ARG BUILD_MEMORY_LIMIT=4096

# 设置国内镜像源并激活 pnpm
RUN corepack enable && \
  corepack prepare pnpm@10.12.4 --activate && \
  npm config set registry https://registry.npmmirror.com/ && \
  pnpm config set registry https://registry.npmmirror.com/

WORKDIR /app

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
# 复制全部源代码
COPY . .

# 在构建阶段也显式设置 DOCKER_ENV，
# 确保 Next.js 在编译时即选择 Node Runtime 而不是 Edge Runtime
RUN find ./src -type f -name "route.ts" -print0 \
  | xargs -0 sed -i "s/export const runtime = 'edge';/export const runtime = 'nodejs';/g"
ENV DOCKER_ENV=true

# For Docker builds, force dynamic rendering to read runtime environment variables.
RUN sed -i "/const inter = Inter({ subsets: \['latin'] });/a export const dynamic = 'force-dynamic';" src/app/layout.tsx

# 生成生产构建
# 默认使用 build:skip-typecheck 避免内存溢出问题
# 类型检查应该在 CI/CD 中单独运行，而不是在 Docker 构建时
# 如果需要完整构建（包含类型检查），构建时传入: --build-arg SKIP_TYPE_CHECK=false --build-arg BUILD_MEMORY_LIMIT=6144
RUN if [ "$SKIP_TYPE_CHECK" = "true" ]; then \
  echo "使用跳过类型检查的构建（推荐，避免内存溢出）"; \
  NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_LIMIT}" pnpm run build:skip-typecheck; \
  else \
  echo "使用完整构建（包含类型检查，需要更多内存）"; \
  NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_LIMIT}" pnpm run build; \
  fi

# ---- 第 3 阶段：生成运行时镜像 ----
FROM node:20-alpine AS runner

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DOCKER_ENV=true

# 从构建器中复制 standalone 输出
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 从构建器中复制 scripts 目录
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# 从构建器中复制 start.js
COPY --from=builder --chown=nextjs:nodejs /app/start.js ./start.js
# 从构建器中复制 public 和 .next/static 目录
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# COPY --from=builder --chown=nextjs:nodejs /app/config.json ./config.json

# 切换到非特权用户
USER nextjs

EXPOSE 3000

# 使用自定义启动脚本，先预加载配置再启动服务器
CMD ["node", "start.js"] 