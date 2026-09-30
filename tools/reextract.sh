#!/bin/bash
# Re-extract all generated assets from retail wads/doom1.wad
set -e
cd "$(dirname "$0")/.."
WAD=wads/doom1.wad

echo "== statusbar =="
python3 tools/extract_statusbar.py "$WAD"

echo "== vanilla trig tables (from reference/tables.c, not the WAD) =="
python3 tools/extract_tables.py

echo "== intermission/finale =="
python3 tools/extract_intermission.py "$WAD"
python3 tools/extract_title.py "$WAD"

echo "== main assets =="
python3 tools/gen_assets.py assets/assets.js --wad "$WAD" \
  $(ls assets/e1m*.json | tr '\n' ' ')

echo "== map jsons =="
for m in E1M1 E1M2 E1M3 E1M4 E1M5 E1M6 E1M7 E1M8 E1M9; do
  out="assets/$(echo $m | tr 'A-Z' 'a-z').json"
  python3 tools/wad2map.py "$WAD" "$m" "$out"
done

echo "== frame-coverage audit =="
python3 tools/audit-anim-frames.py
echo DONE
