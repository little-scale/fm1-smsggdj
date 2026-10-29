# SPDX-License-Identifier: MIT
"""Locate the pinned platform or an explicitly configured development checkout."""
import os
from pathlib import Path
APP = Path(__file__).resolve().parents[1]
BASE = Path(os.environ.get("FM1_BASE", str(APP / "platform/fm1-base"))).resolve()
WORKSPACE = Path(os.environ.get("FM1_WORKSPACE", str(APP.parent))).resolve()
def require_platform():
    if not (BASE / "tools/build.py").is_file():
        raise SystemExit("Missing fm1-base. Run: git submodule update --init --recursive")
