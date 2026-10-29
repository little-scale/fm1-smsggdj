#!/usr/bin/env python3
"""Serve the built browser preview locally. Does not connect to hardware."""
import argparse
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser
APP=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--port',type=int,default=8765)
ap.add_argument('--no-browser',action='store_true')
ap.add_argument('--manager',action='store_true')
a=ap.parse_args()
if not (APP/'build/emu/app.wasm').exists():raise SystemExit('First run tools/build.py --web')
url=f'http://127.0.0.1:{a.port}/'+('manager/' if a.manager else '')
try:
    server=ThreadingHTTPServer(('127.0.0.1',a.port),partial(SimpleHTTPRequestHandler,directory=str(APP/'build/emu')))
except PermissionError:
    raise SystemExit('This process cannot listen on a local socket. Run Preview-GGDJ.command from Finder or your own Terminal.')
print('GGDJ preview: '+url,flush=True)
if not a.no_browser:webbrowser.open(url)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
