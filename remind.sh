#!/bin/bash
BOT_TOKEN="8872835678:AAGDEE3BjFu4DfXj9_pWZs6JjoTVTdOA3aI"
CHAT_ID="$1"
MESSAGE="$2"
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}&text=${MESSAGE}&parse_mode=HTML"
