# BVM Prototype Monitor

A display-only dashboard for an ESP32 motor-driven Bag-Valve-Mask (BVM) compression prototype connected to a test lung. It is a study and instrumentation project, not a medical device.

> **Prototype - test lung only. Not clinically validated.**
>
> Mode parameters in `app.py` are explicitly marked placeholders. They are not clinical protocols. Confirm pressure measurements against a reference gauge before interpreting them.

## Requirements

- Python 3.9 or newer
- An ESP32 connected by USB for live readings (optional when using simulation)

## Install

From this project folder, create and activate a virtual environment, then install the packages:

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

On Windows PowerShell, activate with `.venv\Scripts\Activate.ps1` and use `py` in place of `python3` where appropriate.

## Find the ESP32 serial port

- **Windows:** Open Device Manager, expand **Ports (COM & LPT)**, and note the ESP32 port such as `COM3`.
- **macOS:** Run `ls /dev/tty.*` before and after connecting the board. Select the new device, commonly `/dev/tty.usbserial-...` or `/dev/tty.usbmodem...`.
- **Linux:** Check `ls /dev/ttyUSB* /dev/ttyACM*`; the board commonly appears as `/dev/ttyUSB0` or `/dev/ttyACM0`.

The ESP32 serial monitor must emit one JSON object per line at 115200 baud, with fields `t`, `p_kpa`, `state`, `cycle`, `mode`, and `limit_hit`. Close other serial monitors before starting this app.

## Run with hardware

macOS / Linux:

```sh
python3 app.py --port /dev/tty.usbserial-XXXX
```

Windows:

```powershell
py app.py --port COM3
```

The baud rate defaults to 115200. Override it with `--baud`, for example `python3 app.py --port /dev/ttyUSB0 --baud 115200`. The port can also be supplied using the `SERIAL_PORT` environment variable. If no port is supplied, the dashboard starts in a waiting state and shows a data-delay warning until samples arrive.

Open <http://127.0.0.1:5000> in a browser.

## Run without hardware

```sh
python3 app.py --simulate
```

The page displays a persistent **SIMULATED DATA** label. This mode generates synthetic pressure samples and cycle events for interface development only; it is not sensor data or a test result.

## Dashboard notes

- The chart shows a rolling 30-second pressure trace and the selected mode's placeholder pressure limit.
- Pressure can be displayed in kPa or cmH₂O (1 kPa = 10.197 cmH₂O).
- CSV recording is browser-local and begins only after **Start recording** is pressed. The CSV contains timestamp in controller milliseconds, pressure in kPa, state, cycle, and mode.
- The application sends no commands to the motor. Its controls only switch display units or record/download received samples.
- Mode parameter placeholders are in the `MODE_CONFIG` dictionary near the top of `app.py`.

## ESP32 / Arduino example

The following standalone sketch prints the expected JSON line shape. Adapt `state`, `cycle`, `mode`, and `limitHit` to your controller firmware. This sample does not implement or command a motor.

```cpp
#include <Arduino.h>

const int PRESSURE_ADC_PIN = 34;
const float SENSOR_SUPPLY_V = 5.0f;
// For equal 100 kOhm divider resistors: V_sensor = V_adc * 2.
const float DIVIDER_RATIO = 2.0f;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
}

void loop() {
  // The sensor output can reach 4.7 V. Reduce it with a voltage divider
  // before the ESP32 ADC (maximum 3.3 V). Calibrate against a reference
  // gauge before use; this example is not a validated measurement system.
  const uint32_t t = millis();
  const uint32_t adcMilliVolts = analogReadMilliVolts(PRESSURE_ADC_PIN);
  const float adcVoltage = adcMilliVolts / 1000.0f;
  const float sensorVoltage = adcVoltage * DIVIDER_RATIO;

  // Datasheet relationship: Vout = Vs * (0.09 * P_kPa + 0.04).
  float pressureKpa = (sensorVoltage / SENSOR_SUPPLY_V - 0.04f) / 0.09f;
  if (pressureKpa < 0.0f) pressureKpa = 0.0f;

  // Replace these example values with read-only values from your controller.
  const char* state = "IDLE";  // IDLE | COMPRESS | RELEASE | STOPPED
  const uint32_t cycle = 0;
  const char* mode = "ASTHMA"; // ASTHMA | ARDS
  const bool limitHit = false;

  Serial.printf(
    "{\"t\":%lu,\"p_kpa\":%.3f,\"state\":\"%s\",\"cycle\":%lu,\"mode\":\"%s\",\"limit_hit\":%s}\n",
    static_cast<unsigned long>(t), pressureKpa, state,
    static_cast<unsigned long>(cycle), mode, limitHit ? "true" : "false"
  );
  delay(50);
}
```
