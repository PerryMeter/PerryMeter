import sys
import math
import random
import time
from collections import deque
from datetime import datetime

import numpy as np
from PySide6.QtCore import Qt, QTimer, QRectF, QPointF
from PySide6.QtGui import QColor, QPainter, QPen, QBrush, QFont, QLinearGradient
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QFrame, QGridLayout, QProgressBar, QComboBox,
    QSizePolicy
)

# RadarPing Windows simulator
# All signal and detection values are simulated. Replace SimulatedCSI with
# a serial-data source and DetectionEngine with your real detector later.

BG = QColor("#071018")
PANEL = QColor("#0B1922")
PANEL_ALT = QColor("#0E202B")
BORDER = QColor("#1B3B48")
TEXT = QColor("#D8E6EA")
MUTED = QColor("#7E9AA5")
GREEN = QColor("#36E0A1")
CYAN = QColor("#48C7D8")
RED = QColor("#FF465A")
AMBER = QColor("#F5B84B")


class SimulatedCSI:
    """Produces plausible-looking synthetic CSI amplitude samples."""

    def __init__(self):
        self.t = 0.0
        self.motion_until = 0.0
        self.motion_strength = 0.0
        self.no_signal = False

    def trigger_motion(self, strength=0.9, duration=5.0):
        self.motion_strength = max(0.2, min(1.0, strength))
        self.motion_until = self.t + duration

    def sample(self, count=48):
        self.t += 0.12
        if self.no_signal:
            return None

        moving = self.t < self.motion_until
        level = self.motion_strength if moving else 0.0
        x = np.arange(count)
        # A stable per-subcarrier baseline plus gentle drift and measurement noise.
        baseline = 43 + 4.5 * np.sin(x * 0.22) + 2.2 * np.cos(x * 0.47)
        drift = 1.4 * math.sin(self.t * 0.8)
        noise = np.random.normal(0, 1.0, count)
        # Motion perturbs subcarriers differently, mimicking multipath changes.
        motion = level * (8 * np.sin(x * 0.31 + self.t * 5.0)
                          + 5 * np.cos(x * 0.13 - self.t * 3.2))
        return np.clip(baseline + drift + noise + motion, 0, 100)


class DetectionEngine:
    """Simple baseline-deviation detector for demonstration only."""

    def __init__(self):
        self.baseline = None
        self.smooth_score = 0.0

    def update(self, sample):
        if sample is None:
            return False, 0.0, 0.0
        current = float(np.mean(np.abs(sample - np.mean(sample))))
        if self.baseline is None:
            self.baseline = current
        # This demo detector uses signal variation as a proxy, not a trained model.
        self.baseline = 0.985 * self.baseline + 0.015 * current
        deviation = abs(current - self.baseline)
        raw = min(1.0, deviation / 7.5)
        self.smooth_score = 0.72 * self.smooth_score + 0.28 * raw
        detected = self.smooth_score > 0.20
        return detected, self.smooth_score, current


class Panel(QFrame):
    def __init__(self, title, subtitle=None):
        super().__init__()
        self.setObjectName("panel")
        self.setStyleSheet(
            "QFrame#panel { background:#0B1922; border:1px solid #1B3B48; border-radius:9px; }"
        )
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(12, 10, 12, 10)
        self.layout.setSpacing(7)
        header = QHBoxLayout()
        title_label = QLabel(title.upper())
        title_label.setStyleSheet("color:#9CB9C3; font-size:10px; font-weight:700; letter-spacing:1.5px;")
        header.addWidget(title_label)
        header.addStretch()
        if subtitle:
            sub = QLabel(subtitle)
            sub.setStyleSheet("color:#587681; font-size:9px;")
            header.addWidget(sub)
        self.layout.addLayout(header)


class MetricCard(QFrame):
    def __init__(self, label, value, unit=""):
        super().__init__()
        self.setStyleSheet("background:#0E202B; border:1px solid #1B3B48; border-radius:8px;")
        box = QVBoxLayout(self)
        box.setContentsMargins(11, 8, 11, 8)
        box.setSpacing(2)
        self.label = QLabel(label.upper())
        self.label.setStyleSheet("color:#7896A1; font-size:9px; font-weight:700; letter-spacing:1px;")
        self.value = QLabel(value)
        self.value.setStyleSheet("color:#E3F0F2; font-size:22px; font-weight:700;")
        self.unit = QLabel(unit)
        self.unit.setStyleSheet("color:#7896A1; font-size:9px;")
        box.addWidget(self.label)
        row = QHBoxLayout()
        row.addWidget(self.value)
        row.addWidget(self.unit)
        row.addStretch()
        box.addLayout(row)

    def set_value(self, value, color="#E3F0F2"):
        self.value.setText(str(value))
        self.value.setStyleSheet(f"color:{color}; font-size:22px; font-weight:700;")


class SignalGraph(QWidget):
    def __init__(self):
        super().__init__()
        self.values = deque(maxlen=180)
        self.setMinimumHeight(170)

    def add_value(self, value):
        self.values.append(value)
        self.update()

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = self.rect().adjusted(8, 8, -8, -8)
        p.fillRect(self.rect(), QColor("#0B1922"))
        # Grid
        p.setPen(QPen(QColor("#183541"), 1, Qt.PenStyle.DotLine))
        for i in range(1, 5):
            y = r.top() + r.height() * i / 5
            p.drawLine(QPointF(r.left(), y), QPointF(r.right(), y))
        for i in range(1, 8):
            x = r.left() + r.width() * i / 8
            p.drawLine(QPointF(x, r.top()), QPointF(x, r.bottom()))
        if len(self.values) > 1:
            vals = list(self.values)
            lo, hi = 20, 80
            points = []
            for i, v in enumerate(vals):
                x = r.left() + r.width() * i / max(1, len(vals) - 1)
                y = r.bottom() - (max(lo, min(hi, v)) - lo) / (hi - lo) * r.height()
                points.append(QPointF(x, y))
            p.setPen(QPen(QColor("#48C7D8"), 2))
            for a, b in zip(points, points[1:]):
                p.drawLine(a, b)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor("#48C7D8"))
            p.drawEllipse(points[-1], 3, 3)
        p.end()


class RadarWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.angle = 0.0
        self.pings = []
        self.setMinimumSize(260, 230)

    def set_state(self, detected, confidence):
        if detected and (not self.pings or time.time() - self.pings[-1][0] > 1.8):
            # Synthetic bearing/range for UI demonstration only.
            self.pings.append((time.time(), random.uniform(-0.85, 0.85),
                               random.uniform(0.30, 0.88), confidence))
        self.pings = [x for x in self.pings if time.time() - x[0] < 7]
        self.update()

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.fillRect(self.rect(), QColor("#08151D"))
        w, h = self.width(), self.height()
        cx, cy = w / 2, h * 0.88
        radius = min(w * 0.43, h * 0.78)
        p.setPen(QPen(QColor("#24505A"), 1))
        p.setBrush(Qt.BrushStyle.NoBrush)
        for frac in (0.25, 0.5, 0.75, 1.0):
            p.drawEllipse(QPointF(cx, cy), radius * frac, radius * frac)
        p.drawLine(QPointF(cx - radius, cy), QPointF(cx + radius, cy))
        p.drawLine(QPointF(cx, cy), QPointF(cx, cy - radius))
        p.drawLine(QPointF(cx, cy), QPointF(cx - radius * .7, cy - radius * .7))
        p.drawLine(QPointF(cx, cy), QPointF(cx + radius * .7, cy - radius * .7))

        # Sweep wedge
        sweep_rad = math.radians(self.angle)
        sweep_end = QPointF(cx + math.cos(sweep_rad) * radius,
                            cy - math.sin(sweep_rad) * radius)
        p.setPen(QPen(QColor("#36E0A1"), 2))
        p.drawLine(QPointF(cx, cy), sweep_end)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(54, 224, 161, 22))
        p.drawPie(QRectF(cx-radius, cy-radius, 2*radius, 2*radius),
                  int((self.angle - 14) * 16), int(14 * 16))

        now = time.time()
        for stamp, bearing, distance, conf in self.pings:
            age = now - stamp
            alpha = max(30, int(255 * (1 - age / 7)))
            x = cx + math.sin(bearing) * radius * distance
            y = cy - math.cos(bearing) * radius * distance
            p.setPen(QPen(QColor(255, 70, 90, alpha), 2))
            p.setBrush(QColor(255, 70, 90, alpha))
            p.drawEllipse(QPointF(x, y), 5, 5)
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawEllipse(QPointF(x, y), 10 + age * 2, 10 + age * 2)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor("#48C7D8"))
        p.drawEllipse(QPointF(cx, cy), 4, 4)
        p.end()


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("RADARPING // CSI MONITOR")
        self.resize(1280, 800)
        self.setMinimumSize(1024, 600)
        self.source = SimulatedCSI()
        self.detector = DetectionEngine()
        self.last_detected = False
        self.event_count = 0
        self.start_time = time.time()

        root = QWidget()
        root.setStyleSheet("background:#071018; color:#D8E6EA; font-family:'Segoe UI';")
        self.setCentralWidget(root)
        outer = QVBoxLayout(root)
        outer.setContentsMargins(14, 12, 14, 12)
        outer.setSpacing(10)

        # Top bar
        top = QHBoxLayout()
        brand = QLabel("◈  RADARPING")
        brand.setStyleSheet("color:#E4F1F3; font-size:20px; font-weight:800; letter-spacing:2px;")
        top.addWidget(brand)
        tag = QLabel("WIFI CSI HUMAN-MOTION MONITOR")
        tag.setStyleSheet("color:#6F929E; font-size:10px; letter-spacing:1.4px;")
        top.addWidget(tag)
        top.addStretch()
        self.clock = QLabel("--:--:--")
        self.clock.setStyleSheet("color:#9DB8C1; font-size:12px; font-weight:700;")
        top.addWidget(self.clock)
        outer.addLayout(top)

        # Status strip
        status = QFrame()
        status.setStyleSheet("background:#0B1922; border:1px solid #1B3B48; border-radius:7px;")
        sr = QHBoxLayout(status)
        sr.setContentsMargins(12, 7, 12, 7)
        self.system_status = QLabel("●  SYSTEM ONLINE")
        self.system_status.setStyleSheet("color:#36E0A1; font-size:10px; font-weight:700;")
        self.link_status = QLabel("ESP32 LINK: SIMULATED")
        self.link_status.setStyleSheet("color:#48C7D8; font-size:10px; font-weight:700;")
        self.mode_status = QLabel("INPUT: SYNTHETIC CSI")
        self.mode_status.setStyleSheet("color:#9CB9C3; font-size:10px;")
        sr.addWidget(self.system_status)
        sr.addSpacing(18)
        sr.addWidget(self.link_status)
        sr.addStretch()
        sr.addWidget(self.mode_status)
        outer.addWidget(status)

        # Metric row
        metrics = QHBoxLayout()
        self.metric_state = MetricCard("Detection state", "SCANNING")
        self.metric_conf = MetricCard("Motion score", "0%", "DEMO SCORE")
        self.metric_variation = MetricCard("Signal variation", "--", "A.U.")
        self.metric_events = MetricCard("Events logged", "0")
        for m in (self.metric_state, self.metric_conf, self.metric_variation, self.metric_events):
            metrics.addWidget(m)
        outer.addLayout(metrics)

        # Main content
        content = QHBoxLayout()
        content.setSpacing(10)
        left = Panel("Live radar", "SIMULATED BEARING / RANGE")
        self.radar = RadarWidget()
        left.layout.addWidget(self.radar, 1)
        radar_note = QLabel("Red markers are illustrative detections, not measured coordinates.")
        radar_note.setStyleSheet("color:#64818C; font-size:9px;")
        left.layout.addWidget(radar_note)
        content.addWidget(left, 5)

        right_col = QVBoxLayout()
        graph_panel = Panel("CSI signal activity", "SYNTHETIC AMPLITUDE")
        self.graph = SignalGraph()
        graph_panel.layout.addWidget(self.graph, 1)
        right_col.addWidget(graph_panel, 3)

        event_panel = Panel("Event log", "LATEST ACTIVITY")
        self.event_text = QLabel("SYSTEM  Simulator initialized\nSYSTEM  Waiting for signal samples")
        self.event_text.setWordWrap(True)
        self.event_text.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
        self.event_text.setStyleSheet("color:#9CB9C3; font-family:Consolas; font-size:10px;")
        event_panel.layout.addWidget(self.event_text, 1)
        right_col.addWidget(event_panel, 2)
        content.addLayout(right_col, 5)
        outer.addLayout(content, 1)

        # Controls
        controls = QHBoxLayout()
        self.motion_button = QPushButton("＋  SIMULATE MOVEMENT")
        self.motion_button.clicked.connect(self.trigger_motion)
        self.motion_button.setStyleSheet(self.button_style(GREEN))
        self.no_signal_button = QPushButton("⏻  TOGGLE SIGNAL LOSS")
        self.no_signal_button.clicked.connect(self.toggle_signal)
        self.no_signal_button.setStyleSheet(self.button_style(AMBER))
        self.reset_button = QPushButton("↺  RESET BASELINE")
        self.reset_button.clicked.connect(self.reset_detector)
        self.reset_button.setStyleSheet(self.button_style(CYAN))
        controls.addWidget(self.motion_button)
        controls.addWidget(self.no_signal_button)
        controls.addWidget(self.reset_button)
        controls.addStretch()
        footer = QLabel("DEMO MODE  •  SYNTHETIC DATA ONLY  •  NOT A VALIDATED HUMAN DETECTOR")
        footer.setStyleSheet("color:#587681; font-size:9px; letter-spacing:1px;")
        controls.addWidget(footer)
        outer.addLayout(controls)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.timer.start(120)
        self.animation_timer = QTimer(self)
        self.animation_timer.timeout.connect(self.animate)
        self.animation_timer.start(45)

    @staticmethod
    def button_style(accent):
        return (
            f"QPushButton {{ background:#102833; color:{accent.name()}; border:1px solid #28505D;"
            " border-radius:6px; padding:10px 14px; font-size:10px; font-weight:700; letter-spacing:1px; }"
            "QPushButton:hover { background:#183844; }"
            "QPushButton:pressed { background:#071018; }"
        )

    def add_event(self, message, color="#9CB9C3"):
        stamp = datetime.now().strftime("%H:%M:%S")
        old = self.event_text.text().splitlines()
        lines = [f"{stamp}  {message}"] + old
        self.event_text.setText("\n".join(lines[:7]))
        self.event_text.setStyleSheet(f"color:{color}; font-family:Consolas; font-size:10px;")

    def trigger_motion(self):
        self.source.trigger_motion(random.uniform(0.65, 1.0), random.uniform(4.0, 7.0))
        self.add_event("SIMULATED MOTION INJECTED", "#FF7180")

    def toggle_signal(self):
        self.source.no_signal = not self.source.no_signal
        if self.source.no_signal:
            self.add_event("CSI INPUT LOST", "#F5B84B")
        else:
            self.detector = DetectionEngine()
            self.add_event("CSI INPUT RESTORED", "#36E0A1")

    def reset_detector(self):
        self.detector = DetectionEngine()
        self.add_event("DETECTION BASELINE RESET", "#48C7D8")

    def tick(self):
        self.clock.setText(datetime.now().strftime("%H:%M:%S"))
        sample = self.source.sample()
        if sample is None:
            self.metric_state.set_value("NO SIGNAL", RED.name())
            self.metric_conf.set_value("--", AMBER.name())
            self.system_status.setText("●  INPUT DISCONNECTED")
            self.system_status.setStyleSheet("color:#F5B84B; font-size:10px; font-weight:700;")
            return

        detected, score, variation = self.detector.update(sample)
        self.graph.add_value(float(np.mean(sample)))
        self.metric_conf.set_value(f"{score*100:.0f}%", RED.name() if detected else GREEN.name())
        self.metric_variation.set_value(f"{variation:.1f}")
        self.metric_state.set_value("PING" if detected else "SCANNING",
                                    RED.name() if detected else GREEN.name())
        self.system_status.setText("●  MOTION EVENT" if detected else "●  SYSTEM ONLINE")
        self.system_status.setStyleSheet(
            f"color:{RED.name() if detected else GREEN.name()}; font-size:10px; font-weight:700;"
        )
        if detected and not self.last_detected:
            self.event_count += 1
            self.metric_events.set_value(str(self.event_count))
            self.add_event("MOVEMENT THRESHOLD CROSSED", RED.name())
        self.last_detected = detected
        self.radar.set_state(detected, score)

    def animate(self):
        self.radar.angle = (self.radar.angle + 2.6) % 360
        self.radar.update()


def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
