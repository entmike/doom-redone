#!/bin/bash
# Launch headless probe Chrome on a given URL (arg 1), wait for CDP page target.
URL="${1:-http://127.0.0.1:8791/index.html}"
PORT=9333
CHROME=/home/mike/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome
nohup "$CHROME" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --remote-debugging-port=$PORT --user-data-dir=/tmp/probe-profile --noerrdialogs \
  --no-first-run --window-size=1400,900 "$URL" >/dev/null 2>&1 &
for i in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$PORT/json" | grep -q '8791'; then echo "ready after ${i}s"; exit 0; fi
  sleep 1
done
echo "TIMEOUT waiting for CDP"; exit 1
