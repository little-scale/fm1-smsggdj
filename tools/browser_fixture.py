#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Generate a synthetic package for browser tests. It is never installed."""
import struct
import sys
from paths import BASE
sys.path.insert(0,str(BASE/'tools'))
import fm1pkg_make as package
mode=sys.argv[1] if len(sys.argv)>1 else 'valid'
product='FM-1_95010000'
if mode=='other':product='FM-1_1200'
if mode=='stock':product='FM-1_015'
loader=b'not-machine-code-for-tests\0'+(b'FELUCCA-LOADER-1' if mode!='no-loader' else b'no-loader-marker')+bytes(128)
raw=package.ufw(bytes([0xa5])*0x93000,loader,product)
if mode=='overlap':
    # Change the encrypted second entry to overlap the first, keeping the
    # independent packer's list/header checksums valid.
    sys.path.insert(0,str(BASE/'tools'))
    import fm1_install
    image=bytearray(fm1_install.logical_image(raw))
    entry=bytearray(image[144:224]);package.enc(entry,0,len(entry))
    struct.pack_into('<I',entry,8,1024)
    package.enc(entry,0,len(entry));image[144:224]=entry
    header=bytearray(image[:64]);package.enc(header,0,64)
    struct.pack_into('<H',header,2,package.crc16(image[64:224]))
    struct.pack_into('<H',header,0,package.crc16(header[2:]))
    package.enc(header,0,64);image[:64]=header
    modified=bytearray()
    for i in range(20):modified+=image[i*47:(i+1)*47]+raw[i*48+47:i*48+48]
    raw=modified+image[940:]
sys.stdout.buffer.write(raw)
