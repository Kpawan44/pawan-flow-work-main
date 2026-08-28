#!/bin/bash
# ==========================================================
# PMW Manufacturing Tracker - AWS EC2 Automated Setup Script
# ==========================================================

set -e

echo "🚀 [1/4] Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

echo "🐳 [2/4] Installing Docker and Docker Compose..."
sudo apt-get install -y docker.io docker-compose git curl ufw

sudo systemctl enable --now docker
sudo usermod -aG docker $USER

echo "🔒 [3/4] Configuring Firewall..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow 3000/tcp || true

echo "📦 [4/4] Building and launching PMW Tracker container..."
sudo docker compose down || true
sudo docker compose up -d --build

echo "=========================================================="
echo "✅ PMW Tracker is now LIVE on AWS EC2!"
echo "🌐 Access your app at: http://$(curl -s ifconfig.me):3000"
echo "=========================================================="
