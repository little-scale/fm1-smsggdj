# Source and licenses

The original FM1 adapter, browser manager, tests and build tools in this
repository are **MIT**, copyright 2026 Seb Tomczak (little-scale), under
[LICENSE](LICENSE). This grant covers our original contributions only. It does
not relicense the emulator, platform, ROM or copied browser panel.

This repository is a source collection with mixed dependency licenses. **The
complete emulator/firmware must not be described as all-MIT.** The inherited
Z80 non-commercial/GPL conflict has been addressed using the published MAME
BSD-3-Clause relicensing and Eke-Eke's public agreement for his CPU changes.
The tested CPU implementation is retained; its licensing comments have changed.
The permission chain and its scope are documented in
[vendor/Z80-LICENSING.md](vendor/Z80-LICENSING.md), with pinned evidence in
[evidence/licensing/permissions.json](evidence/licensing/permissions.json).

The combined firmware application is distributed under **GPL-2.0**, retaining
the applicable MIT, BSD-3-Clause and MPL-2.0 notices and source obligations.
This uses GPL version 2 for the GPL-2.0-or-later core and retains the pinned
Retro-Go distribution's GPLv2 terms. The MPL platform's section 3.3 permits
the applicable additional GPL terms for this larger work; its original MPL
notices remain. Independently distributed ROM, browser tools, fonts and SDK
components keep the terms listed below. No prebuilt firmware release is
included here yet.

| Component | Source and terms |
| --- | --- |
| FM1 adapter and browser manager | Original files outside the inherited components below: MIT. SPDX headers identify the newly licensed adapter files. |
| SMS Plus | Charles MacDonald, Eke-Eke, Maxim and contributors; see `vendor/smsplus/CREDITS`. Most files retain GPL-2.0-or-later notices and `vendor/smsplus/COPYING`; individual file notices take precedence. |
| Z80 CPU | Juergen Buchmueller/MAME V3.9 and shared Eke-Eke changes: BSD-3-Clause, using the published permissions documented in `vendor/Z80-LICENSING.md`; full BSD notice in `vendor/smsplus/cpu/LICENSE.BSD-3-Clause`. Retro-Go adaptations remain GPL-2.0 and original FM1 changes retain MIT. The combined CPU file is distributed under GPL-2.0; it is not an all-BSD or all-MIT file. |
| SN76489 PSG | Original Maxim and Charles MacDonald attribution in `vendor/smsplus/sound/sn76489.c` retained, together with the imported GPL distribution's COPYING and CREDITS. This file has no separate licence block; no new BSD or MIT grant is asserted for it. The Z80 permissions do not cover it. |
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

`vendor/licensing.patch` applies the Z80 notice correction after the
performance patch. The importer records both the original source hashes and
the final imported hashes, including the corrected CPU notice. An isolated
reimport reproduced all 36 vendored files byte-for-byte. The CPU object compiled
on the host is byte-identical before/after the notice correction, all 48
tracked C/header/configuration/ROM files retain their non-comment source, and
the tested `.fwsc` SHA-256 is unchanged. See
[evidence/licensing/preservation.json](evidence/licensing/preservation.json).

The release must accompany its binary with the matching source and build
scripts, both pinned platform submodules and their notices, the GPL and BSD
texts, MPL terms, and the ROM/font/SDK notices appropriate to what is actually
included. A GitHub-generated source archive alone does not include submodule
contents. A firmware release is not granted an MIT-only licence by this audit.

`vendor/performance.patch` records the subsequent HALT batching, 48 KiB
signature-checked decoded tile-row cache, and explicit tiny-copy intrinsics.
The importer reapplies that patch and has been checked to reproduce every
vendored source file. Those changes preserve the existing file licenses.
