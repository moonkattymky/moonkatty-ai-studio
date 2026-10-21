#!/usr/bin/env python3
"""One Edge neural voice. Prints JSON timing. Does not use a paid key."""
import asyncio, json, sys, time
import edge_tts

text, voice, out = sys.argv[1], sys.argv[2], sys.argv[3]
async def main():
    t0 = time.perf_counter()
    comm = edge_tts.Communicate(text, voice, rate="+0%")
    await comm.save(out)
    dt = time.perf_counter() - t0
    print(json.dumps({"voice": voice, "out": out, "genSec": round(dt, 3), "rate": "+0%"}))

asyncio.run(main())
