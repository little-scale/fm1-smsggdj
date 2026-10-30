#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Test dependency-free launch/site packaging without opening a socket."""
import errno
import hashlib
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
from release_assets import asset_names, validate_release
APP=Path(__file__).resolve().parents[1]

class BrowserSite(unittest.TestCase):
    def copy_app(self,root):
        shutil.copytree(APP/'web/manager',root/'web/manager')
        (root/'tools').mkdir();shutil.copyfile(APP/'tools/serve.py',root/'tools/serve.py')
        shutil.copyfile(APP/'LICENSE',root/'LICENSE')

    def published_fixture(self,root):
        self.copy_app(root)
        names=asset_names('0.1.0');assets=root/'assets';assets.mkdir()
        files={}
        for role,name in names.items():
            data=('independent '+role+' fixture').encode();(assets/name).write_bytes(data)
            files[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        prefix='releases/v0.1.0/'
        release={'schema':1,'available':True,'version':'0.1.0','product':'FM-1_9500','source_commit':'a'*40,
                 'sha256':files[names['firmware']]['sha256'],'package':prefix+names['firmware'],
                 'rom':prefix+names['rom'],'source':prefix+names['source'],'notices':prefix+names['notices'],
                 'release_url':'https://github.com/little-scale/fm1-smsggdj/releases/tag/v0.1.0','files':files}
        (root/'web/manager/release.json').write_text(json.dumps(release))
        return release,names,assets

    def test_fresh_tools_only_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            self.copy_app(root)
            (root/'web/manager/release.json').write_text(json.dumps({'schema':1,'available':False}))
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
    def test_published_assets_include_source_and_notices_in_mac_download(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);release,names,assets=self.published_fixture(root)
            out,archive=site.build_site(root,assets)
            self.assertFalse((root/'platform').exists())
            with zipfile.ZipFile(archive) as bundle:
                for name in names.values():
                    expected=(assets/name).read_bytes()
                    self.assertEqual((out/'releases/v0.1.0'/name).read_bytes(),expected)
                    self.assertEqual(bundle.read('FM1-SMSGGDJ-Manager/releases/v0.1.0/'+name),expected)
                self.assertIn(b'Use published firmware',bundle.read('FM1-SMSGGDJ-Manager/START_HERE.txt'))
            self.assertTrue(json.loads((out/'release.json').read_text())['available'])
    def test_corrupt_or_missing_release_assets_fail_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);release,names,assets=self.published_fixture(root)
            path=assets/names['firmware'];good=path.read_bytes();path.write_bytes(b'X'+good[1:])
            with self.assertRaisesRegex(ValueError,'checksum'):site.build_site(root,assets)
            path.write_bytes(good);(assets/names['source']).unlink()
            with self.assertRaisesRegex(ValueError,'missing'):site.build_site(root,assets)
    def test_release_manifest_paths_and_required_sources(self):
        with tempfile.TemporaryDirectory() as folder:
            release,names,assets=self.published_fixture(Path(folder))
            for field,value in [('package','../private.fwsc'),('source','https://other.test/source.tar.gz'),('product','FM-1_015'),('sha256','a'*64)]:
                with self.subTest(field=field),self.assertRaises(ValueError):validate_release({**release,field:value})
            incomplete={**release,'files':dict(release['files'])};del incomplete['files'][names['source']]
            with self.assertRaisesRegex(ValueError,'complete source'):validate_release(incomplete)
    def test_manager_needs_no_build(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'web/manager').mkdir(parents=True)
            with patch.object(preview,'APP',root),patch.object(preview,'manager_site',return_value=root/'build/site') as package,patch.object(preview,'serve') as run,patch.object(sys,'argv',['preview.py','--manager','--no-browser']):
                preview.main();package.assert_called_once_with(root);run.assert_called_once_with(root/'build/site','/',8765,False)
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
