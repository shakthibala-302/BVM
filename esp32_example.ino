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
