#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Render the site in headless Chrome on a CI runner; no MIDI writes."""
import argparse
import json
from functools import partial
from http.server import ThreadingHTTPServer
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from serve import Handler

APP=Path(__file__).resolve().parents[1]
class Elements(HTMLParser):
    def __init__(self):super().__init__();self.ids={};self.stack=[]
    def handle_starttag(self,tag,attrs):
        ident=dict(attrs).get('id');self.stack.append((tag,ident))
        if ident:self.ids[ident]=''
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:self.stack=self.stack[:i];break
    def handle_data(self,data):
        for _,ident in self.stack:
            if ident:self.ids[ident]+=data

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--require',action='store_true');args=ap.parse_args()
    chrome=next((p for name in ('google-chrome','google-chrome-stable','chromium','chromium-browser') if (p:=shutil.which(name))),None)
    if not chrome:
        if args.require:raise SystemExit('Headless Chrome is required for this CI check.')
        print('SKIP browser render: Chrome is not available on PATH.');return
    root=APP/'build/site';out=APP/'build/browser-review';out.mkdir(parents=True,exist_ok=True)
    if not (root/'index.html').is_file():raise SystemExit('Run tools/site.py first.')
    with ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root))) as server:
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            for name,size in [('desktop','1440,1800'),('mobile','390,1800')]:
                with tempfile.TemporaryDirectory(prefix='ggdj-chrome-') as profile:
                    result=subprocess.run([chrome,'--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--disable-background-networking','--user-data-dir='+profile,'--window-size='+size,'--virtual-time-budget=2000','--dump-dom','--screenshot='+str(out/(name+'.png')),f'http://127.0.0.1:{server.server_port}/'],capture_output=True,text=True,timeout=40)
                (out/(name+'.html')).write_text(result.stdout);(out/(name+'.log')).write_text(result.stderr)
                if result.returncode:raise SystemExit('Chrome failed: '+result.stderr[-2000:])
                dom=Elements();dom.feed(result.stdout)
                if '0/32 songs' not in dom.ids.get('document-status',''):raise SystemExit('Browser app did not initialise its song controls.')
                release=json.loads((root/'release.json').read_text())
                expected='Published firmware: '+release['version'] if release['available'] else 'not published'
                if expected not in dom.ids.get('release-status',''):raise SystemExit('Browser release metadata did not load.')
                if 'No device connected' not in dom.ids.get('device-info',''):raise SystemExit('Unexpected initial connection state.')
                if not (out/(name+'.png')).is_file():raise SystemExit('Browser screenshot was not produced.')
                print('PASS real Chrome app initialisation and screenshot: '+name)
        finally:server.shutdown();thread.join(timeout=5)

if __name__=='__main__':main()
