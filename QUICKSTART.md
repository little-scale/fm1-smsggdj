# FM1 SMSGGDJ: browser setup

Open **https://little-scale.github.io/fm1-smsggdj/** in Chrome or Edge.
The browser tools need no Python, Docker, Node.js, Emscripten, SDK or compiler.

The firmware boots on an FM1, but audio-performance improvements and physical
browser transfers/installation still need hardware validation. **There is no
published firmware download yet.** The page can check and install a local
`.fwsc` file built from this project. It never automatically installs anything.

## Connect

1. Connect and power the FM1 with a USB data cable.
2. Click **Connect FM1** and allow MIDI/SysEx access.
3. The page identifies the installed firmware and selects matching ports.
   If there are several FM1s or detection fails, open **Advanced connection**
   and select the input/output manually.

Stock firmware can connect for installation. Song and ROM transfers become
available when compatible SMSGGDJ firmware is running. Unplugging disables
transfers while retaining the browser-side cartridge and edits.

## Install or update

1. Export work to keep from the instrument's current firmware. Other apps'
   patches are not migrated into SMSGGDJ.
2. Under **Firmware**, choose the project's local `.fwsc` package. It checks
   the model/identity, package header, file bounds, checksums and update loader.
3. Click **Install selected firmware** and confirm. On a connected SMSGGDJ,
   the checked backup option first downloads its saved 32 KiB SRAM.
4. Leave USB/power connected and the browser open until it finishes. The page
   checks the identity after restart and reconnects to the song manager.

Versioned builds show their version. Development builds show **Development
build** and their device identity; that identity alone does not identify a
particular source commit. Build from a known source revision when testing.

**M-VAVE Open firmware needs a stock V15 restore first.** The page explains this
under Help & recovery. Its stock-file option accepts only the exact verified
V15 checksum, then the same page can install SMSGGDJ. Do not use an arbitrary
file or bypass the checks.

## Back up and manage songs

1. Save your working song through the tracker's FILES menu and stop playback.
2. Click **Read from FM1**, then **Download SRAM backup**.
3. Export individual songs, import songs, rename or reorder the browser copy.
4. Download the edited SRAM to keep a file, or choose **Send SRAM & restart**
   to apply it to the FM1. The page confirms replacement and verifies read-back.
5. Use FILES → LOAD on the FM1 to load a saved song.

Only songs saved by the ROM are in SRAM. Device writes restart the tracker and
lose unsaved working edits. Reading or editing browser files alone does not
change the device.

## Controls

The page has a collapsible controls guide. Music keys are numbered from zero:
key 0 Left; keys 1 and 3 Up; key 2 Down; key 4 Right. Other keys enter notes in
PHRASE and advance one step. PLAY skips forward, EDIT goes back, and LFO clears
the current step without moving. Hold REC and tap GLO for play/stop.

## Local Mac copy

Download **a Mac copy** from the hosted page, unzip it, and open
`Open-Manager.command`. This optional launcher requires Python 3 only and opens
a local page. Keep its Terminal window open while using it. If macOS will not
open the downloaded command directly, open Terminal in the extracted folder
and run `bash Open-Manager.command` after checking the download's source.

If Python 3 is unavailable, use the hosted page. There are no extra Python
packages or development tools needed for the local browser tools.

From a source checkout, `./Manager-GGDJ.command` starts the same source app
without compiling the emulator or loading SDK/toolchain settings. If port 8765
is occupied, it chooses the next free local port and prints the actual URL.

## If something goes wrong

- Check the cable, MIDI/SysEx permission, browser and selected ports. Close
  another updater that may be using the same MIDI port.
- If an update is interrupted, retain the **same firmware file**. Reconnect,
  select it again and install to finish the loader's update, then verify restart.
- To return to stock, follow **Help & recovery** on the page. Export saved work
  first; stock restoration can erase it.
- If the FM1 does not start or answer at all, use the linked platform recovery
  instructions. That hardware recovery path has not been exercised for this port.
- On current SMSGGDJ firmware, **Download performance report** records the
  identity, browser and counters. It includes no songs and downloads locally.
  Include the report and what you were doing when reporting a problem.

The page and Mac copy include the browser manager/updater source, not the
Game Gear emulator, ROM or an FM1 firmware image. Original browser code is MIT;
upstream browser updater modules retain MPL-2.0 and their credits. See
[THIRD_PARTY.md](THIRD_PARTY.md).
