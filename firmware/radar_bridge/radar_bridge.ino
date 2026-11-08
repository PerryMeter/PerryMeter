// RadarPing radar bridge: HLK-LD2410C -> Adafruit Feather ESP32 V2 -> USB -> laptop/Pi.
// Passes the radar's raw bytes straight through, untouched, in both directions.
// radar_test.py, radar_plot.py and radar_server.py read these bytes and decode
// the radar frames (they start with F4 F3 F2 F1).
//
// Wiring: radar VCC -> Feather USB (5 V), GND -> GND,
//         radar TX -> Feather RX (GPIO 7), radar RX -> Feather TX (GPIO 8), OUT unused.
// Arduino IDE: board "Adafruit Feather ESP32 V2", core "esp32 by Espressif Systems".

#define RADAR_RX 7   // Feather RX hole, wired to the radar's TX
#define RADAR_TX 8   // Feather TX hole, wired to the radar's RX

void setup() {
  Serial.begin(921600);                                  // USB to laptop
  Serial1.begin(256000, SERIAL_8N1, RADAR_RX, RADAR_TX); // the radar
}

void loop() {
  while (Serial1.available()) Serial.write(Serial1.read());  // radar to laptop
  while (Serial.available())  Serial1.write(Serial.read());  // laptop to radar
}
