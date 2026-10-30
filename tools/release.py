#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Package the preserved tested firmware, recursive source and licence notices.

No build, device access, tag, upload or publication is performed by this tool.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import zipfile
from check_licensed_build import source_body
from release_assets import REPOSITORY, asset_names, validate_release

APP = Path(__file__).resolve().parents[1]


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def snapshot(repo, prefix='', expected=None):
    commit = git(repo, 'rev-parse', 'HEAD').decode().strip()
    if expected and commit != expected:
        raise ValueError('Submodule is not at its pinned commit: ' + prefix)
    if git(repo, 'status', '--porcelain', '--untracked-files=normal').strip():
        raise ValueError('Commit source changes before packaging: ' + str(repo))
    files, modules = {}, {}
    with tarfile.open(fileobj=io.BytesIO(git(repo, 'archive', '--format=tar', 'HEAD'))) as archive:
        for member in archive:
            if member.isdir():
                continue
            if not member.isfile() or member.name.startswith('/') or '..' in Path(member.name).parts:
                raise ValueError('Unsupported source archive entry: ' + member.name)
            files[prefix+member.name] = (archive.extractfile(member).read(), member.mode)
    for entry in git(repo, 'ls-tree', '-rz', '--full-tree', 'HEAD').split(b'\0'):
        if not entry:
            continue
        meta, name = entry.split(b'\t', 1)
        mode, kind, sha = meta.decode().split()
        if mode == '160000':
            name = name.decode()
            child, nested = snapshot(repo/name, prefix+name+'/', sha)
            files.update(child)
            modules[prefix+name] = sha
            modules.update(nested)
    return files, modules


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_source(path, version, files, metadata, epoch):
    entries = dict(files)
    entries['RELEASE-SOURCE.json'] = ((json.dumps(metadata, indent=2)+'\n').encode(), 0o644)
    with path.open('wb') as output, gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=epoch) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for name, (data, mode) in sorted(entries.items()):
                info = tarfile.TarInfo(f'fm1-smsggdj-{version}-source/'+name)
                info.size, info.mode, info.mtime = len(data), mode, epoch
                archive.addfile(info, io.BytesIO(data))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--firmware', type=Path, default=APP/'build/ggdj-fm1.fwsc')
    args = parser.parse_args()
    names = asset_names(args.version)
    files, modules = snapshot(APP)
    commit = git(APP, 'rev-parse', 'HEAD').decode().strip()
    epoch = int(git(APP, 'show', '-s', '--format=%ct', 'HEAD').strip())
    evidence = json.loads(files['evidence/licensing/preservation.json'][0])
    for name, item in evidence['source_files'].items():
        if sha(source_body(files[name][0], Path(name).suffix)) != item['non_comment_sha256']:
            raise ValueError('Hardware-tested execution source changed: ' + name)
    for name, item in evidence['submodules'].items():
        if modules.get(name) != item['commit']:
            raise ValueError('Hardware-tested platform revision changed: ' + name)
    firmware = args.firmware.read_bytes()
    tested = evidence['tested_firmware']
    if len(firmware) != tested['bytes'] or sha(firmware) != tested['sha256']:
        raise ValueError('Firmware differs from the preserved hardware-tested package.')
    script = '''import fs from 'node:fs';import {webcrypto} from 'node:crypto';
import {inspectFirmware} from './web/manager/firmware.mjs';
globalThis.crypto??=webcrypto;
const p=await inspectFirmware(new Uint8Array(fs.readFileSync(process.argv[1])));
console.log(JSON.stringify({product:p.product,sha256:p.sha256}));'''
    inspected = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script, str(args.firmware.resolve())], cwd=APP))
    if inspected['product'] != tested['product'] or inspected['sha256'] != tested['sha256']:
        raise ValueError('Package identity/integrity check failed.')
    rom = files['rom/smsggdj-v0.48.gg'][0]
    rom_manifest = json.loads(files['rom/manifest.json'][0])
    if sha(rom) != rom_manifest['sha256']:
        raise ValueError('Pinned ROM differs.')
    out = APP/'build/releases'/('v'+args.version)
    out.mkdir(parents=True, exist_ok=True)
    (out/names['firmware']).write_bytes(firmware)
    (out/names['rom']).write_bytes(rom)
    metadata = {'version': args.version, 'source_commit': commit, 'submodules': modules,
                'firmware_product': inspected['product'], 'firmware_sha256': sha(firmware),
                'firmware_rebuilt': False, 'source_file_count': len(files),
                'files': {name: sha(data) for name, (data, mode) in sorted(files.items())}}
    write_source(out/names['source'], args.version, files, metadata, epoch)
    notices = {
        'LICENSE-MIT.txt': 'LICENSE', 'GPL-2.0.txt': 'vendor/smsplus/COPYING',
        'Z80-BSD-3-Clause.txt': 'vendor/smsplus/cpu/LICENSE.BSD-3-Clause',
        'THIRD_PARTY.md': 'THIRD_PARTY.md', 'Z80-LICENSING.md': 'vendor/Z80-LICENSING.md',
        'SMSGGDJ-ROM-MIT.txt': 'rom/LICENSE', 'SMSPLUS-CREDITS.txt': 'vendor/smsplus/CREDITS',
        'FM1-BASE-MPL-2.0.txt': 'platform/fm1-base/LICENSE',
        'FM1-BASE-LICENSING.md': 'platform/fm1-base/LICENSING.md',
        'FM1-BASE-CREDITS.md': 'platform/fm1-base/CREDITS.md',
        'BSP-MPL-2.0.txt': 'platform/fm1-base/bsp/LICENSE',
        'BSP-LICENSING.md': 'platform/fm1-base/bsp/LICENSING.md',
        'JIELI-APACHE-2.0.txt': 'platform/fm1-base/LICENSES/Apache-2.0.txt',
        'BARLOW-OFL.txt': 'platform/fm1-base/assets/fonts/Barlow-OFL.txt',
        'TERMINUS-OFL.txt': 'platform/fm1-base/assets/fonts/Terminus-LICENSE.txt',
        'permission-evidence.json': 'evidence/licensing/permissions.json',
    }
    with zipfile.ZipFile(out/names['notices'], 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, source in sorted(notices.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, files[source][0])
        info = zipfile.ZipInfo('SOURCE.txt', (2026, 1, 1, 0, 0, 0));info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, f'Complete corresponding source: {names["source"]}\nSource commit: {commit}\nIncludes both pinned platform submodules and the unchanged MIT ROM.\nThe application is GPL-2.0 with retained component notices; original adapter/browser/ROM grants remain MIT.\n')
    checksums = ''.join(f'{sha((out/name).read_bytes())}  {name}\n' for role, name in sorted(names.items()) if role != 'checksums')
    (out/names['checksums']).write_text(checksums)
    prefix = f'releases/v{args.version}/'
    release = {'schema': 1, 'available': True, 'version': args.version,
               'product': inspected['product'], 'sha256': sha(firmware), 'source_commit': commit,
               'package': prefix+names['firmware'], 'rom': prefix+names['rom'],
               'source': prefix+names['source'], 'notices': prefix+names['notices'],
               'release_url': f'{REPOSITORY}/releases/tag/v{args.version}',
               'files': {name: {'sha256': sha((out/name).read_bytes()), 'bytes': (out/name).stat().st_size} for name in names.values()}}
    validate_release(release)
    (out/'release.json').write_text(json.dumps(release, indent=2)+'\n')
    (out/'release-notes.md').write_text(f'''SMSGGDJ v0.48 on M-VAVE FM1, with Game Gear emulation, keyboard step entry and a browser installer/song manager.

Install in Chrome or Edge: https://little-scale.github.io/fm1-smsggdj/

- Connect FM1, choose **Use published firmware**, then **Install selected firmware**.
- Export work from the current instrument first. Keep USB and power connected during installation.
- The unchanged SMSGGDJ v0.48 ROM is embedded in the firmware and also provided as a standalone `.gg` file.
- Hardware testing confirmed playback, LFO clearing without cursor movement, browser installation, SRAM backup/restore, song upload/replacement and ROM swapping.

This release preserves the exact tested firmware bytes. Its device identity remains **FM-1_9500**, displayed as **Development build**; the distribution release is {args.version}. That device identity alone cannot distinguish it from earlier development builds. Future releases can use embedded version identities.

The firmware application is GPL-2.0 with retained component notices. Original FM1/browser code and the ROM retain MIT. Published Z80 BSD permissions and the audit record are included in the source and notice archive.

Download `{names['source']}` for complete corresponding source, including both platform submodules. The automatically generated GitHub source archives omit submodule contents. `{names['notices']}` contains licence texts and attribution; `SHA256SUMS.txt` covers the four main downloads.

Source commit: `{commit}`. Firmware SHA-256: `{sha(firmware)}`.
''')
    print('Release assets:', out)
    print('Source snapshot:', commit, ';', len(files), 'files;', len(modules), 'submodules')
    print('Preserved firmware:', inspected['product'], sha(firmware))


if __name__ == '__main__':
    main()
