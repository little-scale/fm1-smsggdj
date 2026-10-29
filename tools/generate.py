#!/usr/bin/env python3
"""Verify the pinned ROM/map and emit freestanding ROM and symbol headers."""
import argparse
import hashlib
import json
import zlib
from pathlib import Path

APP = Path(__file__).resolve().parents[1]

def generate(out):
    pin = json.loads((APP/'rom/manifest.json').read_text())
    rom = (APP/'rom/smsggdj-v0.48.gg').read_bytes()
    if hashlib.sha256(rom).hexdigest() != pin['sha256']:
        raise SystemExit('ROM does not match the pinned RAM map; regenerate and review the map.')
    if rom[0x7ff0:0x7ff8] != b'TMR SEGA' or rom[0x7fff] >> 4 != 6:
        raise SystemExit('Expected Game Gear export ROM')
    out.mkdir(parents=True, exist_ok=True)
    text = '/* Generated from the pinned, unmodified SMSGGDJ ROM. */\n'
    text += 'static const unsigned char fmgg_rom[] = {\n'
    text += ''.join(','.join('0x%02x'%v for v in rom[i:i+32])+',\n' for i in range(0,len(rom),32))
    (out/'rom_data.h').write_text(text+'};\n')
    text = '#pragma once\n/* Generated symbols for ROM SHA-256 '+pin['sha256']+' */\n'
    for name, address in pin['symbols'].items():
        text += '#define RAM_'+name.upper()+' 0x%04xu\n'%address
    (out/'ram_map.h').write_text(text)
    pin['code_crc32'] = zlib.crc32(rom[:32768])
    pin['crc32'] = zlib.crc32(rom)
    pin['phrases'] = 52
    pin['instruments'] = 16
    pin['midi_low'] = 45
    pin['midi_high'] = 155
    pin['save_format'] = 'SMDJ4'
    text = '#pragma once\nstatic const gg_profile default_profile = {\n'
    text += 'GG_PROFILE_MAGIC, %du, %du, %du,\n{' % (len(rom),pin['crc32'],pin['code_crc32'])
    text += ','.join(str(v) for v in pin['symbols'].values())
    text += '},52,45,155,16,0,"SMSGGDJ v0.48"\n};\n'
    (out/'default_profile.h').write_text(text)
    manager = APP/'web/manager'
    manager.mkdir(parents=True,exist_ok=True)
    (manager/'default-profile.json').write_text(json.dumps(pin,indent=2)+'\n')

if __name__ == '__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('out',type=Path)
    generate(ap.parse_args().out)
