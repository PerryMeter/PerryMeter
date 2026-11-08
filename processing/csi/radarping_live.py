"""RadarPing experimental LIVE Wi-Fi CSI inference + dashboard WebSocket.

Run in regular PowerShell (not ESP-IDF shell):
    python -m pip install -r requirements.txt
    python radarping_live.py --port COM6

NESP: powered sender. OESP: USB-connected receiver (921600 baud).
UI feed: ws://localhost:8765 (JSON {'t','motion','strength','confidence'} at 2 Hz).
These are research signals, NOT a safety-certified crossing alarm.
"""
import argparse
import asyncio
from collections import deque
import csv
import json
from pathlib import Path
import time
import zipfile

import joblib
import numpy as np
import pandas as pd
import websockets


def parse_csi_line(line):
    """Parse CSI_DATA serial log, returning (magnitudes[192], RSSI) or None."""
    if isinstance(line, bytes):
        line = line.decode('utf-8', errors='replace')
    line = line.strip()
    if not line.startswith('CSI_DATA,'):
        return None
    try:
        fields = next(csv.reader([line]))
        # Format matches the saved recording parser in radarping_core.py
        if len(fields) < 25 or int(fields[-3]) != 384:
            return None
        samples = np.asarray(json.loads(fields[-1]), dtype=np.float32)
        if samples.size != 384:
            return None
        magnitude = np.hypot(samples[::2], samples[1::2])
        if fields[-2] == '1':
            magnitude[:2] = np.nan  # first 4 bytes = 2 invalid complex pairs
        return magnitude, float(fields[3])
    except (ValueError, IndexError, StopIteration, TypeError, json.JSONDecodeError):
        return None


class LiveDetector:
    """0.5-second windows with a causal 1.5-second history; matches offline features."""

    def __init__(self, bundle, baseline_mode='current'):
        self.bundle = bundle
        self.window = float(bundle['window'])
        self.chosen = np.asarray(bundle['chosen'], dtype=int)
        self.baseline_mode = baseline_mode
        self.base = np.asarray(bundle['baseline_shape'], dtype=float).copy()
        self.t0 = None
        self.last_bin = None
        self.previous_high = False
        self.previous_bin = -99
        self.q = deque()
        self.n_packets = 0
        self.n_outputs = 0
        self.calibrated = baseline_mode == 'trained'
        self.cali_packets = 0

    def _set_session_baseline(self):
        # DO NOT change 'chosen' indices without retraining the classifier.
        # Only recalculate the normal CSI shape for those exact indices.
        a = np.array([amp for t, amp, rssi in self.q if 0 <= t-self.t0 < 3.0], dtype=float)
        if len(a) < 40:
            raise RuntimeError('Too few CSI packets in the first 3 quiet seconds. Check ESP32 reception.')
        selected = a[:, self.chosen]
        normal_shape = selected / np.maximum(np.nanmedian(selected, axis=1, keepdims=True), 2.0)
        self.base = np.nanmedian(normal_shape, axis=0)
        self.calibrated = True
        self.cali_packets = len(a)
        print(f'Calibration complete: {len(a)} quiet CSI packets; fixed model subcarriers retained.', flush=True)
        print('IMPORTANT: new-site accuracy has not been validated.', flush=True)

    def _features_for_bin(self, k):
        start = k*self.window
        end = start+self.window
        t = np.array([x[0]-self.t0 for x in self.q], dtype=float)
        amp = np.array([x[1][self.chosen] for x in self.q], dtype=np.float32)
        rssi = np.array([x[2] for x in self.q], dtype=np.float32)
        curr = np.flatnonzero((t >= start) & (t < end))
        if len(curr) < 8:
            return None
        prior = np.flatnonzero((t >= start-1.5) & (t < start))
        shape = amp / np.maximum(np.nanmedian(amp, axis=1)[:, None], 2.0)
        xx = shape[curr]
        aa = amp[curr]
        rr = rssi[curr]
        mcurrent = np.nanmedian(xx, axis=0)
        dist = np.nanmedian(np.abs(xx-self.base), axis=1)
        if len(prior) > 10:
            shape_prev = np.nanmedian(shape[prior], axis=0)
            shape_shift = np.nanmedian(np.abs(mcurrent-shape_prev))
            old_amp = np.nanmedian(amp[prior], axis=0)
            amp_shift = np.nanmedian(np.abs(np.nanmedian(aa, axis=0)-old_amp)/np.maximum(old_amp, 2))
            rssi_shift = abs(np.median(rr)-np.median(rssi[prior]))
        else:
            shape_shift = amp_shift = rssi_shift = 0.0
        lag = min(9, max(1, len(xx)//4))
        lag2 = min(22, max(1, len(xx)//2))
        cv = np.nanstd(aa, axis=0)/(np.nanmean(aa, axis=0)+2)
        return dict(
            shape_std=np.nanmedian(np.nanstd(xx, axis=0)),
            shape_std90=np.nanpercentile(np.nanstd(xx, axis=0), 90),
            amp_cv=np.nanmedian(cv), amp_cv90=np.nanpercentile(cv, 90),
            shape_step=np.nanmedian(np.abs(np.diff(xx, axis=0))),
            shape_step90=np.nanpercentile(np.abs(np.diff(xx, axis=0)), 90),
            shape_lag=np.nanmedian(np.abs(xx[lag:]-xx[:-lag])),
            shape_lag90=np.nanpercentile(np.abs(xx[lag:]-xx[:-lag]), 90),
            shape_lag2=np.nanmedian(np.abs(xx[lag2:]-xx[:-lag2])),
            base_dist=np.nanmedian(dist), base_dist90=np.nanpercentile(dist, 90),
            shape_shift=shape_shift, amp_shift=amp_shift,
            rssi_median=np.median(rr), rssi_std=np.std(rr), rssi_shift=rssi_shift,
            amp_mean=np.nanmedian(aa), amp_spread=np.nanstd(np.nanmedian(aa, axis=1)),
        )

    def _predict(self, k):
        f = self._features_for_bin(k)
        if f is None:
            self.previous_high = False
            return None
        score = float(self.bundle['model'].predict_proba(
            pd.DataFrame([f])[self.bundle['features']])[0, 1])
        high = score >= float(self.bundle['threshold'])
        motion = bool(high and self.previous_high and self.previous_bin == k-1)
        self.previous_high = high
        self.previous_bin = k
        strength = float(np.clip(float(f['shape_std'])/self.bundle['strength_reference'], 0, 1))
        self.n_outputs += 1
        return dict(t=round(self.t0+(k+0.5)*self.window, 3),
                    motion=motion, strength=round(strength, 3),
                    confidence=round(score, 3))

    def feed(self, t, magnitude, rssi):
        """Consume one CSI packet and return zero or more complete-window messages."""
        if self.t0 is None:
            self.t0 = t
        if t < self.t0:
            return []
        k = int((t-self.t0)//self.window)
        if self.last_bin is None:
            self.last_bin = k
        self.q.append((t, magnitude, rssi))
        self.n_packets += 1
        out = []
        if k > self.last_bin:
            # Each bin is only emitted after its closing packet has passed.
            for completed in range(self.last_bin, k):
                if self.baseline_mode == 'current' and not self.calibrated and completed >= 5:
                    self._set_session_baseline()
                if completed >= 6 and self.calibrated:
                    message = self._predict(completed)
                    if message is not None:
                        out.append(message)
                    else:
                        self.previous_high = False
            self.last_bin = k
            cutoff = t - 3.1
            while self.q and self.q[0][0] < cutoff:
                self.q.popleft()
        return out


async def run_server(args):
    clients = set()
    last_message = None

    async def handler(ws):
        clients.add(ws)
        print(f'Dashboard connected ({len(clients)} clients).', flush=True)
        try:
            if last_message is not None:
                await ws.send(last_message)
            await ws.wait_closed()
        finally:
            clients.discard(ws)

    bundle = joblib.load(args.model)  # Only load our known, trusted model files.
    detector = LiveDetector(bundle, baseline_mode=args.baseline)
    path = Path(args.log)

    async def process_messages(messages, out_file):
        nonlocal last_message
        for msg in messages:
            s = json.dumps(msg, separators=(',', ':'))
            out_file.write(s+'\n')
            out_file.flush()
            last_message = s
            print(('CROSSING?' if msg['motion'] else 'clear    ')
                  + f"  strength={msg['strength']:.2f}  score={msg['confidence']:.2f}", flush=True)
            if clients:
                await asyncio.gather(*(client.send(s) for client in list(clients)), return_exceptions=True)

    print(f'WebSocket server: ws://{args.host}:{args.ws_port}', flush=True)
    print(f'Model: {args.model}  |  mode={args.baseline}', flush=True)
    print(f'Writing dashboard messages to: {path.resolve()}', flush=True)
    async with websockets.serve(handler, args.host, args.ws_port):
        with path.open('w', encoding='utf-8') as out_file:
            if args.replay:
                from radarping_core import read_csi_csv
                import zipfile
                with zipfile.ZipFile(args.zip) as z:
                    member = next((n for n in z.namelist()
                                   if n.startswith(args.replay+'_') and n.endswith('.csv')
                                   and '_events' not in n), None)
                if member is None:
                    raise ValueError('Replay scenario not found in ZIP')
                t, amps, rssi, _ = read_csi_csv(zip_path=args.zip, member=member)
                print(f'OFFLINE REPLAY: {len(t)} stored packets. Not live sensor data.', flush=True)
                last_t = t[0]
                for ti, mag, ri in zip(t, amps, rssi):
                    if args.speed > 0:
                        await asyncio.sleep(max(0, float(ti-last_t)/args.speed))
                    last_t = ti
                    await process_messages(detector.feed(float(ti), mag, float(ri)), out_file)
            else:
                import serial
                try:
                    with serial.Serial(args.port, 921600, timeout=0.25) as port:
                        port.reset_input_buffer()
                        print(f'Listening to {args.port} at 921600 baud; keep the area EMPTY for first 3 seconds.', flush=True)
                        print('Press Ctrl+C to stop.', flush=True)
                        last_packet_at = time.monotonic()
                        while True:
                            raw = await asyncio.to_thread(port.readline)
                            reading = parse_csi_line(raw)
                            if reading is None:
                                if time.monotonic()-last_packet_at > 8:
                                    print(f'No CSI_DATA for 8 seconds. Check receiver {args.port}, sender power, and port access.', flush=True)
                                    last_packet_at = time.monotonic()
                                continue
                            last_packet_at = time.monotonic()
                            mag, rssi = reading
                            await process_messages(detector.feed(time.time(), mag, rssi), out_file)
                except serial.SerialException as e:
                    raise SystemExit(f'Cannot open/read {args.port}: {e}. Close any other CSI serial monitor or recorder.') from e
    print(f'Finished: {detector.n_packets} packets; {detector.n_outputs} output windows.', flush=True)


def main():
    p = argparse.ArgumentParser(description='Live RadarPing CSI ML -> local WebSocket feed')
    p.add_argument('--port', default='COM6', help='Receiver serial port, e.g. COM6')
    p.add_argument('--model', default='radarping_results/radarping_calibrated.joblib')
    p.add_argument('--host', default='127.0.0.1', help='WebSocket host (localhost by default; 0.0.0.0 for LAN)')
    p.add_argument('--ws-port', type=int, default=8765)
    p.add_argument('--log', default='radarping_live.jsonl')
    p.add_argument('--baseline', choices=['current','trained'], default='current',
                   help='current=first 3s quiet new baseline; trained=reuse stored baseline')
    p.add_argument('--replay', choices=['crossings','nearby'],
                   help='OFFLINE test using saved dataset (no ESP32 required)')
    p.add_argument('--zip', default='RadarPing_ML_Data.zip')
    p.add_argument('--speed', type=float, default=0.0, help='Replay speed; 0 means as fast as possible')
    args = p.parse_args()
    try:
        asyncio.run(run_server(args))
    except KeyboardInterrupt:
        print('\nStopped. Dashboard log saved.', flush=True)


if __name__ == '__main__':
    main()
