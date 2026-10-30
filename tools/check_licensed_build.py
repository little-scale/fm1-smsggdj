#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check preservation of the hardware-tested snapshot during the licence update.

This is a source/binary integrity check, not a legal opinion or a general
release gate. Future functional changes require their own validation snapshot.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

APP = Path(__file__).resolve().parents[1]
COMMENTS_OR_LITERALS = re.compile(
    r'/\*.*?\*/|//[^\r\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
    re.S,
)


def source_body(data, suffix):
    if suffix not in ('.c', '.h'):
        return data
    # Preserve strings, characters, code indentation and operator spacing.
    # A comment becomes whitespace; remove blank lines and trailing spaces.
    text = COMMENTS_OR_LITERALS.sub(
        lambda match: ' ' if match[0].startswith('/') else match[0],
        data.decode('utf-8'),
    )
    return '\n'.join(line.rstrip() for line in text.splitlines() if line.strip()).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firmware', type=Path, help='Also compare this .fwsc with the preserved tested package')
    args = parser.parse_args()
    evidence = json.loads((APP / 'evidence/licensing/preservation.json').read_text())
    for name, record in evidence['source_files'].items():
        path = APP / name
        if digest(source_body(path.read_bytes(), path.suffix)) != record['non_comment_sha256']:
            raise SystemExit('Tested source snapshot differs: ' + name)
    print('PASS retained source and ROM:', len(evidence['source_files']), 'files; licence comments excluded from C comparisons')
    if args.firmware:
        data = args.firmware.read_bytes()
        expected = evidence['tested_firmware']
        if len(data) != expected['bytes'] or digest(data) != expected['sha256']:
            raise SystemExit('Firmware differs from the hardware-tested package.')
        print('PASS unchanged tested firmware:', expected['sha256'])


if __name__ == '__main__':
    main()
