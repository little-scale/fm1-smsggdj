#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source tools/env.sh
mkdir -p build
python3 tools/build.py --device 2>&1 | tee build/device-build.log
