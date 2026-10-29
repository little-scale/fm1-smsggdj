/* SPDX-License-Identifier: MIT */
#pragma once
/* The device is freestanding. These three routines are supplied by
 * felucca-bsp/chip/libc.c in the platform unity unit; no hosted libc is linked.
 * Keep their unsigned byte-count ABI identical to the platform definitions. */
#ifdef PLAT_HOST
#include <string.h>
#else
void *memcpy(void *dest, const void *source, unsigned bytes);
void *memset(void *dest, int value, unsigned bytes);
int memcmp(const void *left, const void *right, unsigned bytes);
#endif
