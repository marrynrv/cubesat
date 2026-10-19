#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <SparkFun_MS5803_I2C.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <TinyGPS++.h>

// =====================================================
// SETTINGS AND PINS
// =====================================================
const int BATTERY_PIN = A0;
const int SD_CHIP_SELECT = BUILTIN_SDCARD;

#define XBeeSerial Serial7
#define GPSSerial Serial2

const unsigned long SEND_INTERVAL = 1000; 
const String TEAM_ID = "ASTRA";

// SECRET KEY
const String SECRET_KEY = "ASTRA_2026_KEY"; 

unsigned long lastSendTime = 0;
unsigned long lastBaroTime = 0;
unsigned long missionStartTime = 0;

float rawAltitude = 0.0;
float filteredAltitude = 0.0;
float previousAltitude = 0.0;
float descentRate = 0.0;
float basePressure = 1013.25; 

String currentLat = "0.000000";
String currentLng = "0.000000";
String currentGpsAlt = "0.0";
int currentSatellites = 0; 

float pitch = 0.0, roll = 0.0, yaw = 0.0;
float pitchOffset = 0.0, rollOffset = 0.0;
float gyroXOffset = 0.0, gyroYOffset = 0.0, gyroZOffset = 0.0;

unsigned long previousImuMicros = 0; 
const float ALPHA = 0.98; 
bool mpuReady = false; 
bool sdCardReady = false;

MS5803 baro(ADDRESS_HIGH);
Adafruit_MPU6050 mpu;
TinyGPSPlus gps;
char fileName[64];

// Base64 table
const char base64_chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// =====================================================
// FIXED XOR + BASE64 ENCRYPTION (BYTE-WISE)
// =====================================================
String encodeEncrypted(String input, String key) {
  int len = input.length(); // Returns exact byte size (including UTF-8)
  if (len == 0) return "";

  // 1. Apply XOR to raw bytes
  uint8_t xor_bytes[len];
  int keyLen = key.length();
  for (int i = 0; i < len; i++) {
    xor_bytes[i] = ((uint8_t)input[i]) ^ ((uint8_t)key[i % keyLen]);
  }

  // 2. Standard Base64 encoder for byte array
  String encoded = "";
  encoded.reserve(((len + 2) / 3) * 4);

  int i = 0;
  uint8_t char_array_3[3];
  uint8_t char_array_4[4];

  for (int idx = 0; idx < len; idx++) {
    char_array_3[i++] = xor_bytes[idx];
    if (i == 3) {
      char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
      char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
      char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
      char_array_4[3] = char_array_3[2] & 0x3f;

      for (i = 0; i < 4; i++) encoded += base64_chars[char_array_4[i]];
      i = 0;
    }
  }

  if (i > 0) {
    for (int j = i; j < 3; j++) char_array_3[j] = '\0';

    char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
    char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
    char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);

    for (int j = 0; j < i + 1; j++) encoded += base64_chars[char_array_4[j]];
    while (i++ < 3) encoded += '=';
  }

  return encoded;
}

// Write encrypted string to ASTRA.sec
void writeToAstraSec(String rawText) {
  if (sdCardReady) {
    File myFile = SD.open(fileName, FILE_WRITE);
    if (myFile) {
      myFile.println(encodeEncrypted(rawText, SECRET_KEY));
      myFile.close();
    }
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================
float getBatteryVoltage() {
  float sum = 0;
  for(int i = 0; i < 20; i++) {
    sum += analogRead(BATTERY_PIN);
    delayMicroseconds(50);
  }
  float avgRaw = sum / 20.0;
  float pinVolts = (avgRaw * 3.30) / 1023.0; 
  return pinVolts * 3.818; 
}

float getCorrectPressurehPa() {
  float rawP = baro.getPressure(ADC_4096);
  while (rawP > 2000.0) rawP /= 10.0;
  return rawP;
}

String getIssErrorCode(float alt, float speed, int sats) {
  if (sats == 0 || currentLat == "0.000000") return "ERR_02";
  if (alt > 30.0 && (speed < 6.0 || speed > 8.0)) return "ERR_01";
  return "ERR_00";
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  XBeeSerial.begin(9600);
  GPSSerial.begin(9600);
  
  Wire.begin();
  Wire.setClock(400000);
  delay(300); 

  baro.reset();
  baro.begin();
  delay(200);

  float sumP = 0.0;
  for (int i = 0; i < 20; i++) {
    sumP += getCorrectPressurehPa();
    delay(20);
  }
  basePressure = sumP / 20.0;

  if (mpu.begin()) {
    mpuReady = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_2_G);
    mpu.setGyroRange(MPU6050_RANGE_250_DEG);

    float sumRoll = 0.0, sumPitch = 0.0;
    float sumGx = 0.0, sumGy = 0.0, sumGz = 0.0;

    for (int i = 0; i < 100; i++) {
      sensors_event_t a, g, temp;
      mpu.getEvent(&a, &g, &temp);
      sumRoll += atan2(a.acceleration.y, a.acceleration.z) * 180.0 / PI;
      sumPitch += atan2(-a.acceleration.x, sqrt(a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z)) * 180.0 / PI;
      sumGx += g.gyro.x; sumGy += g.gyro.y; sumGz += g.gyro.z;
      delay(4);
    }
    rollOffset = sumRoll / 100.0; pitchOffset = sumPitch / 100.0;
    gyroXOffset = sumGx / 100.0; gyroYOffset = sumGy / 100.0; gyroZOffset = sumGz / 100.0;
  }

  // Create ASTRA.sec file
  sprintf(fileName, "%s.sec", TEAM_ID.c_str());
  if (SD.begin(SD_CHIP_SELECT)) {
    sdCardReady = true;
    String header = "TEAM_ID,Time,Temp,Pressure,Altitude,DescentRate,Lat,Lng,GpsAlt,Volt,AccX,AccY,AccZ,GyroX,GyroY,GyroZ,Pitch,Roll,Yaw,ERR_CODE";
    writeToAstraSec(header);
    Serial.println("[SD CARD] ASTRA.sec file successfully created!");
  }

  missionStartTime = millis();
  lastSendTime = millis();
  lastBaroTime = millis();
  previousImuMicros = micros();
}

// =====================================================
// MAIN LOOP
// =====================================================
void loop() {
  // 1. GPS polling
  while (GPSSerial.available() > 0) gps.encode(GPSSerial.read());

  if (gps.satellites.isValid()) currentSatellites = gps.satellites.value();
  else currentSatellites = 0;

  if (gps.location.isValid() && gps.location.age() < 10000) {
    currentLat = String(gps.location.lat(), 6);
    currentLng = String(gps.location.lng(), 6);
  }
  if (gps.altitude.isValid() && gps.altitude.age() < 10000) {
    currentGpsAlt = String(gps.altitude.meters(), 1);
  }

  // 2. Receive commands and messages from Ground via XBee
  if (XBeeSerial.available() > 0) {
    String incoming = XBeeSerial.readStringUntil('\n');
    incoming.trim();

    if (incoming.startsWith("CMD:MSG:")) {
      String userMessage = incoming.substring(8);
      unsigned long timeSec = (millis() - missionStartTime) / 1000;
      
      String msgRow = "MSG," + String(timeSec) + "," + userMessage;
      
      // Save with byte-oriented encryption
      writeToAstraSec(msgRow);
      Serial.println("[SD LOG] Message saved: " + userMessage);
    }
  }

  // 3. Barometer polling
  unsigned long currentMillis = millis();
  if (currentMillis - lastBaroTime >= 50) {
    lastBaroTime = currentMillis;

    float pressure = getCorrectPressurehPa();
    rawAltitude = 44330.0 * (1.0 - pow(pressure / basePressure, 0.1903));

    float diff = abs(rawAltitude - filteredAltitude);
    if (diff > 0.3) {
      filteredAltitude = (rawAltitude * 0.80) + (filteredAltitude * 0.20);
    } else {
      filteredAltitude = (rawAltitude * 0.30) + (filteredAltitude * 0.70);
    }
    if (abs(filteredAltitude) < 0.10) filteredAltitude = 0.0;
  }

  // 4. MPU6050 polling
  sensors_event_t a = {0}, g = {0}, temp_mpu = {0};
  float gx = 0, gy = 0, gz = 0;

  unsigned long currentMicros = micros();
  float dt = (currentMicros - previousImuMicros) / 1000000.0;
  previousImuMicros = currentMicros;
  if (dt <= 0.0 || dt > 0.1) dt = 0.002;

  if (mpuReady) {
    mpu.getEvent(&a, &g, &temp_mpu);
    gx = (g.gyro.x - gyroXOffset) * 180.0 / PI;
    gy = (g.gyro.y - gyroYOffset) * 180.0 / PI;
    gz = (g.gyro.z - gyroZOffset) * 180.0 / PI;

    float accR = atan2(a.acceleration.y, a.acceleration.z) * 180.0 / PI - rollOffset;
    float accP = atan2(-a.acceleration.x, sqrt(a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z)) * 180.0 / PI - pitchOffset;

    roll = ALPHA * (roll + gx * dt) + (1.0 - ALPHA) * accR;
    pitch = ALPHA * (pitch + gy * dt) + (1.0 - ALPHA) * accP;
    if (abs(gz) > 0.05) yaw += gz * dt;
  }

  // 5. Telemetry transmission once per second
  if (currentMillis - lastSendTime >= SEND_INTERVAL) {
    lastSendTime += SEND_INTERVAL;

    float totalBatteryVoltage = getBatteryVoltage();
    float pressure = getCorrectPressurehPa();
    float temperature = baro.getTemperature(CELSIUS, ADC_4096);
    
    descentRate = (previousAltitude - filteredAltitude);
    if (abs(descentRate) < 0.05) descentRate = 0.0;
    previousAltitude = filteredAltitude;

    unsigned long timeSec = (currentMillis - missionStartTime) / 1000;
    String errCode = getIssErrorCode(filteredAltitude, descentRate, currentSatellites);

    String csvRow = TEAM_ID + "," + String(timeSec) + "," + String(temperature, 1) + "," +
                    String(pressure, 1) + "," + String(filteredAltitude, 2) + "," +
                    String(descentRate, 2) + "," + currentLat + "," + currentLng + "," +
                    currentGpsAlt + "," + String(totalBatteryVoltage, 2) + "," +
                    String(a.acceleration.x, 2) + "," + String(a.acceleration.y, 2) + "," +
                    String(a.acceleration.z, 2) + "," + String(gx, 2) + "," +
                    String(gy, 2) + "," + String(gz, 2) + "," + String(pitch, 1) + "," +
                    String(roll, 1) + "," + String(yaw, 1) + "," + errCode;

    // Save telemetry in encrypted format
    writeToAstraSec(csvRow);

    // Build JSON for XBee
    String telemetryData = "{";
    telemetryData += "\"team_id\":\"" + TEAM_ID + "\",";
    telemetryData += "\"time\":" + String(timeSec) + ",";
    telemetryData += "\"temp\":" + String(temperature, 1) + ",";
    telemetryData += "\"pressure\":" + String(pressure, 1) + ",";
    telemetryData += "\"altitude\":" + String(filteredAltitude, 2) + ",";
    telemetryData += "\"descent_rate\":" + String(descentRate, 2) + ",";
    telemetryData += "\"lat\":" + currentLat + ",";
    telemetryData += "\"lng\":" + currentLng + ",";
    telemetryData += "\"gps_alt\":" + currentGpsAlt + ",";
    telemetryData += "\"battery\":" + String(totalBatteryVoltage, 2) + ",";
    telemetryData += "\"accX\":" + String(a.acceleration.x, 2) + ",";
    telemetryData += "\"accY\":" + String(a.acceleration.y, 2) + ",";
    telemetryData += "\"accZ\":" + String(a.acceleration.z, 2) + ",";
    telemetryData += "\"gyroX\":" + String(gx, 2) + ","; 
    telemetryData += "\"gyroY\":" + String(gy, 2) + ","; 
    telemetryData += "\"gyroZ\":" + String(gz, 2) + ","; 
    telemetryData += "\"pitch\":" + String(pitch, 1) + ",";
    telemetryData += "\"roll\":" + String(roll, 1) + ",";
    telemetryData += "\"yaw\":" + String(yaw, 1) + ",";
    telemetryData += "\"err_code\":\"" + errCode + "\"";
    telemetryData += "}";

    XBeeSerial.println(telemetryData);
    Serial.println(csvRow);
  }
}
