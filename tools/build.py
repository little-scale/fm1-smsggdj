#!/usr/bin/env python3
"""Build GG DJ for host, browser or device. Never installs or flashes."""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from paths import APP, BASE, WORKSPACE, require_platform

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    mode=ap.add_mutually_exclusive_group()
    mode.add_argument('--host',action='store_true')
    mode.add_argument('--web',action='store_true')
    mode.add_argument('--device',action='store_true')
    ap.add_argument('--release', metavar='X.Y.Z', help='versioned identity and package for a reviewed release build')
    a=ap.parse_args()
    require_platform()
    out=APP/'build';out.mkdir(exist_ok=True)
    os.environ.setdefault('AC79_SDK',str(WORKSPACE/'dependencies/ac79-sdk'))
    os.environ.setdefault('JIELI_TOOLCHAIN',str(WORKSPACE/'dependencies/jieli/jieli-linux-toolchains-20260730.1'))
    os.environ.setdefault('EM_CACHE',str(out/'emcache'))
    image=WORKSPACE/'setup/docker-image.txt'
    if image.exists():os.environ.setdefault('JIELI_DOCKER_IMAGE',image.read_text().strip())
    sys.path.insert(0,str(BASE/'tools'))
    spec=importlib.util.spec_from_file_location('ggdj_upstream_build',BASE/'tools/build.py')
    u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
    original_tc=u.tc
    def tc(tool,*args):
        args=list(args)
        if tool=='pi32v2/bin/ld' and '--gc-sections' in args and any(str(p).endswith('unity.o') for p in args):
            root=Path('/opt/jieli') if u.use_docker() else u.toolchain()
            args += ['--start-group',str(root/'pi32v2/lib/r3/libcompiler-rt.a'),'--end-group']
        return original_tc(tool,*args)
    u.tc=tc
    sys.argv=[str(BASE/'tools/build.py'),str(APP)]+(['--web'] if a.web else [] if a.device else ['--host'])
    if a.release:sys.argv+=['--release',a.release]
    kind='device' if a.device else 'web' if a.web else 'host'
    status={'success':False,'mode':kind,'version':a.release or 'development','installed':False,'hardware_timing_verified':False}
    try:
        u.main()
        if a.device:
            pkg=out/('ggdj-fm1-'+a.release+'.fwsc' if a.release else 'ggdj-fm1.fwsc')
            status.update(package=str(pkg),sha256=hashlib.sha256(pkg.read_bytes()).hexdigest())
        elif a.web:
            shutil.copytree(APP/'web/manager',out/'emu/manager',dirs_exist_ok=True)
            for test in ('test_web.mjs', 'test_manager.mjs', 'test_format.mjs', 'test_browser.mjs', 'test_ui.mjs'):
                subprocess.run(['node', str(APP/'tools'/test)], check=True, timeout=120)
        else:
            validation=out/'validation';validation.mkdir(exist_ok=True)
            result=subprocess.run([str(out/'host/ggdj-fm1_host'),str(APP/'tests/controls.txt'),str(validation)],check=True,text=True,capture_output=True,timeout=30)
            (validation/'controls.log').write_text(result.stdout+result.stderr)
            print(result.stdout,end='')
        status['success']=True
    except BaseException as error:
        status['error']=str(error)
        raise
    finally:
        (out/(kind+'-status.json')).write_text(json.dumps(status,indent=2)+'\n')

if __name__=='__main__':main()
