# Z80 V3.9 permission history

The working CPU implementation is retained. Only its licensing comments have
changed. The old non-commercial notice is superseded for the underlying MAME
Z80 V3.9 code by its published BSD-3-Clause release and, for the shared SMS Plus
GX changes, by Eke-Eke's public agreement to BSD relicensing.

This does **not** make the complete SMS Plus emulator or firmware MIT or BSD.
Retro-Go's adaptations remain GPL-covered. We distribute the combined CPU
file under GPL-2.0 and retain the underlying BSD notices in
[cpu/LICENSE.BSD-3-Clause](smsplus/cpu/LICENSE.BSD-3-Clause).

## Primary evidence

1. **Original upstream:** our imported source is pinned to Retro-Go
   [`4ced120669750ca7228fd0414211430c1d923166`](https://github.com/ducalex/retro-go/blob/4ced120669750ca7228fd0414211430c1d923166/retro-core/components/smsplus/cpu/z80.c).
   It identifies Portable Z80 Emulator V3.9 and lists Eke-Eke's SMS Plus GX
   changes. Its original SHA-256 is recorded in `vendor/provenance.json`.

2. **MAME's actual relicensing commit, 7 May 2015:**
   [`31abc855dbcd0747092136b4fd91ab9824c9f208`](https://github.com/mamedev/mame/commit/31abc855dbcd0747092136b4fd91ab9824c9f208).
   The `src/emu/cpu/z80/z80.c` change explicitly removes the old non-commercial
   notice and replaces it with BSD-3-Clause and Juergen Buchmueller's credit.
   This is the V3.9 lineage, not merely a similarly named modern replacement.

3. **Original-author confirmation, 9 January 2017:**
   [Juergen Buchmueller's response in MAME #1948](https://github.com/mamedev/mame/issues/1948#issuecomment-271440403).
   He acknowledges the contributed Z80 core and accepts its use in the BSD
   project discussed there. A MAME maintainer subsequently supplies the
   [BSD copyright and notice text](https://github.com/mamedev/mame/issues/1948#issuecomment-271483183).

4. **The same legacy-fork issue was reviewed in 2025:**
   [EmulTwo #2](https://github.com/alekmaul/emultwo/issues/2).
   Z80 contributor happppp identifies the old V3.9/non-commercial header,
   links the exact 2015 MAME commit, and identifies Eke-Eke's later changes as
   requiring separate agreement. This discussion is supporting provenance;
   the permission itself comes from the copyright holder's response below.

5. **Eke-Eke's public agreement, 1 December 2025:**
   [comment 3595854583](https://github.com/alekmaul/emultwo/issues/2#issuecomment-3595854583):

   > Yes, i confirm I have no problem with the relicensing of my z80.c changes

   The immediately preceding question specifies BSD3. We rely on this for
   the shared Eke-Eke Z80 changes, not for unrelated Genesis Plus GX code.

6. **Published implementation of that correction:** EmulTwo's
   [`35435644109ba90c13e5fc15007904edddc7503f`](https://github.com/alekmaul/emultwo/blob/35435644109ba90c13e5fc15007904edddc7503f/src/z80/z80.c)
   retains the V3.9 and Eke-Eke change history and includes the full BSD3
   notice. Its code is a related fork; it is **not** byte-identical to ours
   and has not been substituted into the FM1 firmware.

The URLs, source hashes, relevant permission statement and original-author
identity are recorded in [permissions.json](../evidence/licensing/permissions.json).
This repository has not obtained a new private permission or contacted these
authors during this audit.

## Scope and retained obligations

- Buchmueller/MAME Z80 V3.9 and the shared Eke-Eke CPU changes: BSD-3-Clause,
  with the retained credits and full notice.
- Retro-Go adaptations: GPL-2.0, following its pinned project-wide
  [licensing statement](https://github.com/ducalex/retro-go/blob/4ced120669750ca7228fd0414211430c1d923166/README.md#license).
  We do not assume its adaptations received Eke-Eke's BSD permission.
- Original FM1 changes retain the project's MIT grant. Combining those
  changes with the GPL-covered adaptations permits distribution of this
  combined file under GPL-2.0; it does not make every portion exclusively GPL.
- Other SMS Plus files keep their own notices. Neither the MAME commit nor
  Eke-Eke's Z80 agreement relicenses the PSG, renderer, or other components.
- The platform keeps MPL-2.0. Section 3.3 permits the applicable additional
  GPL terms when it forms a larger work with GPL code; the original MPL
  source and notices must also be supplied. No platform source notice has
  been rewritten.
- The independently authored SMSGGDJ ROM retains MIT and remains unchanged.

The old header is retained as removed text in `vendor/licensing.patch` for
history. It is not an additional restriction on the BSD-licensed portions.

## Keeping the tested implementation

The reference firmware is the user's tested development package `FM-1_9500`,
610,136 bytes, SHA-256:

`240b88be9ba051440854016dc925f1c9e4d4967fe55d4163d23491e665e794e6`.

The audit retains that exact file locally without rebuilding or flashing it.
Before/after host compilations of `z80.c`, with identical options and input
filename, produce identical 48,136-byte objects, SHA-256:

`68dcc293170167048373ed42ff8664fd5534785aa61ab59f7d9c2a2d3b510b51`.

This is a host object comparison, not a claim of a fresh pi32v2 rebuild.
Source and ROM preservation are checked separately in
`evidence/licensing/preservation.json`.

`tools/import_core.py` reapplies `vendor/licensing.patch` after
`vendor/performance.patch`, so importing the original core again preserves
the corrected notices without changing its execution code.
