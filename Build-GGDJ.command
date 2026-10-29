#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source tools/env.sh
python3 tools/build.py --device
