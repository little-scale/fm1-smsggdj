#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source tools/env.sh
GGDJ_PACKAGE="$(python3 - <<'PY'
import hashlib
import json
from pathlib import Path
status = json.loads(Path('build/device-status.json').read_text())
package = Path(status.get('package', 'build/ggdj-fm1.fwsc')).resolve()
if not status.get('success') or hashlib.sha256(package.read_bytes()).hexdigest() != status.get('sha256'):
    raise SystemExit('Package does not match a successful build. Run Build-GGDJ.command first.')
print(package)
PY
)"
python3 "$FM1_BASE/tools/fm1_install.py" "$GGDJ_PACKAGE" 2>&1 | tee build/device-install.log
python3 "$FM1_BASE/tools/fm1_install.py" --info 2>&1 | tee build/device-identity.txt
