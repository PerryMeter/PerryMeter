"""Check that a RadarPing WebSocket stream is reachable and print a few messages.

Usage (from any computer on the same network as the Pi):
    python ws_check.py ws://<pi-ip>:8766        radar stream
    python ws_check.py ws://<pi-ip>:8765        CSI stream
    python ws_check.py ws://<pi-ip>:8766 20     print 20 messages instead of 5

Needs: pip install websockets
"""
import asyncio
import sys

from websockets.asyncio.client import connect


async def main(url, count):
    print(f"Connecting to {url} ...")
    async with connect(url, open_timeout=5) as ws:
        print("Connected. Waiting for messages (none for 5 s = server running but sending nothing).")
        for _ in range(count):
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            print(msg)
    print("OK: the stream is reachable and sending data.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    try:
        asyncio.run(main(sys.argv[1], n))
    except asyncio.TimeoutError:
        print("Timed out: connected, but no message arrived in 5 s (is the sensor sending data?).")
    except OSError as e:
        print(f"Could not connect: {e}")
        print("Check the Pi's IP (hostname -I on the Pi), that the server is running, and that "
              "both machines are on the same hotspot.")
