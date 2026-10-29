# First FM1 hardware test

The source has passed native and compiled WASM tests. **The first device
build passed on 30 October 2026; physical FM1 results are pending.** The
252,492-byte image uses 29,176/98,304 bytes static RAM and 269,520/344,064 bytes
pool RAM. All platform image, memory and instruction checks passed.
Package identity: `FM-1_9500`; SHA-256:
`9bc163b7719a4abe73f114b2c844d8d98c33123f9dd3a4e4fe49542e225055d6`.

## Build

1. Initialize the pinned submodules and configure the JieLi toolchain/Docker
   as described in the README and platform documentation.
2. Run `python3 tools/build.py --device` or `Build-GGDJ.command`. Check that
   `build/device-status.json` says `success: true` and the platform's RAM,
   image-size and instruction checks pass. Output: `build/ggdj-fm1.fwsc`.
3. Export work to preserve from the current firmware, then run
   `./Install-GGDJ.command`. It checks the package against the successful build,
   uses the pinned platform installer with its confirmation prompt, and checks
   the identity after restart. Installation replaces the current instrument;
   cartridge writes can reuse flash previously used by other apps. Keep power
   and USB connected, and begin with MASTER low. Logs are in
   `build/device-install.log` and `build/device-identity.txt`.

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
