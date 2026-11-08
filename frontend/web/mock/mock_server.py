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


async def broadcast_loop(
    rate: float,
    scenario: str,
    legacy: bool,
    offline: str | None = None,
    sides: str = "left,right",
):
    loop = asyncio.get_running_loop()
    dt = 1.0 / rate

    installed_sides = [s.strip() for s in sides.split(",") if s.strip()]

    # Signal state
    strength = 0.06
    motion = False
    alert = "clear"
    distance_m = None

    # Triangle scenario state
    triangle_state = "clear"
    triangle_side = "left"
    tri_phase_elapsed = 0.0
    tri_phase_duration = 0.0
    tri_peak_strength = 0.55
    fade_start_str = 0.05
    radar_motion = False
    radar_level = 0.0
    time_until_tri_visit = random.uniform(10.0, 20.0)
    left_strength = 0.05
    right_strength = 0.05
    left_motion = False
    right_motion = False
    radar_dist = None

    # Zone scenario state
    zone_state = "clear"
    prev_zone_alert = "clear"
    has_turned_inside = False
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
                    has_turned_inside = False
                    in_episode = True
                    episode_elapsed = 0.0
                    episode_duration = random.uniform(3.0, 8.0)
                    episode_peak = random.uniform(0.55, 0.95)
                    episode_start_strength = strength
                    alert = "approach"
                    if distance_m is None:
                        distance_m = 1.0

            elif zone_state == "inside":
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

                if strength > 0.35:
                    motion = True
                elif strength < 0.25:
                    motion = False

                if motion:
                    has_turned_inside = True
                    alert = "inside"
                    distance_m = None
                elif not has_turned_inside:
                    alert = "approach"
                    if distance_m is None:
                        distance_m = 1.0
                else:
                    alert = "clear"
                    distance_m = None

                if episode_elapsed >= episode_duration and not motion:
                    zone_state = "clear"
                    alert = "clear"
                    distance_m = None
                    time_until_visit = random.uniform(10.0, 20.0)

            # Print changes in zone alert level
            if alert != prev_zone_alert:
                print(f"zone: {alert}", flush=True)
                prev_zone_alert = alert

        elif scenario == "triangle":
            delta_l = random.uniform(-0.015, 0.015) + (0.05 - left_strength) * 0.1
            left_idle = max(0.02, min(0.09, left_strength + delta_l))
            delta_r = random.uniform(-0.015, 0.015) + (0.05 - right_strength) * 0.1
            right_idle = max(0.02, min(0.09, right_strength + delta_r))

            if triangle_state == "clear":
                alert = "clear"
                distance_m = None
                left_motion = False
                right_motion = False
                radar_motion = False
                radar_level = 0.0
                left_strength = left_idle
                right_strength = right_idle

                time_until_tri_visit -= dt
                if time_until_tri_visit <= 0.0:
                    available_sides = [s for s in installed_sides if s != offline]
                    if available_sides:
                        triangle_side = random.choice(available_sides)
                        triangle_state = "activity"
                        tri_phase_elapsed = 0.0
                        tri_phase_duration = random.uniform(1.5, 2.5)
                        tri_peak_strength = random.uniform(0.45, 0.60)
                        alert = "approach"
                        print(f"triangle: approach ({triangle_side} side active)", flush=True)
                    else:
                        time_until_tri_visit = 5.0

            elif triangle_state == "activity":
                tri_phase_elapsed += dt
                alert = "approach"
                distance_m = None
                radar_motion = False
                radar_level = 0.0

                p = min(1.0, tri_phase_elapsed / tri_phase_duration)
                wobble = 0.04 * math.sin(2.0 * math.pi * 1.7 * tri_phase_elapsed) + random.uniform(-0.015, 0.015)
                str_val = max(0.02, min(0.95, 0.05 + (tri_peak_strength - 0.05) * math.sin(math.pi * 0.5 * p) + wobble))

                if triangle_side == "left":
                    left_strength = str_val
                    if left_strength > 0.35:
                        left_motion = True
                    elif left_strength < 0.25:
                        left_motion = False
                    right_strength = right_idle
                    right_motion = False
                else:
                    right_strength = str_val
                    if right_strength > 0.35:
                        right_motion = True
                    elif right_strength < 0.25:
                        right_motion = False
                    left_strength = left_idle
                    left_motion = False

                if tri_phase_elapsed >= tri_phase_duration:
                    triangle_state = "inside_moving"
                    tri_phase_elapsed = 0.0
                    tri_phase_duration = random.uniform(2.0, 3.0)
                    radar_dist = random.uniform(1.0, 3.0)
                    distance_m = round(radar_dist, 1)
                    alert = "inside"
                    fade_start_str = left_strength if triangle_side == "left" else right_strength
                    print(f"triangle: inside (moving, {distance_m:.1f} m)", flush=True)

            elif triangle_state == "inside_moving":
                tri_phase_elapsed += dt
                alert = "inside"
                radar_dist = max(1.0, min(3.0, radar_dist + random.uniform(-0.05, 0.05)))
                distance_m = round(radar_dist, 1)
                radar_motion = True
                radar_level = max(0.40, min(0.60, 0.50 + 0.08 * math.sin(2.0 * math.pi * 1.5 * tri_phase_elapsed) + random.uniform(-0.02, 0.02)))

                fade_p = min(1.0, tri_phase_elapsed / 1.0)
                decay_str = max(0.05, fade_start_str * (1.0 - fade_p) + 0.05 * fade_p)

                if triangle_side == "left":
                    left_strength = decay_str
                    if left_strength > 0.35:
                        left_motion = True
                    elif left_strength < 0.25:
                        left_motion = False
                    right_strength = right_idle
                    right_motion = False
                else:
                    right_strength = decay_str
                    if right_strength > 0.35:
                        right_motion = True
                    elif right_strength < 0.25:
                        right_motion = False
                    left_strength = left_idle
                    left_motion = False

                if tri_phase_elapsed >= tri_phase_duration:
                    triangle_state = "inside_still"
                    tri_phase_elapsed = 0.0
                    tri_phase_duration = random.uniform(3.0, 6.0)
                    radar_motion = False
                    radar_level = 0.05
                    left_motion = False
                    right_motion = False
                    left_strength = left_idle
                    right_strength = right_idle
                    alert = "inside"
                    print("triangle: inside (still)", flush=True)

            elif triangle_state == "inside_still":
                tri_phase_elapsed += dt
                alert = "inside"
                radar_motion = False
                radar_level = max(0.02, min(0.08, 0.05 + random.uniform(-0.01, 0.01)))
                left_motion = False
                right_motion = False
                left_strength = left_idle
                right_strength = right_idle

                if tri_phase_elapsed >= tri_phase_duration:
                    triangle_state = "leaving"
                    tri_phase_elapsed = 0.0
                    tri_phase_duration = 1.5
                    tri_peak_strength = random.uniform(0.45, 0.60)
                    alert = "approach"
                    distance_m = None
                    radar_motion = False
                    radar_level = 0.0
                    print(f"triangle: leaving ({triangle_side} side active)", flush=True)

            elif triangle_state == "leaving":
                tri_phase_elapsed += dt
                alert = "approach"
                distance_m = None
                radar_motion = False
                radar_level = 0.0

                p = min(1.0, tri_phase_elapsed / tri_phase_duration)
                wobble = 0.04 * math.sin(2.0 * math.pi * 1.7 * tri_phase_elapsed) + random.uniform(-0.015, 0.015)
                str_val = max(0.02, min(0.95, 0.05 + (tri_peak_strength - 0.05) * math.sin(math.pi * 0.5 * p) + wobble))

                if triangle_side == "left":
                    left_strength = str_val
                    if left_strength > 0.35:
                        left_motion = True
                    elif left_strength < 0.25:
                        left_motion = False
                    right_strength = right_idle
                    right_motion = False
                else:
                    right_strength = str_val
                    if right_strength > 0.35:
                        right_motion = True
                    elif right_strength < 0.25:
                        right_motion = False
                    left_strength = left_idle
                    left_motion = False

                if tri_phase_elapsed >= tri_phase_duration:
                    triangle_state = "clear"
                    tri_phase_elapsed = 0.0
                    time_until_tri_visit = random.uniform(10.0, 20.0)
                    alert = "clear"
                    distance_m = None
                    left_motion = False
                    right_motion = False
                    radar_motion = False
                    radar_level = 0.0
                    left_strength = left_idle
                    right_strength = right_idle
                    print("triangle: clear", flush=True)

            motion = left_motion or right_motion or radar_motion
            strength = max(left_strength, right_strength, radar_level)

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
        elif scenario == "triangle":
            links = []
            if "left" in installed_sides and offline != "left":
                links.append({
                    "id": "left",
                    "motion": left_motion,
                    "strength": round(left_strength, 3),
                    "rssi": round(-55 + random.uniform(-1, 1)),
                    "pps": random.randint(68, 72),
                })
            if "right" in installed_sides and offline != "right":
                links.append({
                    "id": "right",
                    "motion": right_motion,
                    "strength": round(right_strength, 3),
                    "rssi": round(-58 + random.uniform(-1, 1)),
                    "pps": random.randint(68, 72),
                })
            nodes = [{"id": "hub", "online": offline != "hub"}]
            for s in installed_sides:
                nodes.append({"id": s, "online": offline != s})
            nodes.append({"id": "radar", "online": offline != "radar"})
            payload = {
                "t": time.time(),
                "motion": motion,
                "strength": round(strength, 3),
                "confidence": round(confidence, 3),
                "alert": alert,
                "distance_m": round(distance_m, 1) if distance_m is not None else None,
                "links": links,
                "nodes": nodes,
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
    parser = argparse.ArgumentParser(description="Perrymeter Mock WebSocket Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to listen on")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on")
    parser.add_argument("--rate", type=float, default=10.0, help="Message rate in Hz")
    parser.add_argument(
        "--scenario",
        choices=["mixed", "idle", "walk", "chaos", "zone", "triangle"],
        default="mixed",
        help="Simulation scenario",
    )
    parser.add_argument(
        "--legacy",
        action="store_true",
        help="Send Team A legacy contract format",
    )
    parser.add_argument(
        "--offline",
        default=None,
        help="Node id to report offline, e.g. right",
    )
    parser.add_argument(
        "--sides",
        default="left,right",
        help="Comma-separated list of installed sides, default left,right",
    )
    args = parser.parse_args()

    async with serve(handler, args.host, args.port):
        print(
            f"Perrymeter mock server listening on ws://{args.host}:{args.port} (scenario: {args.scenario}, rate: {args.rate} Hz, legacy: {args.legacy})",
            flush=True,
        )
        await broadcast_loop(args.rate, args.scenario, args.legacy, args.offline, args.sides)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
