#!/bin/bash
cd /home/agent/projects/telegram-assistant
export CLAUDE_API_KEY="${CLAUDE_API_KEY:-}"
pkill -f "python3 bot.py" 2>/dev/null
sleep 1
nohup python3 bot.py >> bot.log 2>&1 &
echo "Бот запущен, PID: $!"
