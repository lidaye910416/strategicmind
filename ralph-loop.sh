#!/bin/bash
# Ralph Loop - StrategicMind implementation runner
# Usage: ./ralph-loop.sh [max_iterations]

set -e

MAX_ITERATIONS=${1:-10}

echo "🚀 Starting Ralph Loop for StrategicMind"
echo "   Max iterations: $MAX_ITERATIONS"
echo "   Branch: $(git branch --show-current)"
echo "   Working dir: $(pwd)"
echo ""

# 显示 PRD 状态
python3 << 'PYEOF'
import json
with open('prd.json') as f:
    prd = json.load(f)
total = len(prd['userStories'])
completed = sum(1 for u in prd['userStories'] if u.get('passes'))
print(f"📊 Progress: {completed}/{total} US completed ({completed/total*100:.1f}%)")
PYEOF

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Ralph Iteration 1 of $MAX_ITERATIONS"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "To run: claude --dangerously-skip-permissions < .claude/ralph-prompt.md"
echo "Or copy content from prompt.md to your conversation"
echo ""
echo "PRD location: $(pwd)/prd.json"
echo "Progress: $(pwd)/progress.txt"
echo ""
