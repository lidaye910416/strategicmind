#!/bin/bash
# Ralph loop helper - run one iteration
# Usage: ./ralph_step.sh

set -e

PRD_FILE="prd.json"
PROGRESS_FILE="progress.txt"

# 1. 找到下一个待实现的 US (highest priority)
NEXT_US=$(python3 << 'PYEOF'
import json

with open('prd.json') as f:
    prd = json.load(f)

pending = [u for u in prd['userStories'] if not u.get('passes')]
pending.sort(key=lambda x: (x.get('priority', 99), x['id']))

if pending:
    us = pending[0]
    print(f"{us['id']}|{us['title']}|{us.get('priority', '?')}")
PYEOF
)

if [ -z "$NEXT_US" ]; then
    echo "✅ All US completed!"
    echo "<promise>COMPLETE</promise>"
    exit 0
fi

US_ID=$(echo "$NEXT_US" | cut -d'|' -f1)
US_TITLE=$(echo "$NEXT_US" | cut -d'|' -f2)
US_PRIORITY=$(echo "$NEXT_US" | cut -d'|' -f3)

echo "═══════════════════════════════════════════════════════════"
echo "🎯 Next US: $US_ID (Priority $US_PRIORITY)"
echo "📋 Title: $US_TITLE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Run: claude \"implement $US_ID: $US_TITLE\""
