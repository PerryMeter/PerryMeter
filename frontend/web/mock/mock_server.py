import argparse
import asyncio
import json
import math
import random
import time
from websockets.asyncio.server import broadcast, serve

clients = set()


def compute_confidence(strength: float) -> float:
    base = 0.55 + 0.45 * min(1.0, abs(strength - 0.30) / 0.30)
    noise = random.uniform(-0.03, 0.03)
    return max(0.0, min(1.0, base + noise))


async def broadcast_loop(rate: float, scenario: str, legacy: bool):
    loop = asyncio.get_running_loop()
    dt = 1.0 / rate

    # Signal state
    strength = 0.06
    motion = False
    alert = "clear"
    distance_m = None

    # Zone scenario state
    zone_state = "clear"
    prev_zone_alert = "clear"
    time_until_visit = random.uniform(10.0, 20.0)
    approach_elapsed = 0.0
    approach_duration = 2.5

    # Movement episode state (for mixed, chaos, zone)
    in_episode = False
    episode_elapsed = 0.0
    episode_duration = 5.0
    episode_peak = 0.75
    episode_start_strength = 0.06
    time_until_next_episode = random.uniform(8.0, 20.0)

    # Chaos state: cycle through 7 cases in fixed order every 10 s
    time_until_chaos = 10.0
    chaos_step = 0

    next_tick = loop.time()

    while True:
        next_tick += dt
        delay = next_tick - loop.time()
        if delay > 0:
            await asyncio.sleep(delay)
        else:
            next_tick = loop.time()

        if scenario == "idle":
            delta = random.uniform(-0.02, 0.02) + (0.06 - strength) * 0.1
            strength = max(0.02, min(0.16, strength + delta))
            motion = False
            alert = "clear"
            distance_m = None

        elif scenario == "walk":
            t = time.time()
            base = 0.72 + 0.15 * math.sin(2.0 * math.pi * 0.5 * t)
            wobble = 0.08 * math.sin(2.0 * math.pi * 1.7 * t) + random.uniform(-0.02, 0.02)
            strength = max(0.50, min(0.95, base + wobble))
            motion = True
            alert = "inside"
            distance_m = None

        elif scenario == "zone":
            if zone_state == "clear":
                alert = "clear"
                distance_m = None
                motion = False
                delta = random.uniform(-0.02, 0.02) + (0.06 - strength) * 0.1
                strength = max(0.02, min(0.16, strength + delta))

                time_until_visit -= dt
                if time_until_visit <= 0.0:
                    zone_state = "approach"
                    approach_elapsed = 0.0
                    approach_duration = random.uniform(2.0, 3.0)
                    alert = "approach"
                    distance_m = 5.5

            elif zone_state == "approach":
                approach_elapsed += dt
                alert = "approach"
                motion = False
                delta = random.uniform(-0.02, 0.02) + (0.06 - strength) * 0.1
                strength = max(0.02, min(0.16, strength + delta))

                progress = min(1.0, approach_elapsed / approach_duration)
                linear_dist = 5.5 - (5.5 - 1.0) * progress
                noise = random.uniform(-0.1, 0.1)
                distance_m = round(max(0.0, min(20.0, linear_dist + noise)), 1)

                if approach_elapsed >= approach_duration:
                    zone_state = "inside"
                    in_episode = True
                    episode_elapsed = 0.0
                    episode_duration = random.uniform(3.0, 8.0)
                    episode_peak = random.uniform(0.55, 0.95)
                    episode_start_strength = strength
                    distance_m = None

            elif zone_state == "inside":
                episode_elapsed += dt
                distance_m = None
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

                if strength > 0.35:
                    motion = True
                elif strength < 0.25:
                    motion = False

                alert = "inside" if motion else "clear"

                if episode_elapsed >= episode_duration and not motion:
                    zone_state = "clear"
                    alert = "clear"
                    time_until_visit = random.uniform(10.0, 20.0)

            # Print changes in zone alert level
            if alert != prev_zone_alert:
                print(f"zone: {alert}", flush=True)
                prev_zone_alert = alert

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

        # Check if chaos event triggers (every 10s in fixed cycling order)
        if scenario == "chaos":
            time_until_chaos -= dt
            if time_until_chaos <= 0.0:
                time_until_chaos = 10.0
                case_index = chaos_step % 7
                chaos_step += 1

                if case_index == 0:
                    print("chaos: malformed JSON", flush=True)
                    message_str = '{"motion": tru'
                elif case_index == 1:
                    print("chaos: missing strength", flush=True)
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "confidence": round(confidence, 3),
                    })
                elif case_index == 2:
                    print("chaos: strength 1.7", flush=True)
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "strength": 1.7,
                        "confidence": round(confidence, 3),
                    })
                elif case_index == 3:
                    print("chaos: confidence -0.2", flush=True)
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "strength": round(strength, 3),
                        "confidence": -0.2,
                    })
                elif case_index == 4:
                    print("chaos: extra unknown fields", flush=True)
                    message_str = json.dumps({
                        "t": time.time(),
                        "motion": motion,
                        "strength": round(strength, 3),
                        "confidence": round(confidence, 3),
                        "extra_field": "debug_data",
                        "raw_rssi": -42,
                    })
                elif case_index == 5:
                    print("chaos: array of two valid messages", flush=True)
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
                    print("chaos: silent for 5 s", flush=True)
                    await asyncio.sleep(5.0)
                    next_tick = loop.time()
                    continue

                if clients:
                    broadcast(clients, message_str)
                continue

        # Standard / Legacy payload
        if legacy:
            payload = {
                "type": "detection",
                "timestamp": time.time(),
                "detected": motion,
                "motion_score": round(strength, 3),
                "confidence": round(confidence, 3),
                "source": "rx1",
            }
        elif scenario == "zone":
            payload = {
                "t": time.time(),
                "motion": motion,
                "strength": round(strength, 3),
                "confidence": round(confidence, 3),
                "alert": alert,
                "distance_m": distance_m,
            }
        else:
            payload = {
                "t": time.time(),
                "motion": motion,
                "strength": round(strength, 3),
                "confidence": round(confidence, 3),
            }

        message_str = json.dumps(payload)

        if clients:
            broadcast(clients, message_str)


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
        choices=["mixed", "idle", "walk", "chaos", "zone"],
        default="mixed",
        help="Simulation scenario",
    )
    parser.add_argument(
        "--legacy",
        action="store_true",
        help="Send Team A legacy contract format",
    )
    args = parser.parse_args()

    async with serve(handler, args.host, args.port):
        print(
            f"Mock server listening on ws://{args.host}:{args.port} (scenario: {args.scenario}, rate: {args.rate} Hz, legacy: {args.legacy})",
            flush=True,
        )
        await broadcast_loop(args.rate, args.scenario, args.legacy)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
