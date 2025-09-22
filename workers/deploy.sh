#!/bin/bash

# MoonTV Workers 部署脚本
# 自动化部署Cloudflare Workers API服务

set -e  # 遇到错误立即退出

echo "🚀 MoonTV Workers 部署脚本启动"
echo "=================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印彩色消息
print_message() {
    echo -e "${2}${1}${NC}"
}

# 检查依赖
check_dependencies() {
    print_message "🔍 检查依赖..." $BLUE
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        print_message "❌ Node.js 未安装，请先安装 Node.js" $RED
        exit 1
    fi
    
    # 检查npm
    if ! command -v npm &> /dev/null; then
        print_message "❌ npm 未安装，请先安装 npm" $RED
        exit 1
    fi
    
    # 检查wrangler
    if ! command -v wrangler &> /dev/null; then
        print_message "📦 安装 Wrangler CLI..." $YELLOW
        npm install -g wrangler
    fi
    
    print_message "✅ 依赖检查完成" $GREEN
}

# 检查Cloudflare认证
check_auth() {
    print_message "🔐 检查 Cloudflare 认证..." $BLUE
    
    if ! wrangler whoami &> /dev/null; then
        print_message "⚠️  未登录 Cloudflare，请先登录" $YELLOW
        wrangler login
    fi
    
    print_message "✅ Cloudflare 认证检查完成" $GREEN
}

# 创建云端资源
create_resources() {
    print_message "🏗️  创建云端资源..." $BLUE
    
    # 检查是否已存在数据库
    if ! wrangler d1 list | grep -q "moontv-database"; then
        print_message "📊 创建 D1 数据库..." $YELLOW
        wrangler d1 create moontv-database
        print_message "✅ D1 数据库创建完成，请手动更新 wrangler.toml 中的 database_id" $GREEN
    else
        print_message "✅ D1 数据库已存在" $GREEN
    fi
    
    # 创建KV命名空间
    print_message "🗄️  创建 KV 命名空间..." $YELLOW
    
    echo "创建 CACHE KV 命名空间："
    wrangler kv:namespace create "CACHE" || true
    
    echo "创建 TASK_STATUS KV 命名空间："
    wrangler kv:namespace create "TASK_STATUS" || true
    
    print_message "✅ KV 命名空间创建完成，请手动更新 wrangler.toml 中的 KV ID" $GREEN
}

# 初始化数据库
init_database() {
    print_message "🗃️  初始化数据库..." $BLUE
    
    # 检查是否存在schema.sql
    if [ ! -f "schema.sql" ]; then
        print_message "❌ schema.sql 文件不存在" $RED
        exit 1
    fi
    
    # 本地环境初始化
    print_message "📝 本地环境数据库初始化..." $YELLOW
    wrangler d1 execute moontv-database --file=./schema.sql || true
    
    # 询问是否初始化远程数据库
    read -p "是否初始化远程生产数据库？(y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_message "🌐 远程环境数据库初始化..." $YELLOW
        wrangler d1 execute moontv-database --file=./schema.sql --remote
        print_message "✅ 远程数据库初始化完成" $GREEN
    fi
    
    print_message "✅ 数据库初始化完成" $GREEN
}

# 验证配置
validate_config() {
    print_message "🔧 验证配置..." $BLUE
    
    # 检查wrangler.toml
    if [ ! -f "wrangler.toml" ]; then
        print_message "❌ wrangler.toml 文件不存在" $RED
        exit 1
    fi
    
    # 检查数据库ID是否已配置
    if grep -q "your-database-id-here" wrangler.toml; then
        print_message "⚠️  请更新 wrangler.toml 中的 database_id" $YELLOW
        print_message "💡 运行 'wrangler d1 list' 获取数据库ID" $BLUE
    fi
    
    # 检查KV ID是否已配置
    if grep -q "your-.*-kv-id-here" wrangler.toml; then
        print_message "⚠️  请更新 wrangler.toml 中的 KV 命名空间 ID" $YELLOW
        print_message "💡 运行 'wrangler kv:namespace list' 获取KV ID" $BLUE
    fi
    
    print_message "✅ 配置验证完成" $GREEN
}

# 部署服务
deploy_service() {
    print_message "🚀 部署服务..." $BLUE
    
    # 询问部署环境
    echo "请选择部署环境："
    echo "1) 开发环境 (development)"
    echo "2) 生产环境 (production)"
    read -p "请输入选择 (1-2): " -n 1 -r
    echo
    
    case $REPLY in
        1)
            print_message "🔧 部署到开发环境..." $YELLOW
            wrangler deploy
            ;;
        2)
            print_message "🌐 部署到生产环境..." $YELLOW
            wrangler deploy --env production
            ;;
        *)
            print_message "❌ 无效选择，默认部署到开发环境" $RED
            wrangler deploy
            ;;
    esac
    
    print_message "✅ 服务部署完成" $GREEN
}

# 测试部署
test_deployment() {
    print_message "🧪 测试部署..." $BLUE
    
    # 获取Workers URL
    WORKER_URL=$(wrangler whoami | grep -o 'https://.*\.workers\.dev' | head -1)
    
    if [ -n "$WORKER_URL" ]; then
        print_message "🌐 Workers URL: $WORKER_URL" $BLUE
        
        # 测试健康检查
        print_message "🔍 测试API连接..." $YELLOW
        if curl -s "$WORKER_URL/api/stats" > /dev/null; then
            print_message "✅ API连接测试成功" $GREEN
        else
            print_message "⚠️  API连接测试失败，请检查部署状态" $YELLOW
        fi
    else
        print_message "⚠️  无法获取 Workers URL，请手动验证部署" $YELLOW
    fi
}

# 显示部署后信息
show_post_deploy_info() {
    print_message "📋 部署完成信息" $BLUE
    echo "=================================="
    
    print_message "🎉 MoonTV Workers API 部署成功！" $GREEN
    echo
    print_message "📚 接下来的步骤：" $BLUE
    echo "1. 更新 MoonTV 项目的环境变量："
    echo "   NEXT_PUBLIC_STORAGE_TYPE=d1"
    echo "   WORKERS_API_URL=https://your-workers-domain.workers.dev"
    echo
    echo "2. 在 MoonTV 项目中配置 API 端点"
    echo
    echo "3. 测试用户登录和数据同步功能"
    echo
    print_message "📖 详细文档：" $BLUE
    echo "   - 查看 README.md 获取完整使用指南"
    echo "   - 查看 API 接口文档了解所有端点"
    echo
    print_message "🔧 管理命令：" $BLUE
    echo "   - 查看日志: wrangler tail"
    echo "   - 数据库查询: wrangler d1 execute moontv-database --command=\"SQL\""
    echo "   - 重新部署: wrangler deploy"
    echo
    print_message "🚀 部署脚本执行完成！" $GREEN
}

# 主函数
main() {
    print_message "🎬 MoonTV Workers 自动部署" $BLUE
    echo
    
    # 检查是否在正确的目录
    if [ ! -f "package.json" ] || ! grep -q "moontv-workers" package.json; then
        print_message "❌ 请在 MoonTV/workers 目录下运行此脚本" $RED
        exit 1
    fi
    
    # 执行部署步骤
    check_dependencies
    check_auth
    
    # 询问是否创建新资源
    read -p "是否需要创建新的云端资源 (数据库/KV)？(y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        create_resources
        print_message "⚠️  请先更新 wrangler.toml 中的资源ID，然后重新运行脚本" $YELLOW
        exit 0
    fi
    
    validate_config
    
    # 询问是否初始化数据库
    read -p "是否需要初始化数据库？(y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        init_database
    fi
    
    deploy_service
    test_deployment
    show_post_deploy_info
}

# 执行主函数
main "$@"
