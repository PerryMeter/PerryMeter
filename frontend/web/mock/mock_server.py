import argparse
import asyncio
import json
import math
import random
import time
from websockets.asyncio.server import serve

clients = set()


def compute_confidence(strength: float) -> float:
    base = 0.55 + 0.45 * min(1.0, abs(strength - 0.30) / 0.30)
    noise = random.uniform(-0.03, 0.03)
    return max(0.0, min(1.0, base + noise))


async def broadcast_loop(rate: float, scenario: str):
    dt = 1.0 / rate

    # Signal state
    strength = 0.06
    motion = False

    # Movement episode state (for mixed and chaos)
    in_episode = False
    episode_elapsed = 0.0
    episode_duration = 5.0
    episode_peak = 0.75
    episode_start_strength = 0.06
    time_until_next_episode = random.uniform(8.0, 20.0)

    # Chaos timer
    time_until_chaos = 10.0

    while True:
        await asyncio.sleep(dt)

        if scenario == "idle":
            delta = random.uniform(-0.02, 0.02) + (0.06 - strength) * 0.1
            strength = max(0.02, min(0.16, strength + delta))
            motion = False

        elif scenario == "walk":
            # Continuous movement, strength 0.5 to 0.95
            t = time.time()
            base = 0.72 + 0.15 * math.sin(2.0 * math.pi * 0.5 * t)
            wobble = 0.08 * math.sin(2.0 * math.pi * 1.7 * t) + random.uniform(-0.02, 0.02)
            strength = max(0.50, min(0.95, base + wobble))
            motion = True

        elif scenario in ("mixed", "chaos"):
            if not in_episode:
                time_until_next_episode -= dt
                if time_until_next_episode <= 0.0:
                    in_episode = True
                    episode_elapsed = 0.0
                    episode_duration = random.uniform(3.0, 8.0)
                    episode_peak = random.uniform(0.55, 0.95)
                    episode_start_strength = strength
                else:
                    delta = random.uniform(-0.02, 0.02) + (0.06 - strength) * 0.1
                    strength = max(0.02, min(0.16, strength + delta))

            if in_episode:
                episode_elapsed += dt
                rise_duration = 0.8
                fall_duration = 1.2

                if episode_elapsed < rise_duration:
                    progress = episode_elapsed / rise_duration
                    base_strength = episode_start_strength + (episode_peak - episode_start_strength) * progress
                elif episode_elapsed > episode_duration - fall_duration:
                    remaining = max(0.0, episode_duration - episode_elapsed)
                    progress = remaining / fall_duration
                    base_strength = 0.06 + (episode_peak - 0.06) * progress
                else:
                    base_strength = episode_peak

                wobble = 0.08 * math.sin(2.0 * math.pi * 1.7 * episode_elapsed) + random.uniform(-0.02, 0.02)
                strength = max(0.0, min(1.0, base_strength + wobble))

                if episode_elapsed >= episode_duration:
                    in_episode = False
                    time_until_next_episode = random.uniform(8.0, 20.0)

            # Motion hysteresis
            if strength > 0.35:
                motion = True
            elif strength < 0.25:
                motion = False

        confidence = compute_confidence(strength)

        # Check if chaos event triggers
        if scenario == "chaos":
            time_until_chaos -= dt
            if time_until_chaos <= 0.0:
                time_until_chaos = 10.0
                chaos_type = random.randint(1, 7)

                if chaos_type == 1:
                    # Malformed JSON
                    message_str = '{"motion": tru'
                elif chaos_type == 2:
                    # Missing strength
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "confidence": round(confidence, 3),
                    })
                elif chaos_type == 3:
                    # strength: 1.7
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "strength": 1.7,
                        "confidence": round(confidence, 3),
                    })
                elif chaos_type == 4:
                    # confidence: -0.2
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "strength": round(strength, 3),
                        "confidence": -0.2,
                    })
                elif chaos_type == 5:
                    # extra unknown fields
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "strength": round(strength, 3),
                        "confidence": round(confidence, 3),
                        "extra_field": "debug_data",
                        "raw_rssi": -42,
                    })
                elif chaos_type == 6:
                    # array of two valid messages
                    now = time.time()
                    message_str = json.dumps([
                        {
                            "t": now,
                            "motion": motion,
                            "strength": round(strength, 3),
                            "confidence": round(confidence, 3),
                        },
                        {
                            "t": now + 0.05,
                            "motion": motion,
                            "strength": round(strength, 3),
                            "confidence": round(confidence, 3),
                        },
                    ])
                else:
                    # silent for 5 s
                    await asyncio.sleep(5.0)
                    continue

                if clients:
                    for client in list(clients):
                        try:
                            await client.send(message_str)
                        except Exception:
                            clients.discard(client)
                continue

        # Standard message
        payload = {
            "t": time.time(),
            "motion": motion,
            "strength": round(strength, 3),
            "confidence": round(confidence, 3),
        }
        message_str = json.dumps(payload)

        if clients:
            for client in list(clients):
                try:
                    await client.send(message_str)
                except Exception:
                    clients.discard(client)


async def handler(websocket):
    clients.add(websocket)
    remote = getattr(websocket, "remote_address", "client")
    print(f"Client connected: {remote}", flush=True)
    try:
        await websocket.wait_closed()
    finally:
        clients.discard(websocket)
        print(f"Client disconnected: {remote}", flush=True)


async def main():
    parser = argparse.ArgumentParser(description="RadarPing Mock WebSocket Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to listen on")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on")
    parser.add_argument("--rate", type=float, default=10.0, help="Message rate in Hz")
    parser.add_argument(
        "--scenario",
        choices=["mixed", "idle", "walk", "chaos"],
        default="mixed",
        help="Simulation scenario",
    )
    args = parser.parse_args()

    asyncio.create_task(broadcast_loop(args.rate, args.scenario))

    async with serve(handler, args.host, args.port):
        print(f"Mock server listening on ws://{args.host}:{args.port} (scenario: {args.scenario}, rate: {args.rate} Hz)", flush=True)
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
