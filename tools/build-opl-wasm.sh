#!/usr/bin/env bash
# Build opl2.wasm from DOSBox DBOPL (GPL) + a tiny C wrapper.
# Produces src/opl2.wasm (loaded by src/opl.js).
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
SDK=wasi-sdk
CXX="$SDK/bin/clang++"
OUT=../src/opl2.wasm

# 1. strip dbopl.cpp down to the DBOPL namespace body (lines 46..1507:
#    tables + Operator/Channel/Chip/InitTables). Everything after 1507 is
#    dosbox Handler/save-state cruft we don't need.
sed -n "49,1507p" oplsrc/dbopl.cpp > /tmp/dbopl_core.cpp
{
  echo '#include <math.h>'
  echo '#include <stdlib.h>'
  echo '#include <string.h>'
  echo '#include "dosbox.h"'
  echo '#include "dbopl.h"'
  echo '#ifndef PI'
  echo '#define PI 3.14159265358979323846'
  echo '#endif'
  cat /tmp/dbopl_core.cpp
  echo '}   // close namespace DBOPL'
} > /tmp/dbopl_core_full.cpp

# 2. compile + link (no exceptions/rtti; static; export all wrapper C funcs)
"$CXX" -O2 -DNDEBUG -fno-exceptions -fno-rtti -Ioplsrc/shim -Ioplsrc \
  -Wl,--initial-memory=16777216 \
  -Wl,--export-memory -Wl,--allow-undefined \
  -Wl,--export=opl_create -Wl,--export=opl_write_addr \
  -Wl,--export=opl_write_reg -Wl,--export=opl_generate \
  -Wl,--export=opl_chip_size -Wl,--export=opl_chip_ptr -Wl,--export=opl_dbg -Wl,--export=opl_dbg2 -Wl,--export=malloc -Wl,--export=free \
  -o /tmp/opl2.wasm /tmp/dbopl_core_full.cpp oplsrc/opl_wrap.cpp
cp /tmp/opl2.wasm "$OUT"
ls -la "$OUT"
