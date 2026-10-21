#!/usr/bin/env python3
"""Print cputype and LC_BUILD_VERSION minos/sdk of a Mach-O binary (verifies the real minimum macOS of bin/node)."""
import struct, sys
d = open(sys.argv[1], 'rb').read(1 << 16)
magic, cpu, _, _, ncmds, _, _ = struct.unpack_from('<IiiIIII', d, 0)
assert magic == 0xfeedfacf, 'not a 64-bit Mach-O'
arch = {0x01000007: 'x86_64', 0x0100000c: 'arm64'}.get(cpu, hex(cpu)); off = 32; v = lambda x: f"{x >> 16}.{(x >> 8) & 255}.{x & 255}"
for _ in range(ncmds):
    cmd, size = struct.unpack_from('<II', d, off)
    if cmd == 0x32: _, minos, sdk = struct.unpack_from('<III', d, off + 8); print(arch, 'minos', v(minos), 'sdk', v(sdk)); break
    if cmd == 0x24: minos, sdk = struct.unpack_from('<II', d, off + 8); print(arch, 'minos', v(minos), 'sdk', v(sdk)); break
    off += size
