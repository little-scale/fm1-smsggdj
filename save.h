/* SPDX-License-Identifier: MIT */
#pragma once
#include <stdint.h>
int gg_save_load(uint8_t *sram);
int gg_save_write(const uint8_t *sram);
uint32_t gg_crc32(const void *data, uint32_t n);
uint32_t gg_save_generation(void);
