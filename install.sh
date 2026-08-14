#!/bin/bash
# ============================================================
#  节点代理一键安装脚本 (全自动, 无需任何额外配置)
#
#  用法:
#    ./install.sh -a <面板地址:端口> -s <节点密钥>
#
#  面板上"节点管理 -> 安装"会直接给出完整命令, 复制执行即可
#  依赖(wireguard-tools/iproute2)自动安装, 组网全部由面板 Web 下发
# ============================================================

# 仓库与版本 (若自行 fork 请改为自己的仓库)
REPO_URL="https://github.com/charmingyi/dlux"
RELEASE_VERSION="2.0.0"

INSTALL_DIR="/opt/relay"
BIN_NAME="relay"
SERVICE_NAME="relay"

# 解析命令行参数
SERVER_ADDR=""
SECRET=""
while getopts "a:s:h" opt; do
  case $opt in
    a) SERVER_ADDR="$OPTARG" ;;
    s) SECRET="$OPTARG" ;;
    h)
      echo "用法: $0 -a <面板地址:端口> -s <节点密钥>"
      exit 0
      ;;
    *) echo "用法: $0 -a <面板地址:端口> -s <节点密钥>"; exit 1 ;;
  esac
done

if [[ -z "$SERVER_ADDR" || -z "$SECRET" ]]; then
  echo "错误: 缺少参数"
  echo "用法: $0 -a <面板地址:端口> -s <节点密钥>"
  echo "提示: 在面板 节点管理 -> 新增节点 中获取完整安装命令"
  exit 1
fi

# 获取系统架构
get_architecture() {
  case $(uname -m) in
    x86_64)  echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)       echo "amd64" ;;
  esac
}

ARCH=$(get_architecture)
DOWNLOAD_URL="${REPO_URL}/releases/download/${RELEASE_VERSION}/relay-${ARCH}"

# 国内加速 (可选)
if curl -s --max-time 3 https://ipinfo.io/country 2>/dev/null | grep -q "CN"; then
  DOWNLOAD_URL="https://ghfast.top/${DOWNLOAD_URL}"
fi

# 自动安装依赖 (wireguard-tools / iproute2)
check_dependencies() {
  if command -v wg &> /dev/null && command -v ip &> /dev/null; then
    return 0
  fi

  SUDO_CMD=""
  if [[ $EUID -ne 0 ]]; then
    SUDO_CMD="sudo"
  fi

  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
  fi

  echo "安装依赖 (wireguard-tools / iproute2)..."
  case $DISTRO in
    ubuntu|debian)
      $SUDO_CMD apt update -qq
      $SUDO_CMD apt install -y wireguard-tools iproute2
      ;;
    centos|rhel|rocky|almalinux|fedora)
      $SUDO_CMD dnf install -y wireguard-tools iproute
      ;;
    alpine)
      $SUDO_CMD apk add --no-cache wireguard-tools iproute2
      ;;
    arch|manjaro)
      $SUDO_CMD pacman -S --noconfirm wireguard-tools iproute2
      ;;
    opensuse*|sles)
      $SUDO_CMD zypper install -y wireguard-tools iproute2
      ;;
  esac
}

# 下载二进制 (先取 release 资产, 失败则回退源码编译)
download_binary() {
  echo "下载节点程序 (${ARCH})..."
  if curl -fL --connect-timeout 10 "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BIN_NAME}.tmp"; then
    mv "${INSTALL_DIR}/${BIN_NAME}.tmp" "${INSTALL_DIR}/${BIN_NAME}"
    return 0
  fi

  echo "release 下载失败, 尝试源码编译..."
  rm -f "${INSTALL_DIR}/${BIN_NAME}.tmp"
  if ! command -v go &> /dev/null; then
    echo "错误: 无 release 资产且服务器未安装 Go, 无法编译。请确认版本 ${RELEASE_VERSION} 已发布。"
    return 1
  fi
  SUDO_CMD=""
  if [[ $EUID -ne 0 ]]; then SUDO_CMD="sudo"; fi
  TMP_DIR=$(mktemp -d)
  curl -fL "${REPO_URL}/archive/refs/tags/${RELEASE_VERSION}.tar.gz" -o "${TMP_DIR}/src.tar.gz"
  tar -xzf "${TMP_DIR}/src.tar.gz" -C "${TMP_DIR}"
  (cd "${TMP_DIR}"/go-gost* && CGO_ENABLED=0 GOOS=linux GOARCH=${ARCH} go build -trimpath -ldflags="-s -w -buildid=" -o "${INSTALL_DIR}/${BIN_NAME}")
  rm -rf "${TMP_DIR}"
}

echo "==============================================="
echo "  节点代理一键安装"
echo "==============================================="
echo "面板地址: ${SERVER_ADDR}"
echo "安装目录: ${INSTALL_DIR}"

check_dependencies

mkdir -p "$INSTALL_DIR"

# 停止旧服务
if systemctl list-units --full -all | grep -Fq "${SERVICE_NAME}.service"; then
  systemctl stop $SERVICE_NAME 2>/dev/null
  systemctl disable $SERVICE_NAME 2>/dev/null
fi

download_binary
chmod +x "$INSTALL_DIR/$BIN_NAME"

# 写入配置 (http/tls/socks 由面板 Web 管理, 节点端自动同步)
cat > "$INSTALL_DIR/agent.json" <<EOF
{
  "addr": "$SERVER_ADDR",
  "secret": "$SECRET",
  "http": 0,
  "tls": 0,
  "socks": 0
}
EOF

# systemd 托管
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Relay Node Agent
After=network.target

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/$BIN_NAME
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl start $SERVICE_NAME

if systemctl is-active --quiet $SERVICE_NAME; then
  echo ""
  echo "安装完成! 节点已连接面板, 请回到面板查看状态。"
  echo "服务状态: $(systemctl is-active $SERVICE_NAME)"
else
  echo ""
  echo "服务启动失败, 查看日志: journalctl -u $SERVICE_NAME -f"
  exit 1
fi
