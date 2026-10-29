# Cartridge manager protocol v1

Reference implementation: `manager.c`, `profile.c` and
`web/manager/transport.mjs`. All multi-byte integers are little-endian. This
is an app-specific command; it does not upload FM1 firmware.

## USB envelope

The existing FM1 SysEx transport carries unpacked bytes
`00 59 66 LEN24 BODY CHECKSUM`. CHECKSUM is the bitwise complement of the sum
of BODY bytes modulo 256. The unpacked envelope is packed as a continuous
little-endian bitstream into seven-bit bytes and framed with `F0` / `F7`.

Request BODY: `[version=1, opcode, sequence:u16, arguments...]`, max 264 bytes.
Reply BODY: `[1, opcode|0x80, sequence:u16, status, data...]`, max 272 bytes.

| Opcode | Operation / arguments |
| --- | --- |
| 1 | INFO, no arguments |
| 2 | READ_BEGIN, source:u8 (0 SRAM, 1 ROM) |
| 3 | READ, offset:u32 + count:u16 (up to 256) |
| 4 | READ_END |
| 5 | WRITE_BEGIN, size:u32 + new CRC32:u32 + current SRAM CRC32:u32 |
| 6 | WRITE, offset:u32 + up to 256 bytes |
| 7 | WRITE_COMMIT |
| 8 | ROM_BEGIN, 100-byte profile |
| 9 | ROM_WRITE, offset:u32 + up to 256 bytes |
| 10 | ROM_COMMIT |
| 11 | ABORT |
| 12 | Restore built-in ROM |

Status codes: 0 OK; 1 bad request; 2 playing; 3 busy; 4 range; 5 CRC;
6 flash; 7 stale SRAM; 8 profile; 9 state; 10 booting.

INFO data is 116 bytes: `GDJ1` magic at 0; transfer mode, playing, external-ROM,
boot-ready flags at 4–7; SRAM CRC32 at 8; journal generation at 12; profile at
16. Read-begin/chunk reply layouts are defined by the reference client.

Transfers hold emulation, require stopped playback and expire after five
seconds without activity. Chunks are sequential; matching duplicates and a
cached repeated sequence tolerate a lost reply. Commit verifies CRCs, persists
data, then restarts the ROM with the staged SRAM. A stale current-SRAM CRC
rejects a write. READ_END releases a read snapshot. ABORT releases a session;
a partially overwritten ROM falls back to the built-in image.

## ROM profiles

Wire profile: 100 bytes. `GGP1` magic at 0; ROM size at 4; full ROM CRC32 at 8;
first-32-KiB CRC32 at 12; 25 address fields (u16) at 16; phrase count:u16 at
66; MIDI low/high at 68/69; instrument count at 70; reserved zero at 71;
24-byte terminated name at 72; CRC32 of bytes 0–95 at 96.

Address order is defined by `profile.h` and the pinned manifest. Code hooks
must be distinct bank-zero addresses; RAM addresses and related array extents
must fit in the emulated 8 KiB RAM. ROMs are 32–128 KiB in 16 KiB multiples
with a Game Gear header. Browser JSON profiles additionally pin exact SHA-256.
A profile is not a general save-layout translator.

## Flash layout

| Range (end exclusive) | Purpose |
| --- | --- |
| `0x98000–0xA1000` | SRAM journal bank A (36 KiB) |
| `0xA1000–0xAA000` | SRAM journal bank B (36 KiB) |
| `0xAA000–0xAB000` | Optional ROM metadata (4 KiB) |
| `0xAB000–0xCB000` | Optional ROM data (128 KiB) |

Journal banks have a 20-byte validated header and payload at offset 256.
Inactive-bank data is written and checked before the header is committed.
ROM metadata contains marker `GRM1` then the profile; the marker is written
last. An upload first persists SRAM, invalidates old metadata, then erases and
writes ROM data. Boot validates the entire optional ROM and profile; invalid
or incomplete metadata selects the ROM embedded in firmware.
