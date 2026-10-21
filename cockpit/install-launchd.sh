#!/bin/bash
# Автозапуск dev-cockpit через launchd: стартует при входе в систему и перезапускается при падении.
#   bash cockpit/install-launchd.sh            — установить/обновить и запустить
#   bash cockpit/install-launchd.sh uninstall  — остановить и удалить
set -euo pipefail

LABEL="local.dev-cockpit"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/dev-cockpit.log"
DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

if [[ "${1:-}" == "uninstall" ]]; then
  rm -f "$PLIST"
  echo "dev-cockpit: автозапуск удалён"
  exit 0
fi

NODE="$(command -v node)"
CLAUDE_DIR="$(dirname "$(command -v claude)")"
GIT_DIR="$(dirname "$(command -v git)")"
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$CLAUDE_DIR:$GIT_DIR:$(dirname "$NODE"):/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
echo "dev-cockpit: автозапуск установлен ($PLIST), лог — $LOG"
