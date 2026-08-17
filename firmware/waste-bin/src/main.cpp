// Proxies waste-bin node — reference firmware (P3.W2).
//
// Implements the platform envelope from docs/TELEMETRY.md on an ESP32:
//   - Ed25519 keypair generated on first boot, kept in NVS
//   - one-time-code enrollment against /devices/enroll
//   - median-of-5 ultrasonic fill sampling with per-bin calibration
//   - canonical-JSON signing (sorted keys, JS-compatible number format)
//   - strictly monotonic seq with store-and-forward on send failure
//   - deep sleep between cycles
//
// BENCH_MODE (default) uses WiFi + a 30s cycle for desk testing against the
// compose stack; field builds swap the transport for cellular (see README).

#include <Arduino.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Ed25519.h>
#include <SHA256.h>
#include "config.h"

#ifdef BENCH_MODE
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#endif

// ---- Persistent identity ----------------------------------------------------
Preferences prefs;
static uint8_t privateKey[32];
static uint8_t publicKey[32];
static String deviceId;

// Readings kept across deep sleep so a failed send retries next cycle.
typedef struct {
  time_t ts;
  float fillPct;
  float battery;
} BufferedReading;
RTC_DATA_ATTR static BufferedReading pending[MAX_BUFFERED_READINGS];
RTC_DATA_ATTR static int pendingCount = 0;

// ---- Small helpers ----------------------------------------------------------
static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static String base64Encode(const uint8_t *data, size_t len) {
  String out;
  out.reserve(((len + 2) / 3) * 4);
  for (size_t i = 0; i < len; i += 3) {
    uint32_t n = (uint32_t)data[i] << 16;
    if (i + 1 < len) n |= (uint32_t)data[i + 1] << 8;
    if (i + 2 < len) n |= data[i + 2];
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += (i + 1 < len) ? B64[(n >> 6) & 63] : '=';
    out += (i + 2 < len) ? B64[n & 63] : '=';
  }
  return out;
}

// JS-compatible number formatting: up to 2 decimals, trailing zeros stripped,
// no decimal point on integers. MUST match the server's JSON.stringify view of
// the values we send (we round everything to 2dp before formatting).
static String formatNumber(float value) {
  float rounded = roundf(value * 100.0f) / 100.0f;
  char buf[24];
  snprintf(buf, sizeof(buf), "%.2f", rounded);
  String s(buf);
  while (s.endsWith("0")) s.remove(s.length() - 1);
  if (s.endsWith(".")) s.remove(s.length() - 1);
  if (s == "-0") s = "0";
  return s;
}

static String isoTime(time_t t) {
  struct tm tmv;
  gmtime_r(&t, &tmv);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S.000Z", &tmv);
  return String(buf);
}

static String sha256Hex(const String &input) {
  SHA256 sha;
  uint8_t digest[32];
  sha.reset();
  sha.update((const uint8_t *)input.c_str(), input.length());
  sha.finalize(digest, sizeof(digest));
  static const char *hex = "0123456789abcdef";
  String out;
  out.reserve(64);
  for (int i = 0; i < 32; i++) {
    out += hex[digest[i] >> 4];
    out += hex[digest[i] & 15];
  }
  return out;
}

// Canonical JSON for one reading: keys in sorted order — battery, ts, type,
// unit, value — matching the server's canonicalJson (undefined fields simply
// omitted, but ordering here is already alphabetical).
static String readingJson(const BufferedReading &r) {
  String out = "{\"battery\":";
  out += formatNumber(r.battery);
  out += ",\"ts\":\"";
  out += isoTime(r.ts);
  out += "\",\"type\":\"fill_pct\",\"unit\":\"%\",\"value\":";
  out += formatNumber(r.fillPct);
  out += "}";
  return out;
}

static String readingsJson() {
  String out = "[";
  for (int i = 0; i < pendingCount; i++) {
    if (i) out += ",";
    out += readingJson(pending[i]);
  }
  out += "]";
  return out;
}

// ---- Sensors ----------------------------------------------------------------
static float readDistanceCmOnce() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);
  if (us == 0) return NAN;
  return (float)us / 58.0f;
}

// Median of 5 — single ultrasonic reads lie on loose bags and rain.
static float readFillPct() {
  float samples[5];
  int n = 0;
  for (int i = 0; i < 5; i++) {
    float d = readDistanceCmOnce();
    if (!isnan(d)) samples[n++] = d;
    delay(60);
  }
  if (n == 0) return NAN;
  for (int i = 1; i < n; i++)
    for (int j = i; j > 0 && samples[j - 1] > samples[j]; j--) {
      float t = samples[j];
      samples[j] = samples[j - 1];
      samples[j - 1] = t;
    }
  float distance = samples[n / 2];
  float fill = (EMPTY_DISTANCE_CM - distance) / (EMPTY_DISTANCE_CM - FULL_DISTANCE_CM) * 100.0f;
  return constrain(fill, 0.0f, 100.0f);
}

static float readBatteryPct() {
  // TODO(pilot): divider on VBAT → calibrated percent. Bench: nominal.
  return 88.0f;
}

// ---- Networking -------------------------------------------------------------
#ifdef BENCH_MODE
static bool netUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  if (WiFi.status() != WL_CONNECTED) return false;
  configTime(0, 0, "pool.ntp.org");
  for (int i = 0; i < 20 && time(nullptr) < 1600000000; i++) delay(250);
  return time(nullptr) >= 1600000000;
}

// Returns HTTP status, fills response body.
static int httpPost(const String &path, const String &body, String &response) {
  HTTPClient http;
  http.begin(String(SERVER_BASE_URL) + path);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int status = http.POST(body);
  response = http.getString();
  http.end();
  return status;
}
#else
#error "Field build: swap netUp()/httpPost() for the cellular transport (TinyGSM) — see README.md"
#endif

// ---- Identity & enrollment --------------------------------------------------
static void loadOrCreateKeys() {
  prefs.begin("proxies", false);
  if (prefs.getBytes("privkey", privateKey, 32) != 32) {
    Ed25519::generatePrivateKey(privateKey);
    Ed25519::derivePublicKey(publicKey, privateKey);
    prefs.putBytes("privkey", privateKey, 32);
    prefs.putBytes("pubkey", publicKey, 32);
    Serial.println("[identity] new keypair generated");
  } else {
    prefs.getBytes("pubkey", publicKey, 32);
  }
  deviceId = prefs.getString("deviceId", "");
}

static bool ensureEnrolled() {
  if (deviceId.length()) return true;
  String body = "{\"enrollmentCode\":\"" ENROLLMENT_CODE "\",\"publicKey\":\"" +
                base64Encode(publicKey, 32) + "\",\"platform\":\"esp32-waste-bin\"}";
  String response;
  int status = httpPost("/devices/enroll", body, response);
  if (status != 200) {
    Serial.printf("[enroll] failed (%d): %s\n", status, response.c_str());
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, response) || !doc["deviceId"].is<const char *>()) return false;
  deviceId = String((const char *)doc["deviceId"]);
  prefs.putString("deviceId", deviceId);
  Serial.printf("[enroll] enrolled as %s\n", deviceId.c_str());
  return true;
}

// ---- Batch send -------------------------------------------------------------
static bool sendPending() {
  if (pendingCount == 0) return true;
  uint32_t seq = prefs.getUInt("seq", 0) + 1;
  String timestamp = isoTime(time(nullptr));
  String readings = readingsJson();

  String signingString = "proxies-telemetry\n" + deviceId + "\n" + String(seq) + "\n" +
                         timestamp + "\n" + sha256Hex(readings);
  uint8_t signature[64];
  Ed25519::sign(signature, privateKey, publicKey,
                (const uint8_t *)signingString.c_str(), signingString.length());

  String body = "{\"deviceId\":\"" + deviceId + "\",\"seq\":" + String(seq) +
                ",\"timestamp\":\"" + timestamp + "\",\"signature\":\"" +
                base64Encode(signature, 64) + "\",\"readings\":" + readings + "}";
  String response;
  int status = httpPost("/telemetry", body, response);
  if (status == 200 || status == 409) {
    // 409 = an earlier attempt was accepted but the ack was lost; either way
    // the seq is burned server-side, so advance and clear.
    prefs.putUInt("seq", seq);
    pendingCount = 0;
    Serial.printf("[send] seq %u -> %d %s\n", seq, status, response.c_str());
    return true;
  }
  Serial.printf("[send] failed (%d), buffering %d readings: %s\n", status, pendingCount,
                response.c_str());
  return false;
}

// ---- Main cycle -------------------------------------------------------------
static void sampleAndBuffer() {
  float fill = readFillPct();
  if (isnan(fill) || pendingCount >= MAX_BUFFERED_READINGS) return;
  pending[pendingCount].ts = time(nullptr);
  pending[pendingCount].fillPct = fill;
  pending[pendingCount].battery = readBatteryPct();
  pendingCount++;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  loadOrCreateKeys();

  // The RTC keeps time across deep sleep, so after the first NTP sync we can
  // sample (and buffer) even with the network down — store-and-forward.
  bool sampled = false;
  if (time(nullptr) >= 1600000000) {
    sampleAndBuffer();
    sampled = true;
  }

  if (netUp()) {
    if (!sampled) sampleAndBuffer();
    if (ensureEnrolled()) {
      sendPending();
    }
  } else {
    Serial.printf("[net] unreachable; %d readings buffered\n", pendingCount);
  }

  prefs.end();
  Serial.printf("[sleep] %ds\n", REPORT_INTERVAL_S);
  esp_sleep_enable_timer_wakeup((uint64_t)REPORT_INTERVAL_S * 1000000ULL);
  esp_deep_sleep_start();
}

void loop() {}
