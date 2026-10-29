/* SPDX-License-Identifier: MIT
 * Cartridge SRAM journal: two independent 36 KiB banks. Erase inactive bank,
 * write and read-verify data, then commit its CRC-protected header LAST.
 * No writes to an active bank. Header/data failure leaves the older bank valid.
 */
#include <stdint.h>
#include <string.h>
#include "plat.h"
#include "gg.h"
#include "save.h"

#define SAVE0 0x98000u
#define SAVE1 0xA1000u
#define BANK_BYTES 0x9000u
#define DATA_OFFSET 256u
#define SAVE_MAGIC 0x31474753u
typedef struct { uint32_t magic, generation, size, data_crc, header_crc; } gg_save_header;
static uint32_t generation;
static int active_bank = -1;

uint32_t gg_crc32(const void *data, uint32_t n)
{
    const uint8_t *p = data;
    uint32_t c = 0xffffffffu, k;
    while (n--) {
        c ^= *p++;
        for (k = 0; k < 8; ++k) c = (c >> 1) ^ (0xedb88320u & (0u - (c & 1u)));
    }
    return ~c;
}
static int valid(uint32_t off, gg_save_header *h)
{
    const uint8_t *p = plat_data(off);
    if (!p) return 0;
    memcpy(h, p, sizeof *h);
    return h->magic == SAVE_MAGIC && h->size == GG_SRAM_BYTES
        && h->header_crc == gg_crc32(h, 16)
        && h->data_crc == gg_crc32(p + DATA_OFFSET, GG_SRAM_BYTES);
}
int gg_save_load(uint8_t *sram)
{
    gg_save_header a, b;
    int va = valid(SAVE0, &a), vb = valid(SAVE1, &b);
    active_bank = -1; generation = 0;
    if (!va && !vb) return 0;
    active_bank = vb && (!va || (int32_t)(b.generation - a.generation) > 0) ? 1 : 0;
    generation = active_bank ? b.generation : a.generation;
    memcpy(sram, plat_data(active_bank ? SAVE1 : SAVE0) + DATA_OFFSET, GG_SRAM_BYTES);
    return 1;
}
int gg_save_write(const uint8_t *sram)
{
    unsigned bank = active_bank == 0 ? 1 : 0;
    uint32_t off = bank ? SAVE1 : SAVE0, i;
    gg_save_header h;
    for (i = 0; i < BANK_BYTES; i += 4096u)
        if (plat_data_erase(off + i)) return -1;
    for (i = 0; i < GG_SRAM_BYTES; i += 256u)
        if (plat_data_write(off + DATA_OFFSET + i, sram + i, 256u)) return -1;
    h.magic = SAVE_MAGIC; h.generation = generation + 1u; h.size = GG_SRAM_BYTES;
    h.data_crc = gg_crc32(sram, GG_SRAM_BYTES); h.header_crc = gg_crc32(&h, 16);
    if (!plat_data(off) || gg_crc32(plat_data(off) + DATA_OFFSET, GG_SRAM_BYTES) != h.data_crc) return -1;
    if (plat_data_write(off, &h, sizeof h)) return -1;
    if (!valid(off, &h)) return -1;
    active_bank = bank; generation = h.generation;
    return 0;
}
uint32_t gg_save_generation(void) { return generation; }
