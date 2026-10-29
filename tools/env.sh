# SPDX-License-Identifier: MIT
# Optional integration with the existing FM1 development workspace.
GGDJ_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GGDJ_WORKSPACE="${FM1_WORKSPACE:-$(dirname "$GGDJ_APP_DIR")}"
if [[ -f "$GGDJ_WORKSPACE/setup/env.sh" ]]; then
    source "$GGDJ_WORKSPACE/setup/env.sh"
fi
export FM1_BASE="${FM1_BASE:-$GGDJ_APP_DIR/platform/fm1-base}"
