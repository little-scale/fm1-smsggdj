#!/usr/bin/env python3
"""Export a matching browser ROM profile from a Game Gear ROM and WLA .sym.

Example: make_profile.py song.gg song.sym --out song-profile.json
The profile is a build contract for SMSGGDJ's editor, not an arbitrary-ROM map.
"""
import argparse
import hashlib
import json
import re
import zlib
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('rom',type=Path);ap.add_argument('symbols',type=Path)
ap.add_argument('--out',required=True,type=Path);ap.add_argument('--name')
ap.add_argument('--midi-low',type=int,default=45);ap.add_argument('--midi-high',type=int,default=155)
a=ap.parse_args();rom=a.rom.read_bytes()
if len(rom)<32768 or len(rom)>131072 or len(rom)%16384 or rom[0x7ff0:0x7ff8]!=b'TMR SEGA' or not 5<=rom[0x7fff]>>4<=7:
    raise SystemExit('Expected a 32–128 KiB Game Gear ROM.')
text=a.symbols.read_text();labels={m[2]:int(m[1],16) for l in text.splitlines() if (m:=re.match(r'[0-9a-fA-F]{2}:([0-9a-fA-F]{4}) (\w+)$',l))}
sizes={m[2]:int(m[1],16) for l in text.splitlines() if (m:=re.match(r'([0-9a-fA-F]{8}) (_sizeof_\w+)$',l))}
names=json.loads((APP/'rom/manifest.json').read_text())['symbols']
try:symbols={name:labels[name] for name in names}
except KeyError as e:raise SystemExit('Missing editor symbol: '+str(e))
if any(v>=0x4000 for k,v in list(symbols.items())[:2]) or any(not 0xc000<=v<0xe000 for k,v in list(symbols.items())[2:]):
    raise SystemExit('Symbol map does not match the supported bank-0 editor / 8 KiB RAM contract.')
phrases=sizes.get('_sizeof_phrase_pool',3328)//64;instruments=sizes.get('_sizeof_instruments',256)//16
profile={'name':a.name or a.rom.stem,'save_format':'SMDJ4','bytes':len(rom),'sha256':hashlib.sha256(rom).hexdigest(),
    'crc32':zlib.crc32(rom),'code_crc32':zlib.crc32(rom[:32768]),'phrases':phrases,'instruments':instruments,
    'midi_low':a.midi_low,'midi_high':a.midi_high,'symbols':symbols}
a.out.write_text(json.dumps(profile,indent=2)+'\n');print(a.out)
