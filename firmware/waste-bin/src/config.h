#pragma once

// ---- Mode ------------------------------------------------------------------
// BENCH_MODE: WiFi transport + short cycle, for desk testing against the
// compose stack. Comment out for field builds (cellular — see README for the
// TinyGSM swap point).
#define BENCH_MODE 1

// ---- Identity / enrollment -------------------------------------------------
// One-time code from the provisioning manifest (provision-waste-*.csv).
// Consumed on first successful enrollment, then ignored.
#define ENROLLMENT_CODE "PASTE-CODE-HERE"

// ---- Server ----------------------------------------------------------------
#define SERVER_BASE_URL "http://192.168.1.20:3000"  // https:// in production

// ---- WiFi (bench mode only) ------------------------------------------------
#define WIFI_SSID "your-ssid"
#define WIFI_PASS "your-pass"

// ---- Ultrasonic (JSN-SR04T class) -----------------------------------------
#define PIN_TRIG 5
#define PIN_ECHO 18
// Calibration per bin, measured at install (see docs/PILOTS/waste.md).
#define EMPTY_DISTANCE_CM 110.0f
#define FULL_DISTANCE_CM 20.0f

// ---- Cycle -----------------------------------------------------------------
#ifdef BENCH_MODE
#define REPORT_INTERVAL_S 30
#else
#define REPORT_INTERVAL_S 3600
#endif

// Readings buffered across failed sends (store-and-forward), capped.
#define MAX_BUFFERED_READINGS 60
