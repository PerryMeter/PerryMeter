   #define RADAR_RX 7   // Feather RX hole
   #define RADAR_TX 8   // Feather TX hole

   unsigned long last = 0, count = 0;

   void setup() {
     Serial.begin(921600);
     Serial1.begin(256000, SERIAL_8N1, RADAR_RX, RADAR_TX);
   }

   void loop() {
     while (Serial1.available()) { Serial1.read(); count++; }
     if (millis() - last >= 1000) {
       last = millis();
       Serial.printf("alive - bytes from radar in last second: %lu\n", count);
       count = 0;
     }
   }