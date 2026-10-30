# Source and licenses

The original FM1 adapter, browser manager, tests and build tools in this
repository are **MIT**, copyright 2026 Seb Tomczak (little-scale), under
[LICENSE](LICENSE). This grant covers our original contributions only. It does
not relicense the emulator, platform, ROM or copied browser panel.

This repository is a source collection with mixed dependency licenses. **The
complete emulator/firmware must not be described as MIT or unrestricted open
source.** The inherited non-commercial CPU terms conflict with the GPL core's
requirements for a combined distribution. Preserving notices does not resolve
that conflict. Replacing the CPU with a compatible implementation or obtaining
appropriate permission is needed before claiming a cleanly licensed combined
release. No prebuilt firmware release is included here.

| Component | Source and terms |
| --- | --- |
| FM1 adapter and browser manager | Original files outside the inherited components below: MIT. SPDX headers identify the newly licensed adapter files. |
| SMS Plus | Charles MacDonald, Eke-Eke, Maxim and contributors; see `vendor/smsplus/CREDITS`. Most files retain GPL-2.0-or-later notices and `vendor/smsplus/COPYING`; individual file notices take precedence. |
| Z80 CPU | Juergen Buchmueller and contributors listed in `vendor/smsplus/cpu/z80.c`. Separate non-commercial freeware notice, permission to modify/redistribute with credit, and required retained notice. **Not MIT, GPL, or OSI-approved open source.** |
| SMSGGDJ v0.48 ROM | [little-scale/smsggdj](https://github.com/little-scale/smsggdj), Seb Tomczak, MIT; original `rom/LICENSE` retained. ROM bytes unchanged. Source revision and SHA-256 are in `rom/manifest.json`. |
| Song codecs | `web/manager/vendor/rle.mjs` and `smdj4.mjs`, adapted from SMSGGDJ's MIT browser tools. Original license and source/hash provenance are in that directory. Changes: ES module wrappers and removal of command-line self-tests. |
| Browser firmware updater | `web/manager/vendor/fm1ota.mjs` and `fm1pkg.mjs`, unmodified apart from the extension, from pinned fm1-base revision `bbfd4615e344028c90375bbdd79968e1b6ba2cd9`. MPL-2.0; Charles Vestal, Leo Kuroshita and Hügelton Instruments. Source/hash provenance and MPL text are included in that directory. |
| Browser panel | `web/emu/index.html`, adapted from fm1-base, retains Charles Vestal's MPL-2.0 notice. The app/worklet adapters are original MIT files. |
| fm1-base / felucca-bsp | Pinned Git submodules under `platform/fm1-base`; retain their MPL-2.0 and individual dependency notices. See the platform's `LICENSE`, `LICENSING.md` and `CREDITS.md`. |
| SDK, fonts, compiler | Not bundled here; retain their upstream terms. See the platform's licensing documentation. |

## Emulator provenance and changes

SMS Plus was imported from the earlier working `smsggdj-waveshare` ESP32-S3
port, based on [Retro-Go](https://github.com/ducalex/retro-go) revision
`4ced120669750ca7228fd0414211430c1d923166`, directory
`retro-core/components/smsplus/`. Original and imported file hashes are in
`vendor/provenance.json`. The inherited PSG write-timing fix is preserved.

FM1 changes replace large arithmetic/render lookup tables, add incremental
scanline stepping and RAM-adapter instruction callbacks with runtime ROM
profiles, and use bounded 32-bit audio-clock arithmetic. Hosted C-library
headers are limited to host/WASM builds; the device uses the
platform's freestanding memory routines and the existing emulator allocator.
These modifications do not remove the original files' license obligations.
`tools/import_core.py`
reproduces the import from the earlier Waveshare core directory.

`vendor/performance.patch` records the subsequent HALT batching, 48 KiB
signature-checked decoded tile-row cache, and explicit tiny-copy intrinsics.
The importer reapplies that patch and has been checked to reproduce every
vendored source file. Those changes preserve the existing file licenses.
