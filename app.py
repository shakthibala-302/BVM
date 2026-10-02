"""Display-only monitor for an ESP32 BVM test-lung prototype."""

import argparse
import json
import logging
import math
import os
import random
import time

from flask import Flask, render_template
from flask_socketio import SocketIO

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Study placeholders only. Edit these values for your prototype; they are not clinical protocols.
MODE_CONFIG = {
    "ASTHMA": {
        "label": "Asthma",
        "pressure_limit_kpa": 2.5,  # PLACEHOLDER
        "compression_time_s": 1.2,  # PLACEHOLDER
        "rate_per_min": 12,  # PLACEHOLDER
    },
    "ARDS": {
        "label": "ARDS",
        "pressure_limit_kpa": 2.0,  # PLACEHOLDER
        "compression_time_s": 1.2,  # PLACEHOLDER
        "rate_per_min": 12,  # PLACEHOLDER
    },
}

VALID_STATES = {"IDLE", "COMPRESS", "RELEASE", "STOPPED"}
VALID_MODES = set(MODE_CONFIG)
app = Flask(__name__)
socketio = SocketIO(app, async_mode="threading")
SIMULATED = False


def normalize_sample(payload):
    """Return a safe, consistently shaped sample, or None for malformed input."""
    if not isinstance(payload, dict):
        return None

    try:
        timestamp = payload["t"]
        pressure = payload["p_kpa"]
        cycle = payload["cycle"]
        state = payload["state"]
        mode = payload["mode"]
        limit_hit = payload["limit_hit"]
        if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)):
            return None
        if isinstance(pressure, bool) or not isinstance(pressure, (int, float)):
            return None
        if not math.isfinite(timestamp) or not math.isfinite(pressure):
            return None
        if isinstance(cycle, bool) or not isinstance(cycle, int) or cycle < 0:
            return None
        if state not in VALID_STATES or mode not in VALID_MODES:
            return None
        if not isinstance(limit_hit, bool):
            return None
    except (KeyError, TypeError):
        return None

    return {
        "t": timestamp,
        "p_kpa": pressure,
        "state": state,
        "cycle": cycle,
        "mode": mode,
        "limit_hit": limit_hit,
    }


@app.get("/")
def index():
    return render_template(
        "index.html", mode_config=MODE_CONFIG, simulated=SIMULATED
    )


def serial_reader(port, baud_rate):
    """Read newline-delimited JSON from the ESP32 and ignore bad lines."""
    import serial

    while True:
        try:
            logging.info("Connecting to serial port %s at %s baud", port, baud_rate)
            with serial.Serial(port, baudrate=baud_rate, timeout=1) as connection:
                logging.info("Serial connection opened")
                while True:
                    raw_line = connection.readline()
                    if not raw_line:
                        continue
                    try:
                        payload = json.loads(raw_line.decode("utf-8").strip())
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        continue
                    sample = normalize_sample(payload)
                    if sample is not None:
                        socketio.emit("sample", sample)
        except (serial.SerialException, OSError) as error:
            logging.warning("Serial connection unavailable: %s; retrying", error)
            socketio.sleep(2)


def simulation_reader():
    """Emit an approximately 12-cycle/minute stream for demos and development."""
    started = time.monotonic()
    while True:
        elapsed = time.monotonic() - started
        timestamp_ms = int(elapsed * 1000)
        cycle = int(elapsed // 5) + 1
        phase = elapsed % 5
        mode = "ASTHMA" if (cycle // 6) % 2 == 0 else "ARDS"
        config = MODE_CONFIG[mode]
        trip_cycle = cycle % 9 == 0
        peak = (
            config["pressure_limit_kpa"] * 1.04
            if trip_cycle
            else 1.15 + 0.35 * math.sin(cycle * 0.8) + random.uniform(-0.08, 0.08)
        )

        if phase < 1.2:
            state = "COMPRESS"
            pressure = 0.12 + peak * math.sin((phase / 1.2) * math.pi / 2)
            limit_hit = trip_cycle and phase >= 1.1 and pressure >= config["pressure_limit_kpa"] * 0.92
            if limit_hit:
                state = "STOPPED"
        else:
            state = "RELEASE"
            pressure = peak * math.exp(-(phase - 1.2) / 0.9)
            limit_hit = trip_cycle

        sample = {
            "t": timestamp_ms,
            "p_kpa": round(max(0.0, pressure), 3),
            "state": state,
            "cycle": cycle,
            "mode": mode,
            "limit_hit": limit_hit,
        }
        socketio.emit("sample", sample)
        socketio.sleep(0.05)


def main():
    parser = argparse.ArgumentParser(description="BVM test-lung prototype monitor")
    parser.add_argument("--port", default=os.environ.get("SERIAL_PORT"), help="ESP32 serial port, e.g. COM3 or /dev/ttyUSB0")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baud rate (default: 115200)")
    parser.add_argument("--simulate", action="store_true", help="Use clearly labelled generated demo data")
    parser.add_argument("--host", default="127.0.0.1", help="Web server host (default: 127.0.0.1)")
    parser.add_argument("--web-port", type=int, default=5000, help="Web server port (default: 5000)")
    args = parser.parse_args()

    global SIMULATED
    SIMULATED = args.simulate
    if args.simulate:
        socketio.start_background_task(simulation_reader)
    elif args.port:
        socketio.start_background_task(serial_reader, args.port, args.baud)
    else:
        logging.warning("No serial port configured. Start with --port or use --simulate.")

    socketio.run(app, host=args.host, port=args.web_port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
