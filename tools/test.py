#!/usr/bin/env python3
"""Build and run real-core UBSan tests. Never touches attached hardware."""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from paths import APP, BASE

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--asan',action='store_true')
    a=ap.parse_args()
    out=APP/'build'/('asan' if a.asan else 'tests');out.mkdir(parents=True,exist_ok=True)
    subprocess.run([sys.executable,str(APP/'tools/generate.py'),str(APP/'build/gen')],check=True)
    sys.path.insert(0,str(BASE/'tools'));import build
    conf=build.read_conf(APP/'fm1.toml')
    sources=[APP/s for s in conf['o2'] if not s.endswith(('cpu/z80.c','render.c'))]
    sources += [APP/'tests/z80_flags.c',APP/'tests/pixels.c',APP/'tests/test_core.c']
    cmd=['clang','-O2','-g','-std=c11','-ffp-contract=off','-fno-strict-aliasing',
         '-fsanitize=address,undefined' if a.asan else '-fsanitize=undefined',
         '-fno-sanitize-recover=all','-Wno-unused-value','-DPLAT_HOST',
         *['-I'+str(p) for p in [APP,APP/'vendor/smsplus',APP/'build/gen',BASE/'include']],
         *[str(s) for s in sources],'-o',str(out/'test-core')]
    subprocess.run(cmd,check=True,timeout=90)
    try:
        result=subprocess.run([str(out/'test-core'),str(out)],text=True,capture_output=True,timeout=60)
    except subprocess.TimeoutExpired:
        (out/'result.json').write_text(json.dumps({'success':False,'error':'test process timed out after 60 seconds',
            'sanitizers':'address,undefined' if a.asan else 'undefined','installed':False},indent=2)+'\n')
        print('Test process timed out after 60 seconds. No passing sanitizer result recorded.')
        return 1
    (out/'test.log').write_text(result.stdout+result.stderr)
    print(result.stdout+result.stderr,end='')
    (out/'result.json').write_text(json.dumps({'success':result.returncode==0,'sanitizers':'address,undefined' if a.asan else 'undefined',
        'rom':'v0.48','installed':False,'hardware_timing_verified':False},indent=2)+'\n')
    return result.returncode
if __name__=='__main__':raise SystemExit(main())
