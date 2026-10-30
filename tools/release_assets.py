# SPDX-License-Identifier: MIT
"""Validate and obtain the immutable assets of a published project release."""
import hashlib
import re
from pathlib import Path
import urllib.request

REPOSITORY = 'https://github.com/little-scale/fm1-smsggdj'


def asset_names(version):
    if not isinstance(version, str) or not re.fullmatch(r'\d{1,2}\.\d{1,2}\.\d{1,2}', version):
        raise ValueError('Invalid release version.')
    return {
        'firmware': f'fm1-smsggdj-{version}.fwsc',
        'rom': 'smsggdj-v0.48.gg',
        'source': f'fm1-smsggdj-{version}-source.tar.gz',
        'notices': f'fm1-smsggdj-{version}-notices.zip',
        'checksums': 'SHA256SUMS.txt',
    }


def validate_release(release):
    if release.get('schema') != 1 or type(release.get('available')) is not bool:
        raise ValueError('Invalid release manifest.')
    if not release['available']:
        return {}
    version = release.get('version')
    names = asset_names(version)
    product = 'FM-1_95' + ''.join(part.zfill(2) for part in version.split('.'))
    if release.get('product') not in ('FM-1_9500', product):
        raise ValueError('Release version and firmware identity differ.')
    if not re.fullmatch(r'[a-f0-9]{40}', release.get('source_commit', '')):
        raise ValueError('Missing pinned source commit.')
    prefix = f'releases/v{version}/'
    for role in ('firmware', 'rom', 'source', 'notices'):
        field = 'package' if role == 'firmware' else role
        if release.get(field) != prefix + names[role]:
            raise ValueError('Unexpected release asset path: ' + field)
    if release.get('release_url') != f'{REPOSITORY}/releases/tag/v{version}':
        raise ValueError('Unexpected release URL.')
    files = release.get('files', {})
    if set(files) != set(names.values()):
        raise ValueError('Release must include firmware, ROM, complete source, notices and checksums.')
    limits = {'firmware': 4*1024*1024, 'rom': 131072, 'source': 32*1024*1024, 'notices': 4*1024*1024, 'checksums': 8192}
    for role, name in names.items():
        item = files[name]
        if not isinstance(item, dict) or not re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')):
            raise ValueError('Invalid checksum: ' + name)
        size = item.get('bytes')
        if type(size) is not int or not 0 < size <= limits[role]:
            raise ValueError('Invalid asset size: ' + name)
    if release.get('sha256') != files[names['firmware']]['sha256']:
        raise ValueError('Firmware checksum fields differ.')
    return names


def checked_bytes(path, item):
    if path.is_symlink() or path.stat().st_size != item['bytes']:
        raise ValueError('Release asset size or file type differs: ' + path.name)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError('Release asset checksum differs: ' + path.name)
    return data


def obtain_assets(app, release, directory=None):
    names = validate_release(release)
    if not names:
        return {}
    folder = Path(directory) if directory is not None else Path(app)/'build/release-assets'/('v'+release['version'])
    folder.mkdir(parents=True, exist_ok=True)
    result = {}
    for name in names.values():
        path = folder/name
        item = release['files'][name]
        if not path.exists():
            if directory is not None:
                raise ValueError('Release asset is missing: ' + name)
            url = f"{REPOSITORY}/releases/download/v{release['version']}/{name}"
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(item['bytes']+1)
            if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('Downloaded release asset failed verification: ' + name)
            path.write_bytes(data)
        result[name] = checked_bytes(path, item)
    return result
