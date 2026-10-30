#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Test dependency-free launch/site packaging without opening a socket."""
import errno
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import Mock,patch
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import site as python_site
# Avoid Python's built-in site module name.
import importlib.util
spec=importlib.util.spec_from_file_location('ggdj_site',Path(__file__).with_name('site.py'))
site=importlib.util.module_from_spec(spec);spec.loader.exec_module(site)
import preview
import serve
APP=Path(__file__).resolve().parents[1]

class BrowserSite(unittest.TestCase):
    def test_fresh_tools_only_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            shutil.copytree(APP/'web/manager',root/'web/manager')
            (root/'tools').mkdir();shutil.copyfile(APP/'tools/serve.py',root/'tools/serve.py')
            shutil.copyfile(APP/'LICENSE',root/'LICENSE')
            out,archive=site.build_site(root)
            self.assertFalse((root/'platform').exists())
            self.assertTrue((out/'index.html').is_file())
            self.assertTrue((out/'vendor/MPL-2.0.txt').is_file())
            self.assertFalse(json.loads((out/'release.json').read_text())['available'])
            self.assertLess(archive.stat().st_size,1024*1024)
            with zipfile.ZipFile(archive) as z:
                names=z.namelist()
                self.assertFalse(any(name.endswith(('.gg','.sms','.fwsc','.wasm')) for name in names))
                self.assertIn('FM1-SMSGGDJ-Manager/serve.py',names)
                entry=z.getinfo('FM1-SMSGGDJ-Manager/Open-Manager.command')
                self.assertTrue((entry.external_attr>>16)&0o111)
                launcher=z.read(entry).decode()
                self.assertNotIn('build.py',launcher)
                self.assertNotIn('env.sh',launcher)
            site.build_site(root) # repeatable, no stale output
    def test_manager_needs_no_build(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'web/manager').mkdir(parents=True)
            with patch.object(preview,'APP',root),patch.object(preview,'serve') as run,patch.object(sys,'argv',['preview.py','--manager','--no-browser']):
                preview.main();run.assert_called_once_with(root/'web','/manager/',8765,False)
            with patch.object(preview,'APP',root),patch.object(sys,'argv',['preview.py']):
                with self.assertRaisesRegex(SystemExit,'--manager'):preview.main()
    def test_port_fallback_and_cleanup(self):
        fake=Mock(server_port=8766);fake.serve_forever.side_effect=KeyboardInterrupt
        with tempfile.TemporaryDirectory() as folder,patch.object(serve,'ThreadingHTTPServer',side_effect=[OSError(errno.EADDRINUSE,'busy'),fake]) as server,patch.object(serve.webbrowser,'open') as opened:
            serve.serve(folder,'/manager/')
            self.assertEqual(server.call_args_list[0].args[0],('127.0.0.1',8765))
            self.assertEqual(server.call_args_list[1].args[0],('127.0.0.1',8766))
            opened.assert_called_once_with('http://127.0.0.1:8766/manager/')
            fake.server_close.assert_called_once()
    def test_permission_failure_is_actionable(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(serve,'ThreadingHTTPServer',side_effect=PermissionError(errno.EACCES,'denied')):
            with self.assertRaisesRegex(SystemExit,'normal Terminal'):serve.serve(folder)
    def test_mjs_mime(self):
        self.assertEqual(serve.Handler.extensions_map['.mjs'],'text/javascript')

if __name__=='__main__':unittest.main()
