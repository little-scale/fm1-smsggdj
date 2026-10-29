/* SPDX-License-Identifier: MIT */
#include "gg.h"
#include "save.h"
#include "manager.h"
#include "compat.h"

static uint32_t keys_before, buttons_before, last_draw, last_poll;
static uint32_t seen_crc, saved_crc, changed_at;
static int octave, save_failed, ready, force_redraw;
static uint32_t manager_seen;
static char status[48];
static uint32_t status_until;
static uint8_t painted[144][160];
static uint16_t painted_palette[32];
static int painted_valid;

static unsigned gg_len(const char *s) { unsigned n=0; while (s[n]) ++n; return n; }
static int gg_equal(const char *a, const char *b) { while (*a && *a == *b) { ++a; ++b; } return *a == *b; }
static void gg_copy(char *d, const char *s, unsigned n)
{
    unsigned i=0; if (!n) return;
    while (s[i] && i+1u<n) { d[i]=s[i]; ++i; } d[i]=0;
}
static void gg_int(int32_t v, char *d)
{
    char t[12]; unsigned n=0, u;
    if (v<0) { *d++='-'; v=-v; } u=(unsigned)v;
    do { t[n++]=(char)('0'+u%10u); u/=10u; } while (u);
    while (n) *d++=t[--n]; *d=0;
}

void app_say(const char *a, const char *b)
{
    unsigned i = 0;
    while (a && *a && i < sizeof status - 1u) status[i++] = *a++;
    if (b && *b && i < sizeof status - 1u) status[i++] = ' ';
    while (b && *b && i < sizeof status - 1u) status[i++] = *b++;
    status[i] = 0; status_until = plat_ms() + 2000u; force_redraw = 1;
}
void app_init(void)
{
    keys_before = buttons_before = last_draw = last_poll = 0;
    octave = save_failed = painted_valid = 0; status_until = 0;
    ready = gg_manager_boot();
#ifdef PLAT_WEB
    gg_hold(1); /* browser restores its persisted flash before execution */
#endif
    manager_seen=gg_manager_revision();
    saved_crc = seen_crc = ready ? gg_crc32(gg_sram(), GG_SRAM_BYTES) : 0;
    changed_at = plat_ms();
}
void app_render(int32_t *lr, uint32_t n, uint32_t gain)
{
    if (ready) gg_render(lr, n, gain);
    else memset(lr, 0, n * 2u * sizeof *lr);
}
void app_panic(void) { gg_hold(1); }

static void controls(void)
{
    uint32_t buttons = plat_buttons(), keys = plat_keys();
    uint32_t edges = buttons & ~buttons_before, notes = keys & ~keys_before;
    const uint32_t navigation_keys = (1u << 0) | (1u << 1) | (1u << 2) | (1u << 4);
    uint8_t pad = 0;
    unsigned k;
    buttons_before = buttons; keys_before = keys;
    if(gg_manager_busy()) { gg_set_pad(0);return; }
    if ((buttons & (1u << B_SEL)) || (keys & (1u << 1))) pad |= 1;
    if ((buttons & (1u << B_SAVE)) || (keys & (1u << 2))) pad |= 2;
    if ((buttons & (1u << B_HOME)) || (keys & (1u << 0))) pad |= 4;
    if ((buttons & (1u << B_ARP)) || (keys & (1u << 4))) pad |= 8;
    if (buttons & (1u << B_GLO)) pad |= 16;
    if (buttons & (1u << B_REC)) pad |= 32;
    gg_set_pad(pad);
    if (edges & (1u << B_OCTDN)) { octave = clamp(octave - 1, -1, 6); force_redraw = 1; }
    if (edges & (1u << B_OCTUP)) { octave = clamp(octave + 1, -1, 6); force_redraw = 1; }
    if (edges & (1u << B_PLAY)) gg_enqueue(GG_FORWARD, 0);
    if (edges & (1u << B_EDIT)) gg_enqueue(GG_BACK, 0);
    if (edges & (1u << B_LFO)) gg_enqueue(GG_CLEAR, 0);
    notes &= ~navigation_keys;
    for (k = 0; k < NKEYS; ++k) if (notes & (1u << k)) {
        int note = 53 + (int)k + octave * 12;
        if (!gg_enqueue(GG_NOTE, (unsigned)note)) app_say("NOTE NOT ENTERED", "RANGE OR QUEUE");
    }
    plat_leds(buttons, keys);
    plat_play_red(gg_playing());
}

static void persist(void)
{
    uint32_t now = plat_ms(), crc;
    uint8_t *save_snapshot=gg_manager_buffer();
    if (!ready || !gg_boot_ready() || gg_manager_busy() || gg_playing() || now - last_poll < 250u) return;
    last_poll = now;
    crc = gg_crc32(gg_sram(), GG_SRAM_BYTES);
    if (crc != seen_crc) { seen_crc = crc; changed_at = now; save_failed = 0; return; }
    if (crc == saved_crc || save_failed || now - changed_at < 1000u) return;
    /* Same-core ISR cannot run between the hold and snapshot. Flash work is
     * main-loop only, and deferred until transport is stopped and SRAM quiet. */
    gg_hold(1);
    if (gg_playing()) { gg_unhold(); return; }
    memcpy(save_snapshot, gg_sram(), GG_SRAM_BYTES);
    crc = gg_crc32(save_snapshot, GG_SRAM_BYTES);
    if (crc != seen_crc) { seen_crc = crc; changed_at = now; gg_unhold(); return; }
    save_failed = gg_save_write(save_snapshot) != 0;
    if (!save_failed) saved_crc = crc;
    gg_unhold();
    app_say(save_failed ? "SAVE FAILED" : "CARTRIDGE SAVED", "");
}

static void draw(void)
{
    unsigned y, x;
    char line[48], number[12];
    const uint8_t *image = gg_picture();
    const uint16_t *palette = gg_palette();
    int palette_changed = !painted_valid || memcmp(painted_palette, palette, sizeof painted_palette);
    cv_begin(240, 12, C_BLACK);
    cv_text(2, 0, &FONT_T, "GGDJ", C_WHITE);
    gg_int(octave, number);
    gg_copy(line, "OCT ", sizeof line);
    gg_copy(line + gg_len(line), number, sizeof line - gg_len(line));
    cv_text(49, 0, &FONT_T, line, C_WHITE);
    gg_copy(line, gg_faulted() ? "FAULT " : gg_playing() ? "PLAY " : "STOP ", sizeof line);
    gg_int((int32_t)plat_cpu_pct(), number);
    gg_copy(line + gg_len(line), number, sizeof line - gg_len(line));
    gg_copy(line + gg_len(line), "% X", sizeof line - gg_len(line));
    gg_int((int32_t)plat_xruns(), number);
    gg_copy(line + gg_len(line), number, sizeof line - gg_len(line));
    cv_text(105, 0, &FONT_T, line, C_WHITE);
    cv_blit(0, 0);
    /* 160x144 -> 240x216, nearest-neighbour, original GG aspect ratio. */
    for (y = 0; y < 216; y += 12) {
        unsigned row, sy0 = y * 2u / 3u;
        int changed = palette_changed;
        if (!changed) for (row = 0; row < 8; ++row) {
            if (memcmp(painted[sy0 + row], image + (sy0 + row) * 256u + 48u, 160u)) {
                changed = 1; break;
            }
        }
        if (!changed) continue;
        cv_begin(240, 12, C_BLACK);
        for (row = 0; row < 12; ++row) {
            unsigned sy = (y + row) * 2u / 3u;
            for (x = 0; x < 240; ++x) {
                uint8_t index = image[sy * 256u + 48u + x * 2u / 3u] & 31u;
                cv_px[row * 240u + x] = swap16(palette[index]);
            }
        }
        cv_blit(0, 12 + y);
        for (row = 0; row < 8; ++row)
            memcpy(painted[sy0 + row], image + (sy0 + row) * 256u + 48u, 160u);
    }
    memcpy(painted_palette, palette, sizeof painted_palette);
    painted_valid = 1;
    cv_begin(240, 12, C_BLACK);
    if (plat_ms() < status_until) cv_text(2, 0, &FONT_T, status, C_WHITE);
    else cv_text(2, 0, &FONT_T, "LFO CLEAR   PLAY >   EDIT <", C_WHITE);
    cv_blit(0, 228);
}
void app_ui_init(void) { lcd_fill(0, 0, 240, 240, C_BLACK); painted_valid = 0; force_redraw = 1; }
void app_frame(void)
{
    gg_manager_tick(plat_ms());
    if(manager_seen!=gg_manager_revision() && gg_boot_ready()) {
        manager_seen=gg_manager_revision();
        saved_crc=seen_crc=gg_crc32(gg_sram(),GG_SRAM_BYTES);changed_at=plat_ms();save_failed=0;
        force_redraw=1;
    }
    controls(); persist();
    if (force_redraw || plat_ms() - last_draw >= 50u) {
        last_draw = plat_ms(); force_redraw = 0; draw();
    }
}
void app_input_only(void) { controls(); }
void app_redraw(void) { painted_valid = 0; force_redraw = 1; }
int app_expect(const char *what, int *got)
{
    if (gg_equal(what, "screen")) *got = gg_screen();
    else if (gg_equal(what, "row")) *got = gg_row();
    else if (gg_equal(what, "column")) *got = gg_ram() ? gg_ram()[gg_current_profile()->address[GG_A_PHR_COL] & 8191u] : -1;
    else if (gg_equal(what, "playing")) *got = gg_playing();
    else if (gg_equal(what, "fault")) *got = gg_faulted();
    else if (gg_equal(what, "dropped")) *got = (int)gg_dropped();
    else if (gg_equal(what, "octave")) *got = octave;
    else if (gg_equal(what, "generation")) *got = (int)gg_save_generation();
    else if (gg_equal(what, "note0")) *got = gg_ram() ? gg_ram()[0x100] : -1;
    else return 0;
    return 1;
}

void app_usb_cmd(const uint8_t *d,uint32_t n)
{
    uint8_t wire[324];uint32_t got=gg_manager_usb(d,n,wire,sizeof wire);
    if(got)plat_sysex_send(wire,got);
}
