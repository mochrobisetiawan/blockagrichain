/*
 * ESP32-CAM -> HTTP multipart upload -> server Python (Flask)
 * - Capture JPEG setiap 15 detik
 * - Kirim raw JPEG via POST multipart/form-data (field "image")
 * - LED notifikasi dinonaktifkan; info status via Serial print
 * Board: AI Thinker ESP32-CAM
 *
 * Tidak perlu library tambahan: WiFi.h + HTTPClient.h sudah bawaan core ESP32.
 */
#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ---- WiFi ----
const char* WIFI_SSID = "PATAS";
const char* WIFI_PASS = "YEHBIU12";

// ---- Server API ----
// Ganti IP/port sesuai server Flask kamu. Endpoint: /upload
const char* UPLOAD_URL = "http://117.53.45.132:5000/upload";
const char* DEVICE_ID  = "01";
const unsigned long CAPTURE_INTERVAL_MS = 13000;  // 10 detik

// ---- AI Thinker ESP32-CAM pin map ----
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;   config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM; config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM; config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;   config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA;   // 640x480
    config.jpeg_quality = 12;
    config.fb_count = 2;
    Serial.println("[*] PSRAM ditemukan -> VGA 640x480");
  } else {
    config.frame_size = FRAMESIZE_QVGA;  // 320x240
    config.jpeg_quality = 15;
    config.fb_count = 1;
    Serial.println("[*] PSRAM tidak ada -> QVGA 320x240");
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[!] Camera init gagal (0x%x), restart...\n", err);
    delay(3000);
    ESP.restart();
  }
  Serial.println("[+] Kamera siap.");
}

void connectWiFi() {
  Serial.printf("[*] Menghubungkan WiFi SSID: %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\n[+] WiFi terhubung. IP: %s | RSSI: %d dBm\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

// Bangun body multipart secara manual, lalu kirim via HTTPClient.
void uploadImage() {
  Serial.println("[*] Mengambil gambar...");
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("[!] Capture gagal"); return; }
  Serial.printf("[+] Gambar diambil: %u bytes\n", fb->len);

  const char* boundary = "----esp32camBoundary";

  String head = "--";
  head += boundary;
  head += "\r\nContent-Disposition: form-data; name=\"image\"; filename=\"cam.jpg\"\r\n";
  head += "Content-Type: image/jpeg\r\n\r\n";

  String tail = "\r\n--";
  tail += boundary;
  tail += "--\r\n";

  size_t totalLen = head.length() + fb->len + tail.length();

  uint8_t* body = (uint8_t*) ps_malloc(totalLen);
  if (!body) body = (uint8_t*) malloc(totalLen);
  if (!body) {
    Serial.println("[!] Alokasi buffer gagal (RAM kurang)");
    esp_camera_fb_return(fb);
    return;
  }

  size_t pos = 0;
  memcpy(body + pos, head.c_str(), head.length());  pos += head.length();
  memcpy(body + pos, fb->buf, fb->len);             pos += fb->len;
  memcpy(body + pos, tail.c_str(), tail.length());  pos += tail.length();

  size_t rawLen = fb->len;
  esp_camera_fb_return(fb);

  Serial.printf("[*] Mengirim ke %s ...\n", UPLOAD_URL);
  HTTPClient http;
  http.begin(UPLOAD_URL);
  http.addHeader("Content-Type", String("multipart/form-data; boundary=") + boundary);
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Timestamp", String(millis()));

  unsigned long t0 = millis();
  int code = http.POST(body, totalLen);
  unsigned long dt = millis() - t0;

  if (code > 0) {
    Serial.printf("[+] Upload sukses | HTTP %d | raw %u B | %lu ms\n",
                  code, rawLen, dt);
    Serial.printf("    Respons server: %s\n", http.getString().c_str());
  } else {
    Serial.printf("[!] Upload gagal: %s\n", http.errorToString(code).c_str());
  }
  http.end();
  free(body);
  Serial.printf("[*] Free heap: %u bytes\n", ESP.getFreeHeap());
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ESP32-CAM HTTP Uploader ===");
  initCamera();
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[!] WiFi terputus, menyambung ulang...");
    connectWiFi();
  }
  uploadImage();
  Serial.printf("[*] Menunggu %lu detik...\n\n", CAPTURE_INTERVAL_MS / 1000);
  delay(CAPTURE_INTERVAL_MS);
}
