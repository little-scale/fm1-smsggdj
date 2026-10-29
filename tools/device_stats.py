#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Read live performance counters without changing playback, RAM or cartridge data."""
import argparse
import json
import struct
import sys
import time
from pathlib import Path
from paths import APP, BASE


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--seconds', type=float, default=10)
    ap.add_argument('--port', help='MIDI port name substring')
    ap.add_argument('--out', type=Path, default=APP/'build/device-performance.json')
    args = ap.parse_args()
    if not 1 <= args.seconds <= 120:
        ap.error('--seconds must be between 1 and 120')
    import mido
    sys.path.insert(0, str(BASE/'tools'))
    from fm1_install import pack7, unpack7
    def choose(names):
        matches = [n for n in names if args.port.lower() in n.lower()] if args.port else [n for n in names if 'fm1' in n.lower().replace('-', '')]
        if len(matches) != 1:
            raise SystemExit('Select one FM1 port with --port. Available: '+', '.join(names))
        return matches[0]
    samples = []
    seq = 0
    with mido.open_input(choose(mido.get_input_names())) as inp, mido.open_output(choose(mido.get_output_names())) as out:
        start = time.monotonic()
        while True:
            body = struct.pack('<BBH', 1, 13, seq)
            raw = bytes([0, 0x59, 0x66, len(body), 0, 0])+body+bytes([~sum(body)&255])
            out.send(mido.Message('sysex', data=pack7(raw)))
            deadline = time.monotonic()+2
            reply = None
            while time.monotonic() < deadline and reply is None:
                for message in inp.iter_pending():
                    if message.type != 'sysex':
                        continue
                    data = unpack7(message.data)
                    if len(data) < 12 or data[:3] != bytes([0,0x59,0x66]):
                        continue
                    count = int.from_bytes(data[3:6], 'little')
                    if len(data) != count+7 or sum(data[6:])&255 != 255:
                        continue
                    packet = data[6:-1]
                    if packet[:4] != struct.pack('<BBH', 1, 13|128, seq):
                        continue
                    if packet[4]:
                        raise SystemExit('Firmware rejected performance query; install the performance-update build first.')
                    if len(packet) != 25:
                        raise SystemExit('Unexpected performance counter size')
                    reply = struct.unpack('<5I', packet[5:])
                if reply is None:
                    time.sleep(.005)
            if reply is None:
                raise SystemExit('FM1 did not answer. Check the selected ports and running firmware.')
            elapsed = time.monotonic()-start
            row = dict(zip(('device_ms','cpu_pct','xruns','emulated_frames','fault'),reply))
            row['host_seconds'] = round(elapsed,3)
            samples.append(row)
            print(f"{elapsed:5.1f}s  CPU {row['cpu_pct']:3d}%  xruns {row['xruns']}  frames {row['emulated_frames']}  fault {row['fault']}",flush=True)
            if elapsed >= args.seconds:
                break
            seq = (seq+1)&65535
            time.sleep(.5)
    first,last=samples[0],samples[-1]
    duration=last['host_seconds']-first['host_seconds']
    result={'samples':samples,'max_sampled_cpu_pct':max(s['cpu_pct'] for s in samples),
        'new_xruns':(last['xruns']-first['xruns'])&0xffffffff,
        'emulated_fps':round(((last['emulated_frames']-first['emulated_frames'])&0xffffffff)/duration,2) if duration else None,
        'fault':any(s['fault'] for s in samples),'writes_to_device':False}
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    print('Saved '+str(args.out))

if __name__ == '__main__':
    main()
