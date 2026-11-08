"""RadarPing: record raw CSI and human-marked tripwire crossing events.

Run on a Windows computer connected over USB to the CSI receiver:
    python radarping_record_events.py --port COM6 --duration 180 --label crossings

The observer presses Enter exactly as the walker crosses the imaginary line
between the two ESP32s. A separate events CSV saves those times. The person
being tracked should not be pressing the key themselves.

Use --label nearby or --label quiet for negative recordings; do not press
Enter in those sessions. Both files are written in the current directory.
"""
import argparse
import csv
from datetime import datetime
from pathlib import Path
import queue
import threading
import time

import serial


def main():
    parser = argparse.ArgumentParser(description='Timestamped CSI recorder with crossing markers')
    parser.add_argument('--port', default='COM6', help='CSI receiver serial port')
    parser.add_argument('--duration', type=int, default=180, help='Recording duration in seconds')
    parser.add_argument('--label', default='crossings', help='Name for recording (e.g. crossings, nearby, quiet)')
    args = parser.parse_args()
    if args.duration <= 0:
        parser.error('--duration must be positive')
    if any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in args.label):
        parser.error('--label may only use letters, digits, underscore and hyphen')

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    raw_path = Path(f'{args.label}_{stamp}.csv')
    events_path = Path(f'{args.label}_{stamp}_events.csv')
    markers = queue.SimpleQueue()
    start_event = threading.Event()
    stop_event = threading.Event()

    def read_markers():
        start_event.wait()
        while not stop_event.is_set():
            try:
                line = input()
            except (EOFError, KeyboardInterrupt):
                return
            timestamp = time.time()
            if line.strip().lower() == 'q':
                markers.put((timestamp, 'stop'))
                return
            if line.strip() in ('', 'x', 'X'):
                markers.put((timestamp, 'crossing'))

    print('Sensor roles: NESP = sender; OESP = receiver on', args.port)
    print('Have a friend press Enter each time the person CROSSES the line.')
    print('For quiet/nearby recordings, do not mark crossings.')
    print('Type q then Enter to end early. Keep the sensor positions fixed.')

    keyboard_thread = threading.Thread(target=read_markers, daemon=True)
    keyboard_thread.start()
    count = 0
    marked = []
    with serial.Serial(args.port, 921600, timeout=0.2) as port:
        port.reset_input_buffer()
        with raw_path.open('w', encoding='utf-8', newline='') as raw_file:
            writer = csv.writer(raw_file)
            writer.writerow(['t', 'label', 'raw_csi'])
            start_wall = time.time()
            start_perf = time.monotonic()
            start_event.set()
            print(f'Recording for {args.duration} seconds. START NOW.')
            while time.monotonic() - start_perf < args.duration:
                while not markers.empty():
                    stamp_s, event_name = markers.get_nowait()
                    if event_name == 'stop':
                        stop_event.set()
                        break
                    if event_name == 'crossing':
                        marked.append((stamp_s, stamp_s - start_wall, 'crossing'))
                        print(f'Marked crossing #{len(marked)} at +{stamp_s-start_wall:.2f}s')
                if stop_event.is_set():
                    break
                line = port.readline()
                now = time.time()
                if line.startswith(b'CSI_DATA,'):
                    writer.writerow([now, args.label, line.decode('utf-8', errors='replace').strip()])
                    count += 1
            raw_file.flush()
    stop_event.set()
    with events_path.open('w', encoding='utf-8', newline='') as events_file:
        writer = csv.writer(events_file)
        writer.writerow(['t', 'seconds_from_start', 'event'])
        writer.writerows(marked)
    print(f'Packets saved: {count}')
    print(f'Crossings marked: {len(marked)}')
    print(f'CSI file: {raw_path}')
    print(f'Events file: {events_path}')


if __name__ == '__main__':
    main()
