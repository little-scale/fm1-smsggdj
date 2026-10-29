/* SPDX-License-Identifier: MIT
 * Browser-specific exports. The preview persists the same raw cartridge journal
 * as the device, independently of the platform's small settings objects.
 */
#define GG_WEB __attribute__((used, visibility("default")))
GG_WEB uint32_t gg_web_journal(void) { return (uint32_t)(uintptr_t)plat_data(0x98000u); }
GG_WEB uint32_t gg_web_journal_size(void) { return 51u * 4096u; } /* SRAM journal + ROM slot */
GG_WEB uint32_t gg_web_generation(void) { return gg_save_generation(); }
GG_WEB uint32_t gg_web_status(void)
{
    return (uint32_t)gg_screen() | ((uint32_t)gg_row()<<8)
        | ((uint32_t)gg_playing()<<16) | ((uint32_t)gg_faulted()<<17);
}
GG_WEB uint32_t gg_web_sram(void) { return (uint32_t)(uintptr_t)gg_sram(); }
GG_WEB void gg_web_reload(void)
{
    app_init();
    gg_unhold();
}
GG_WEB void gg_web_hold(void) { gg_hold(1); }
GG_WEB int gg_web_import(void)
{
    if (gg_playing()) return 0;
    seen_crc = gg_crc32(gg_sram(), GG_SRAM_BYTES);
    changed_at = plat_ms(); save_failed = 0;
    return 1;
}
GG_WEB uint32_t gg_web_revision(void) { return gg_manager_revision(); }
GG_WEB int gg_web_busy(void) { return gg_manager_busy(); }
GG_WEB int gg_web_first_note(void) { return gg_ram()[gg_current_profile()->address[GG_A_PHRASE_POOL]&8191u]; }
static uint8_t gg_web_request[512],gg_web_answer[324];
GG_WEB uint32_t gg_web_request_ptr(void) { return (uint32_t)(uintptr_t)gg_web_request; }
GG_WEB uint32_t gg_web_answer_ptr(void) { return (uint32_t)(uintptr_t)gg_web_answer; }
GG_WEB uint32_t gg_web_request_run(uint32_t n)
{
    return n>264?0:gg_manager_packet(gg_web_request,n,gg_web_answer,sizeof gg_web_answer);
}
GG_WEB uint32_t gg_web_usb_run(uint32_t n) { return n>sizeof gg_web_request?0:gg_manager_usb(gg_web_request,n,gg_web_answer,sizeof gg_web_answer); }
