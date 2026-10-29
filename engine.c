/* SPDX-License-Identifier: MIT
 * FM1 adapter for the existing Waveshare SMS Plus port. Only this translation
 * unit owns emulation. UI supplies a bounded SPSC event queue and held pad bits.
 */
#include <stdint.h>
#include <stddef.h>
#include "compat.h"
#include "plat.h"
#include "gg.h"
#include "save.h"
#include "vendor/smsplus/shared.h"
#include "rom_data.h"

#define ARENA_BYTES (120u * 1024u)
#define QUEUE_SIZE 64u
static uint8_t arena[ARENA_BYTES] PLAT_POOL __attribute__((aligned(8)));
static unsigned arena_at;
static int initialised;
static volatile uint32_t fault;
static uint8_t pictures[2][256u * 192u] PLAT_POOL;
static uint16_t picture_palette[2][256]; /* core expands all 8 alias palettes */
static volatile unsigned front;
static unsigned back;
static volatile uint32_t frames, dropped;
static volatile uint8_t requested_pad, paused;
static uint8_t previous_pad, repeat_timer;
typedef struct { uint8_t kind, midi; } gg_event;
static gg_event events[QUEUE_SIZE];
static volatile unsigned event_write, event_read;
static int advance_pending;
static unsigned consumed_audio;
static int frame_complete;
static float dc_x[2], dc_y[2];
static gg_profile active_profile;
static const uint8_t *selected_rom;
static uint32_t selected_size;
static uint8_t boot_ready;

/* Single core main-loop/ISR publication. Volatile publishes indices; the
 * compiler barrier keeps payload copies before the index on pi32v2 and host. */
#define GG_PUBLISH() __atomic_signal_fence(__ATOMIC_SEQ_CST)

void *fmgg_malloc(size_t n)
{
    unsigned a = (arena_at + 7u) & ~7u;
    if (n > ARENA_BYTES - a) { fault = 1; return 0; }
    arena_at = a + (unsigned)n;
    return arena + a;
}
void *fmgg_calloc(size_t n, size_t size)
{
    void *p;
    if (size && n > ARENA_BYTES / size) { fault = 1; return 0; }
    p = fmgg_malloc(n * size);
    if (p) memset(p, 0, n * size);
    return p;
}
void fmgg_free(void *p) { (void)p; } /* boot-lifetime arena */
void fmgg_fault(void) { fault = 1; }

static uint8_t *ram_at(unsigned a) { return sms.wram + (a & 0x1fffu); }
#define GA(name) (active_profile.address[GG_A_##name])
#define R(name) (*ram_at(GA(name)))

static void dirty_grid(void)
{
    unsigned i;
    for (i = 0; i < 16; ++i) ram_at(GA(DIRTY_ROWS))[i] = 1;
}

void gg_set_pad(uint8_t mask) { requested_pad = mask & 63u; }
int gg_enqueue(unsigned action, unsigned midi)
{
    unsigned w = event_write, next = (w + 1u) & (QUEUE_SIZE - 1u);
    if (action > GG_CLEAR || (action == GG_NOTE && (midi < active_profile.midi_low || midi > active_profile.midi_high))) return 0;
    if (next == event_read) { ++dropped; return 0; }
    events[w].kind = (uint8_t)action;
    events[w].midi = (uint8_t)midi;
    GG_PUBLISH(); event_write = next;
    return 1;
}

/* Called at two pinned PC locations, before fetching an unchanged ROM opcode.
 * Navigation is injected AFTER read_input(), entirely through work RAM. Note
 * audition runs the ROM's normal insert handler; advancing waits until that
 * handler has returned. No injected opcodes, registers, stack or PSG writes.
 */
void fmgg_instruction(uint16_t pc)
{
    if (pc == fmgg_engine_pc) {
        if (advance_pending) {
            R(PHR_ROW) = (R(PHR_ROW) + 1u) & 15u;
            advance_pending = 0;
            dirty_grid();
        }
        return;
    }
    if (pc == fmgg_editor_pc) {
        boot_ready=1;
        uint8_t raw = requested_pad, edge = raw & (uint8_t)~previous_pad;
        uint8_t repeat = edge;
        R(PAD_PREV) = previous_pad;
        previous_pad = raw;
        if (!(raw & 15u)) repeat_timer = 0;
        else if (edge & 15u) repeat_timer = R(KEY_DELAY);
        else if (!repeat_timer || !--repeat_timer) {
            repeat |= raw & 15u;
            repeat_timer = R(KEY_SPEED);
        }
        R(PAD_RAW) = raw; R(PAD_EDGE) = edge; R(PAD_REP) = repeat;
        R(DAS_TIMER) = repeat_timer;
        if (event_read != event_write) {
            unsigned r = event_read;
            gg_event ev = events[r];
            GG_PUBLISH(); event_read = (r + 1u) & (QUEUE_SIZE - 1u);
            /* Never leave a queued key waiting to edit a later screen. */
            if (R(SCR_MODE) != 2 || R(SEL_ACTIVE) || raw || R(PHR_ROW) > 15 || R(CUR_PHRASE) >= active_profile.phrases) return;
            if (ev.kind == GG_NOTE) {
                uint8_t *step = ram_at(GA(PHRASE_POOL) + R(CUR_PHRASE) * 64u + R(PHR_ROW) * 4u);
                uint8_t note = ev.midi - active_profile.midi_low + 1u;
                step[0] = note;
                if (step[1] >= active_profile.instruments) step[1] = R(LAST_INSTR) < active_profile.instruments ? R(LAST_INSTR) : 0;
                R(LAST_NOTE) = note;
                R(LAST_INSTR) = step[1];
                R(PHR_COL) = 0;
                R(SONG_EDITED) = 1;
                R(DT1_TIMER) = 0; R(TP_DT) = 0;
                R(PAD_RAW) = R(PAD_EDGE) = 16; /* normal insert/audition */
                R(PAD_REP) = 0;
                advance_pending = 1;
            } else if (ev.kind == GG_CLEAR) {
                /* Original ROM empty-row format; no row shifting or audition. */
                uint8_t *step = ram_at(GA(PHRASE_POOL) + R(CUR_PHRASE) * 64u + R(PHR_ROW) * 4u);
                step[0] = 0; step[1] = 255; step[2] = step[3] = 0;
                R(SONG_EDITED) = 1;
                R(DT1_TIMER) = 0; R(TP_DT) = 0;
            } else {
                R(PHR_ROW) = (R(PHR_ROW) + (ev.kind == GG_FORWARD ? 1u : 15u)) & 15u;
            }
            dirty_grid();
        }
    }
}

int gg_init(void)
{
    if (!selected_rom) {
        selected_rom=fmgg_rom;selected_size=sizeof fmgg_rom;
        active_profile=*gg_builtin_profile();
    }
    fmgg_editor_pc=GA(EDITOR_INPUT);fmgg_engine_pc=GA(ENGINE_FRAME);
    boot_ready=0;
    if (arena_at) {
        if (!initialised) return 0;
        /* Host reboots reuse allocations, as the inherited core expects. */
        front = 0; back = 1; bitmap.data = pictures[back];
        memset(pictures, 0, sizeof pictures);
        memset(picture_palette, 0, sizeof picture_palette);
        memset(cart.sram, 0, GG_SRAM_BYTES);
        cart.rom=(uint8_t *)selected_rom;cart.size=selected_size;cart.pages=selected_size/16384u;
        system_reset();
        frames = dropped = fault = 0;
        event_write = event_read = 0;
        requested_pad = previous_pad = repeat_timer = 0;
        advance_pending = frame_complete = consumed_audio = 0;
        memset(dc_x, 0, sizeof dc_x); memset(dc_y, 0, sizeof dc_y);
        return 1;
    }
    system_reset_config();
    option.overscan = 0; option.sndrate = GG_RATE;
    cart.rom = (uint8_t *)selected_rom;
    cart.size = selected_size; cart.pages = selected_size / 0x4000u;
    cart.mapper = MAPPER_SEGA; cart.loaded = 1;
    cart.sram = fmgg_calloc(1, GG_SRAM_BYTES);
    sms.console = CONSOLE_GG; sms.territory = TERRITORY_EXPORT;
    sms.display = DISPLAY_NTSC; sms.device[0] = sms.device[1] = DEVICE_PAD2B;
    sms.use_fm = 0; bios.enabled = 0;
    bitmap.width = 256; bitmap.height = 192; bitmap.pitch = 256;
    back = 1; bitmap.data = pictures[back];
    system_poweron(); sound_set_write_sync(1);
    initialised = !fault;
    return !fault;
}

void gg_render(int32_t *lr, uint32_t n, uint32_t gain)
{
    unsigned i = 0, guard = 0;
    if (paused || fault) { memset(lr, 0, n * 2u * sizeof *lr); return; }
    while (i < n && guard++ < n * 4u + 32u) {
        while (consumed_audio >= (unsigned)snd.done_so_far) {
            if (frame_complete) { consumed_audio = 0; frame_complete = 0; }
            if (system_step_line(0)) {
                /* This frame's final samples must be consumed before the next
                 * sound_begin_frame resets its stream indices. */
                memcpy(picture_palette[back], picture_palette[front], sizeof picture_palette[0]);
                render_copy_palette(picture_palette[back]);
                GG_PUBLISH();
                front = back;
                back ^= 1u;
                bitmap.data = pictures[back];
                ++frames;
                frame_complete = 1;
            }
            if (fault) break;
            if (consumed_audio < (unsigned)snd.done_so_far) break;
        }
        if (fault) break;
        while (i < n && consumed_audio < (unsigned)snd.done_so_far) {
            unsigned ch;
            for (ch = 0; ch < 2; ++ch) {
                float x = (float)snd.stream[ch][consumed_audio] * 5.0f;
                float y = x - dc_x[ch] + 0.995f * dc_y[ch];
                int32_t sample;
                dc_x[ch] = x; dc_y[ch] = y;
                sample = (int32_t)(y * 256.0f * ((float)gain / 4096.0f));
                if (sample > 8388607) sample = 8388607;
                if (sample < -8388608) sample = -8388608;
                lr[2u * i + ch] = sample;
            }
            ++i; ++consumed_audio;
        }
    }
    if (i < n) memset(lr + 2u*i, 0, (n-i)*2u*sizeof *lr);
}

const uint8_t *gg_picture(void) { return pictures[front]; }
const uint16_t *gg_palette(void) { return picture_palette[front]; }
uint32_t gg_frames(void) { return frames; }
uint32_t gg_dropped(void) { return dropped; }
unsigned gg_arena_used(void) { return arena_at; }
int gg_faulted(void) { return fault != 0; }
int gg_screen(void) { return sms.wram ? R(SCR_MODE) : -1; }
int gg_row(void) { return sms.wram ? R(PHR_ROW) : -1; }
int gg_playing(void) { return sms.wram && R(PLAY_STATE); }
uint8_t *gg_sram(void) { return cart.sram; }
uint8_t *gg_ram(void) { return sms.wram; }
void gg_hold(int on) { paused = on != 0; }
void gg_unhold(void) { paused = 0; }
const gg_profile *gg_current_profile(void) { return &active_profile; }
const uint8_t *gg_rom_data(void) { return selected_rom; }
int gg_boot_ready(void) { return boot_ready; }
int gg_use_rom(const uint8_t *data,uint32_t n,const gg_profile *p)
{
    if (!p) { data=fmgg_rom;n=sizeof fmgg_rom;p=gg_builtin_profile(); }
    if (!data || n!=p->rom_size || !gg_profile_valid(p)
        || memcmp(data+0x7ff0,"TMR SEGA",8) || (data[0x7fff]>>4)<5 || (data[0x7fff]>>4)>7
        || gg_crc32(data,n)!=p->rom_crc || gg_crc32(data,32768)!=p->code_crc) return 0;
    gg_hold(1);selected_rom=data;selected_size=n;active_profile=*p;
    return gg_init(); /* remains held until the caller restores cartridge SRAM */
}
