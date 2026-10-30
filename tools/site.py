#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Package the browser tools for static hosting and a small Mac download.

No emulator, Game Gear ROM, or FM1 firmware binary is included.
Only Python's standard library is needed; platform submodules are not read.
"""
import argparse
import json
from pathlib import Path
import shutil
import zipfile

APP=Path(__file__).resolve().parents[1]


def build_site(app=APP):
    app=Path(app).resolve()
    source=app/'web/manager'
    out=app/'build/site'
    if out.is_symlink():
        raise SystemExit('Refusing to replace a linked site output directory.')
    if out.exists():
        shutil.rmtree(out)
    out.parent.mkdir(parents=True,exist_ok=True)
    shutil.copytree(source,out,ignore=shutil.ignore_patterns('.DS_Store','__pycache__'))
    # This first distribution ships the tools only. Firmware publication is
    # a later explicit release step after the project's outstanding work.
    release=json.loads((out/'release.json').read_text())
    if release.get('available'):
        raise SystemExit('The tools-only site cannot publish firmware downloads. Use a reviewed firmware release process.')
    shutil.copyfile(app/'LICENSE',out/'LICENSE')
    shutil.copyfile(app/'tools/serve.py',out/'serve.py')
    (out/'.nojekyll').write_text('')
    (out/'BROWSER-LICENSES.txt').write_text(
        'Original FM1 SMSGGDJ browser UI and manager: MIT, Seb Tomczak (little-scale). See LICENSE.\n'
        'Song codecs: MIT, Seb Tomczak. See vendor/LICENSE.\n'
        'fm1ota.mjs and fm1pkg.mjs: MPL-2.0, Charles Vestal, Leo Kuroshita and Hügelton Instruments.\n'
        'See vendor/MPL-2.0.txt, the source module headers and vendor/provenance.json.\n'
        'The Game Gear emulator, ROM and FM1 firmware are not included in this browser package.\n')
    launcher=out/'Open-Manager.command'
    launcher.write_text('#!/bin/bash\nset -euo pipefail\ncd "$(dirname "$0")"\npython3 serve.py\n')
    launcher.chmod(0o755)
    (out/'START_HERE.txt').write_text(
        'FM1 SMSGGDJ browser tools\n\n'
        'Mac: double-click Open-Manager.command, or run it from Terminal.\n'
        'Requires Python 3 only; no additional Python packages, compiler, Docker, Node.js or Emscripten.\n'
        'If Python 3 is not installed, use the hosted browser tools or install Python 3.\n'
        'Use Chrome or Edge for USB MIDI and allow SysEx permission.\n'
        'Keep the Terminal window open while using the local page.\n\n'
        'No FM1 firmware, Game Gear ROM or emulator binary is included.\n'
        'To install firmware, select a local .fwsc file in the page.\n'
        'Source and full instructions: https://github.com/little-scale/fm1-smsggdj\n')
    # Preserve older /manager/ bookmarks without maintaining two app copies.
    (out/'manager').mkdir()
    (out/'manager/index.html').write_text('<!doctype html><meta charset="utf-8"><title>FM1 SMSGGDJ</title><script>location.replace("../"+location.search+location.hash)</script><a href="../">Open FM1 SMSGGDJ</a>')
    forbidden=[p for p in out.rglob('*') if p.suffix.lower() in ('.gg','.sms','.fwsc','.wasm')]
    if forbidden:
        raise SystemExit('Unexpected binary in the tools-only site: '+str(forbidden[0]))
    archive=app/'build/FM1-SMSGGDJ-Manager.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for path in sorted(out.rglob('*')):
            if path.is_file():
                z.write(path,Path('FM1-SMSGGDJ-Manager')/path.relative_to(out))
    # The hosted page offers the Mac download. The download's own page does
    # not point to a nonexistent nested copy of itself.
    shutil.copyfile(archive,out/archive.name)
    index=out/'index.html'
    index.write_text(index.read_text().replace('<!--MAC_DOWNLOAD-->',
        '<a href="FM1-SMSGGDJ-Manager.zip" download>Download a Mac copy</a> · '))
    return out,archive


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    out,archive=build_site()
    print('Static browser tools: '+str(out))
    print('Mac download: '+str(archive))

if __name__=='__main__':
    main()
