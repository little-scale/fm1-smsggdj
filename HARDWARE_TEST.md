# First FM1 hardware test

The source has passed native and compiled WASM tests. **A successful device
link and actual hardware results have not yet been recorded.** The original
development sandbox could not access Docker's socket; a device package was
not produced or flashed there.

## Build

1. Initialize the pinned submodules and configure the JieLi toolchain/Docker
   as described in the README and platform documentation.
2. Run `python3 tools/build.py --device` or `Build-GGDJ.command`. Check that
   `build/device-status.json` says `success: true` and the platform's RAM,
   image-size and instruction checks pass. Output: `build/ggdj-fm1.fwsc`.
3. Use the existing fm1-base installation/recovery procedure for the FM1. The
   build wrapper never installs anything automatically.

## Record these results

| Test | Expected result |
| --- | --- |
| Boot, display and MASTER | Tracker reaches SONG; stable picture and output level |
| Navigation | SEL/SAVE up/down, HOME/ARP left/right; GLO/REC act as GG buttons 1/2 |
| Create a phrase | GLO on SONG; REC+ARP; GLO on CHAIN; REC+ARP |
| Keyboard | One note and one-row advance per press; hold/release adds no extra note |
| PLAY / EDIT on PHRASE | Forward/back one step, unchanged note; wrap at 16 |
| Transport | Hold REC then tap GLO; repeat to stop |
| Audio | TONE, KIT on T1/T2/T3, WAV; listen for gaps, distortion and hangs during navigation |
| Save / power cycle | FILES SAVE with confirmation; wait CARTRIDGE SAVED; cycle power; FILES LOAD restores song |
| USB audio | Record output, check rate and continuity during complex playback |
| Manager SRAM | Stop playback; connect input/output with SysEx; read SRAM, download backup, write and read back |
| Manager song | Export a saved song; edit/import a copy; send SRAM; load through original ROM |
| Manager ROM | Back up SRAM; upload compatible sample-patched v0.48 ROM; reboot; restore built-in |
| Runtime budget | Record CPU load, panel response and any crash/stack report during complex songs |

Do not deliberately cut power during flash writes for the initial test.
Interrupted-write recovery has been exercised in a simulated NOR-flash model;
real power interruption and USB transfer timing remain unverified.

Only songs saved by the ROM's FILES menu are in SRAM. Device writes restart the
ROM and discard unsaved working edits. Keep the downloaded SRAM backup for
comparison. Note firmware commit, ROM hash, host OS/browser, test song, and any
platform crash report with each result.
