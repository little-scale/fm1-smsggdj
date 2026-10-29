# fm1-smsggdj

[SMSGGDJ](https://github.com/little-scale/smsggdj) on the **M-VAVE FM-1**:
a Game Gear emulator that boots the tracker, maps the FM1 keyboard to step
entry through emulated RAM, and includes a browser cartridge manager.

**Development prototype.** Host, actual WebAssembly tests and the JieLi device
build pass. The first build boots and runs on a physical FM1, but its audio
stutters. The performance update below awaits a hardware retest; no validated
binary is published. This port reuses the SMS Plus core from the earlier
working ESP32-S3 setup. The default ROM is the unchanged SMSGGDJ **v0.48** Game
Gear release, pinned with its symbol map and hash in `rom/manifest.json`.

- Enter a note from the keyboard and advance to the next of 16 steps.
- Keep the original tracker screens, instrument editing and audition.
- Back up/restore SRAM and manage individual songs in a browser.
- Swap compatible SMSGGDJ ROMs, with validated address profiles and a built-in
  ROM fallback.

## Get the source

```sh
git clone --recurse-submodules https://github.com/little-scale/fm1-smsggdj.git
cd fm1-smsggdj
```

The pinned [fm1-base](https://github.com/charlesvestal/fm1-base) platform and
[felucca-bsp](https://github.com/hugelton/felucca-bsp) are submodules; they are
not copies of a local modified development tree. If already cloned, run
`git submodule update --init --recursive`.

## Build and try

Use Python **3.11+**, Pillow (`python3 -m pip install Pillow`), Clang and Node.js.
The browser build also needs Emscripten (`emcc` on PATH). Follow the pinned
platform's [build documentation](platform/fm1-base/README.md) for the JieLi
Linux x86-64 toolchain and Docker setup on macOS. Set `JIELI_TOOLCHAIN` to the
installed toolchain, and `JIELI_DOCKER=1` when using Docker. SDK dependencies
are external and are not committed here.

```sh
python3 tools/build.py --host     # native build + full panel scenario
python3 tools/test.py             # real-core UBSan and persistence tests
python3 tools/build.py --web      # WASM build + browser/manager/format tests
python3 tools/preview.py          # emulator at http://127.0.0.1:8765/
python3 tools/preview.py --manager # cartridge manager
python3 tools/build.py --device   # builds only; never installs or flashes
```

On the configured Mac workspace, double-click **Preview-GGDJ.command**,
**Manager-GGDJ.command**, **Verify-GGDJ.command**, or **Build-GGDJ.command**.
After a successful device build, **Install-GGDJ.command** validates its hash,
asks before installing, and checks the device identity after restart. Export
work to preserve from the current firmware first; app storage is not migrated.
The launchers optionally load a sibling workspace's `setup/env.sh`; a fresh
checkout uses the tools on PATH. `FM1_BASE` can explicitly select another
platform checkout; the default is the pinned submodule.

In the preview, click **Switch on**. Shift-click a panel button to hold it for
a chord; click again to release. The browser runs the real C application but
does not emulate the FM1 processor's speed. Its CPU meter cannot validate
hardware timing.

The prospective device package is `build/ggdj-fm1.fwsc`, identity `FM-1_9500`.
Build status is written to `build/{host,web,device}-status.json`. Upstream
image-size, RAM and instruction checks remain enabled. No firmware was flashed
while developing this project. See [HARDWARE_TEST.md](HARDWARE_TEST.md) for the
initial test sequence and current limits.

## Controls

| FM1 | Tracker behavior |
| --- | --- |
| SEL / SAVE | Up / Down |
| HOME / ARP | Left / Right |
| GLO / REC | Game Gear button 1 / button 2, including held chords |
| Keyboard | On PHRASE, enter a note and advance a row |
| PLAY | On PHRASE, advance without changing the step |
| EDIT | On PHRASE, go back without changing the step |
| LFO | On PHRASE, clear the complete current step and advance a row |
| OCT− / OCT+ | Transpose subsequent keyboard entries by an octave |
| MASTER | Output level |

LFO clears note, instrument and both effect bytes to the ROM's empty-row
values, without shifting other rows. Like note entry it acts once per press
and advances with wrapping. It does not cut off an already sounding voice.

The PHRASE cursor wraps 15→0 and 0→15. Press edges enter notes; holding or
releasing a key does not enter or erase another note. An existing valid
instrument/effect is kept, an empty cell receives the last instrument, and
the ROM performs its normal audition. Simultaneous keys enter successive rows
in physical key order. The default ROM accepts MIDI notes 45–155.

Keyboard/PLAY/EDIT actions are consumed without editing on other screens,
during block selection, or while a navigation control is held. Remaining
unmapped buttons and knobs currently have no function.

Start with GLO to create chain 00 on SONG, then hold REC and press ARP to enter
CHAIN. GLO creates phrase 00; REC+ARP enters PHRASE. Enter notes from the
keyboard. **Hold REC, then tap GLO** to start/stop playback. REC+HOME moves back
through the screen map. These are the existing ROM gestures. The original
[SMSGGDJ manual](https://github.com/little-scale/smsggdj/blob/main/MANUAL.md)
explains the tracker itself.

## Browser cartridge manager

Launch **Manager-GGDJ.command**, or serve the built preview and open
`http://127.0.0.1:8765/manager/` in Chrome/Edge. Files can be edited offline.
Device transfer uses Web MIDI with SysEx permission; select the FM1's MIDI input
and output and connect. The browser-preview connection uses the same compiled
C transfer handler. **Physical USB transfer is implemented but not yet tested
on an FM1.**

- **SRAM:** open/download a standard `.sav`, read from the device, or send to
  the device. Raw 8/16/32 KiB saves are accepted and normalized to 32 KiB.
- **Songs:** import/export individual `.smdj4` songs (legacy single `.smdj`
  imports also work), rename, reorder, replace or delete slots. Checksums,
  compressed capacity and the 32-song limit are checked before writing.
- **ROM:** download the active ROM, upload a compatible `.gg`, or restore the
  firmware's built-in ROM. Uploads are verified by CRC and read-back.

A read/open creates a browser-side copy; song edits change that copy. Download
it to a file or explicitly send SRAM to apply it to the device. Device writes
restart the ROM and discard unsaved working edits; the page confirms this.
Stop playback before transferring. A stale-SRAM check rejects changes if the
device has saved since it was read. Whole older SMDJ3 SRAM images need the
[upstream migration tool](https://github.com/little-scale/smsggdj/blob/main/tools/migrate.html).

Sample-bank-only edits to the known v0.48 ROM are recognized automatically.
Changed program code needs an exact SHA-256-matched JSON profile, generated
from the matching WLA symbol file:

```sh
python3 tools/make_profile.py tracker.gg tracker.sym --out tracker-profile.json
```

Select that JSON beside the ROM in the manager. Profiles describe the existing
SMSGGDJ editor/data contract; arbitrary Game Gear games or incompatible save
layouts are not supported. See [PROTOCOL.md](PROTOCOL.md) for the USB format.

## Saving songs

The ROM owns saving. From SONG, REC+SAVE opens FILES. REC+GLO opens the action
menu. Select SAVE, tap GLO for SURE, and tap GLO again to confirm. Entering notes
changes working RAM; it does not automatically create a saved song.

The emulator journals the complete 32 KiB SRAM after playback stops and SRAM
has been quiet for one second. It verifies the inactive bank before committing
its header; the previous valid bank remains recoverable. Wait for **CARTRIDGE
SAVED** before switching off. After boot or an SRAM import, use FILES → LOAD.
The browser preview persists the same cartridge data in local browser storage.

## Implementation and verification

The audio callback owns core execution, PSG writes and pending RAM actions.
It advances scanlines as samples are needed at 44.1 kHz, preserving the earlier
write-timed PSG fix. The main loop scans the panel, queues bounded control
messages and displays the original GG image at 240×216.

Navigation enters the ROM's pad RAM after input polling. Note entry updates
the phrase record and redraw state, lets the original insertion/audition
handler run, then advances at the engine-frame hook. The control adapter does
not patch ROM opcodes, CPU registers, stack or PSG registers. Runtime ROM
profiles supply validated hooks and RAM addresses.

A 120 KiB arena replaces the desktop heap; the tested core uses **107,914
bytes**. Compact arithmetic and rendering replace about 575 KiB of lookup
tables. The first device build is 252,492 bytes with 29,176/98,304 bytes static
RAM and 269,520/344,064 bytes pool RAM; realtime performance awaits hardware tests.

The performance update batches halted Z80 cycles while preserving refresh and
interrupt boundaries, caches decoded tile rows in 48 KiB with live VRAM-byte
validation, and repaints changed LCD bands instead of the full screen. It also
inlines tiny renderer copies. Audio stays at 44.1 kHz with the same emulated
clock and PSG write ordering. Current target memory use must be read from the
new device build's checks; the figures above describe the first build.

After rebuilding/installing, play the song that stuttered and run
`./Measure-GGDJ.command` from Terminal. It reads ten seconds of CPU load,
audio overruns, emulated frame rate and core-fault status without pausing
playback or changing cartridge data. Results save to
`build/device-performance.json`. The screen header shows CPU and `X` (cumulative
audio overruns); an increasing `X` indicates missed audio deadlines. Native
benchmarks in [evidence/performance-host.json](evidence/performance-host.json)
show 1.12–1.29× core speedup across TONE/KIT/WAV; this is a host measurement,
not an FM1 speed estimate. All compared audio and framebuffers remain byte-identical.

The included suites cover:

- Native panel navigation, keyboard/skip/back/wrap, held keys, transport,
  FILES SAVE, simulated reboot and LOAD.
- UBSan real-core checks, all 262,144 flag combinations and 65,536 pixel
  priority combinations, KIT on T1/T2/T3, WAV, queue bounds and interrupted
  SRAM/ROM writes.
- Actual 32-bit WASM: song export/edit/import through the JS client and C
  handler, loading/playing the result in the ROM, persistence, retry/lost-ACK,
  stale-save rejection, USB framing, ROM replacement and recovery.
- Browser file codecs, checksums/bounds/capacity, config preservation, song
  conversion and profile validation.

Generated logs and fixtures stay under `build/`. `tools/compare_reference.py
ORIGINAL_SMSPLUS_DIR` compares TONE/KIT/WAV audio and video against the earlier
ESP32 core; the original compact implementation produced byte-identical
samples and framebuffers in three 600-frame runs. ASan did not complete in the
original environment; no ASan passing result is claimed.

Physical CPU load, IRQ stack headroom, USB audio, panel response, USB cartridge
transfers and real power-cycle recovery still need hardware testing. GGFM /
YM2413, external link sync and MIDI note entry are not implemented. The ROM's
video is not translated into screen-reader text.

## License and credits

**MIT for the original FM1/browser code** — see [LICENSE](LICENSE). The ROM
and browser song codecs are also MIT. **The combined emulator is mixed-license,
with an inherited non-commercial Z80 restriction and unresolved GPL
compatibility; it is not an all-MIT distribution.** See
[THIRD_PARTY.md](THIRD_PARTY.md) for scope, notices and attribution.

Built on [SMSGGDJ](https://github.com/little-scale/smsggdj),
[SMS Plus / Retro-Go](https://github.com/ducalex/retro-go),
[fm1-base](https://github.com/charlesvestal/fm1-base), and
[felucca-bsp](https://github.com/hugelton/felucca-bsp).
