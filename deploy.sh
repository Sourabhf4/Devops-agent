#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  deploy.sh — DevOps Agent EC2 bootstrap
#
#  Run this ONCE on a fresh EC2 Ubuntu instance:
#    chmod +x deploy.sh
#    ./deploy.sh
#
#  After first run, to redeploy after a code change:
#    git pull && docker compose up -d --build
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="https://github.com/Sourabhf4/Devops-agent.git"
APP_DIR="$HOME/devops-agent"

echo "──────────────────────────────────────────"
echo " DevOps Agent — EC2 Deploy"
echo "──────────────────────────────────────────"

# 1. Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo "[1/4] Installing Docker..."
  sudo apt-get update -qq
  sudo apt-get install -y docker.io docker-compose-plugin
  sudo usermod -aG docker "$USER"
  echo "      Docker installed. You may need to log out and back in."
else
  echo "[1/4] Docker already installed — skipping."
fi

# 2. Clone or update repo
if [ -d "$APP_DIR/.git" ]; then
  echo "[2/4] Repo exists — pulling latest..."
  git -C "$APP_DIR" pull
else
  echo "[2/4] Cloning repo..."
  git clone "$REPO" "$APP_DIR"
fi

cd "$APP_DIR"

# 3. Create .env if missing
if [ ! -f .env ]; then
  echo "[3/4] Creating .env from .env.example..."
  cp .env.example .env
  echo "      .env created — defaults are fine for basic deployment."
else
  echo "[3/4] .env already exists — skipping."
fi

# 4. Build and start
echo "[4/4] Building and starting containers..."
docker compose up -d --build

echo ""
echo "✅ Done! Your app is running at:"
echo "   http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo '<EC2-PUBLIC-IP>')"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f          # live logs"
echo "  docker compose ps               # container status"
echo "  docker compose down             # stop"
echo "  git pull && docker compose up -d --build   # redeploy"
