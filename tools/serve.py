#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Localhost-only server shared by the source launcher and Mac download."""
import argparse
import errno
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def serve(root, route='/', port=8765, browser=True):
    root = Path(root).resolve()
    if not root.is_dir():
        raise SystemExit('The browser app folder is missing.')
    server = None
    for candidate in range(port, min(port+10, 65536)):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', candidate), partial(Handler, directory=str(root)))
            break
        except OSError as error:
            if error.errno == errno.EADDRINUSE:
                continue
            if isinstance(error, PermissionError):
                raise SystemExit('Run the launcher in your normal Terminal: this process cannot open a localhost server.') from error
            raise
    if server is None:
        raise SystemExit('Local ports are busy. Try --port with another port number.')
    url = f'http://127.0.0.1:{server.server_port}{route}'
    print('FM1 SMSGGDJ: '+url+'\nKeep this Terminal window open. Press Control-C to stop.', flush=True)
    if browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    ap.add_argument('--port', type=int, metavar='PORT', default=8765)
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()
    if not 1024 <= args.port <= 65535:
        ap.error('--port must be between 1024 and 65535')
    serve(args.root, port=args.port, browser=not args.no_browser)

if __name__ == '__main__':
    main()
