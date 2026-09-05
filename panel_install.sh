#!/bin/bash
set -e

# ============================================================
#  面板一键安装脚本 (全自动, 无需任何输入)
#
#  用法:  curl -L https://github.com/charmingyi/dlux/raw/main/panel_install.sh -o panel_install.sh
#        chmod +x panel_install.sh && ./panel_install.sh
#
#  全自动完成: 拉取源码 -> 生成随机数据库配置 -> docker 本地构建并启动
#  可选环境变量: PANEL_FRONTEND_PORT (默认6366) / PANEL_BACKEND_PORT (默认6365)
# ============================================================

# 仓库与版本 (若自行 fork 请改为自己的仓库)
REPO_URL="https://github.com/charmingyi/dlux"
RELEASE_VERSION="1.3.0"

# 默认端口 (可用环境变量覆盖)
FRONTEND_PORT="${PANEL_FRONTEND_PORT:-6366}"
BACKEND_PORT="${PANEL_BACKEND_PORT:-6365}"

WORK_DIR=$(pwd)
SOURCE_DIR="${WORK_DIR}/relay-panel-src"

check_docker() {
  if command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
  elif command -v docker &> /dev/null; then
    if docker compose version &> /dev/null; then
      DOCKER_CMD="docker compose"
    else
      echo "错误: 检测到 docker, 但不支持 'docker compose' 命令。请更新 docker 或安装 docker-compose。"
      exit 1
    fi
  else
    echo "错误: 未检测到 docker。请先安装 Docker: https://docs.docker.com/engine/install/"
    exit 1
  fi
  echo "检测到 Docker: $DOCKER_CMD"
}

generate_random() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c16
}

echo "==============================================="
echo "  面板一键安装"
echo "==============================================="

check_docker

# 拉取源码 (优先 release 压缩包, 失败回退 main 分支)
echo "拉取源码..."
TARBALL_URL="${REPO_URL}/archive/refs/tags/${RELEASE_VERSION}.tar.gz"
TMP_TARBALL=$(mktemp /tmp/relay-panel.XXXXXX.tar.gz)
if ! curl -fL --connect-timeout 10 "$TARBALL_URL" -o "$TMP_TARBALL"; then
  echo "release 拉取失败, 使用 main 分支源码..."
  TARBALL_URL="${REPO_URL}/archive/refs/heads/main.tar.gz"
  curl -fL "$TARBALL_URL" -o "$TMP_TARBALL"
fi

rm -rf "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"
tar -xzf "$TMP_TARBALL" -C "$SOURCE_DIR" --strip-components=1
rm -f "$TMP_TARBALL"

if [[ ! -f "$SOURCE_DIR/docker-compose.yml" || ! -f "$SOURCE_DIR/panel.sql" ]]; then
  echo "错误: 源码不完整, 缺少 docker-compose.yml 或 panel.sql"
  exit 1
fi

# 生成随机数据库配置 (无需用户输入)
DB_NAME=$(generate_random)
DB_USER=$(generate_random)
DB_PASSWORD=$(generate_random)
JWT_SECRET=$(generate_random)

# 写环境配置
cat > "$SOURCE_DIR/.env" <<EOF
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
FRONTEND_PORT=$FRONTEND_PORT
BACKEND_PORT=$BACKEND_PORT
EOF

echo "开始构建并启动 (首次构建需几分钟)..."
cd "$SOURCE_DIR"
$DOCKER_CMD up -d --build

# 等待后端就绪
echo "等待服务启动..."
for i in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/config/get" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 120 ]; then
    echo "警告: 后端就绪检测超时, 请检查: $DOCKER_CMD logs panel-backend"
  fi
  sleep 2
done

cd "$WORK_DIR"

echo ""
echo "==============================================="
echo "  部署完成"
echo "==============================================="
echo "面板地址: http://服务器IP:${FRONTEND_PORT}"
echo "默认账号: admin_user"
echo "默认密码: admin_user"
echo "登录后请立即修改默认密码!"
echo "安装目录: $SOURCE_DIR"
echo "==============================================="
