#!/usr/bin/env python3
"""Serve the source cartridge manager or built emulator; no hardware writes."""
import argparse
from pathlib import Path
from serve import serve
APP=Path(__file__).resolve().parents[1]

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--port',type=int,default=8765)
    ap.add_argument('--no-browser',action='store_true')
    ap.add_argument('--manager',action='store_true')
    a=ap.parse_args()
    if not 1024 <= a.port <= 65535:
        ap.error('--port must be between 1024 and 65535')
    if a.manager:
        root,route=APP/'web','/manager/'
    else:
        root,route=APP/'build/emu','/'
        if not (root/'app.wasm').is_file():
            raise SystemExit('First run tools/build.py --web, or use --manager for the cartridge tools without a build.')
    serve(root,route,a.port,not a.no_browser)

if __name__=='__main__':main()
