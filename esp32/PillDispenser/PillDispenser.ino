#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>
#include "driver/gpio.h"

// ================= SUPABASE CONFIG =================
const char* SUPABASE_URL = "https://vtnxediirkonmxgtpzgx.supabase.co";
const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0bnhlZGlpcmtvbm14Z3Rwemd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NTM4NjYsImV4cCI6MjExMDQyOTg2Nn0.WIC-6lcLTkYcgoOzTQajylX_EVUigk7EI-sMrqvIydU";

// ================= HARDWARE CONFIG =================
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
LiquidCrystal_I2C lcd(0x27, 16, 2);

#define SERVO_MIN  150  // pulse for "0°"   = full speed one direction (360° servo)
#define SERVO_MAX  600  // pulse for "180°" = full speed other direction

// ---------- 360° CONTINUOUS SERVO TUNING ----------
// On a 360° servo the signal sets SPEED, not position: 90 = stop, below 90 = one way, above 90 = the other.
// So one dispense = spin for SPIN_MS, then cut the signal to stop.
const int  STOP_POINT  = 90;    // "stop" value. If a servo creeps while stopped, it's cut off anyway (see stopServo)
const int  SPIN_SPEED  = 50;    // 1-90: how fast to spin (offset from STOP_POINT). Higher = faster + wider swing
const unsigned long SPIN_MS   = 750;  // how long one dispense spins = HOW WIDE the arm swings. Wider -> raise, too far -> lower
const unsigned long SETTLE_MS = 300;  // pause after stopping before the next pill
const bool ALTERNATE_DIRECTION = true; // true = left, then right, then left... (like the original code)
                                       // false = always spin the same way (use for a rotating disc/wheel)

const uint8_t NUM_SLOTS = 4;
const uint8_t buttonPins[NUM_SLOTS]    = {16, 17, 18, 19};
const uint8_t servoChannels[NUM_SLOTS] = {0, 1, 2, 3};

bool spinLeftNext[NUM_SLOTS] = {true, true, true, true};  // first dispense goes LEFT

struct SlotData {
  String pillName;
  int stock;
};
SlotData slots[NUM_SLOTS] = {
  {"Slot 1", 0}, {"Slot 2", 0}, {"Slot 3", 0}, {"Slot 4", 0}
};
bool stockKnown = false;  // false until first successful sync (offline boot = don't block manual)

// ================= ACTION TYPES =================
enum ActionType : uint8_t { ACT_MANUAL = 0, ACT_SCHEDULE = 1, ACT_REMOTE = 2 };
const char* ACTION_DB[]  = {"dispense_button", "dispense_schedule", "dispense_web"};
const char* ACTION_LCD[] = {"MANUAL", "SCHEDULED", "REMOTE"};

// ================= NTP (Philippine Standard Time = UTC+8) =================
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 8 * 3600;
const int   daylightOffset_sec = 0;
const int   SCHEDULE_CATCHUP_MIN = 2;  // still fire a schedule up to 2 min late

// ================= SYNC TIMING (optimized) =================
// Slots + web dispense requests: checked every 10s (web "Dispense" takes up to ~10s to start).
// Schedules: downloaded once a minute and checked LOCALLY every second, so doses still fire on time
// without hitting Supabase constantly.
const unsigned long SLOT_SYNC_INTERVAL     = 10000;
const unsigned long SCHEDULE_FETCH_INTERVAL = 60000;
const unsigned long SCHEDULE_CHECK_INTERVAL = 1000;
const unsigned long FLUSH_RETRY_INTERVAL    = 15000;  // retry sending logs this often if Supabase fails

unsigned long lastSlotSync = 0;
unsigned long lastScheduleFetch = 0;
unsigned long lastScheduleCheck = 0;
bool schedulesLoaded = false;
unsigned long lastFlushAttempt = 0;
bool lastFlushOk = true;
unsigned long lastButtonAction = 0;
unsigned long idleScreenAt = 0;

// ================= BUTTONS (interrupt driven) =================
// Interrupts catch presses even while the ESP32 is busy talking to Supabase.
// One flag per slot = at most ONE manual dispense waiting per slot (extra presses while busy are ignored).
volatile bool btnFlag[NUM_SLOTS] = {false, false, false, false};
volatile unsigned long btnLastEdge[NUM_SLOTS] = {0, 0, 0, 0};
const unsigned long BTN_STABLE_MS = 50;

// A press counts only if the pin goes LOW after being quiet for 50ms (rejects press & release bounce).
void IRAM_ATTR onButton(void* arg) {
  uint8_t i = (uint8_t)(uintptr_t)arg;
  unsigned long now = millis();
  bool pressed = gpio_get_level((gpio_num_t)buttonPins[i]) == 0;
  if (pressed && (now - btnLastEdge[i]) >= BTN_STABLE_MS) {
    btnFlag[i] = true;
  }
  btnLastEdge[i] = now;
}

// ================= OFFLINE-SAFE RECORD QUEUE =================
struct PendingRecord {
  uint8_t slot;    // 1..4
  uint8_t qty;
  uint8_t action;  // ActionType
};
const uint8_t QUEUE_SIZE = 32;
PendingRecord recQueue[QUEUE_SIZE];
uint8_t qHead = 0, qCount = 0;
int queuedQty[NUM_SLOTS] = {0, 0, 0, 0};

// ================= LOCAL SCHEDULE CACHE =================
struct CachedSchedule {
  String id;
  uint8_t slot;
  int minuteOfDay;
  uint8_t qty;
  uint8_t daysMask;   // bit 0 = Sun ... bit 6 = Sat
  String lastDate;    // last_triggered_date
};
const uint8_t MAX_SCHEDULES = 24;
CachedSchedule schedCache[MAX_SCHEDULES];
uint8_t schedCount = 0;

// ================= HELPER FUNCTIONS =================
uint16_t angleToPulse(int angle) {
  angle = constrain(angle, 0, 180);
  return map(angle, 0, 180, SERVO_MIN, SERVO_MAX);
}

// Cuts the PWM signal completely -> 360° servo stops dead (no creeping/jitter).
void stopServo(uint8_t channel) {
  pwm.setPWM(channel, 0, 4096);  // 4096 = full OFF on PCA9685
}

String lcdLine1Cache, lcdLine2Cache;
void updateLCD(String line1, String line2) {
  line1 = line1.substring(0, 16);
  line2 = line2.substring(0, 16);
  if (line1 == lcdLine1Cache && line2 == lcdLine2Cache) return;  // avoid flicker
  lcdLine1Cache = line1;
  lcdLine2Cache = line2;
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

void showIdleScreen() {
  String top = (WiFi.status() == WL_CONNECTED) ? "Pill Dispenser" : "Offline-Manual";
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10)) {
    char timeStr[17];
    strftime(timeStr, sizeof(timeStr), "%I:%M %p %a", &timeinfo);
    updateLCD(top, String(timeStr));
  } else {
    updateLCD(top, "Press Btn 1 - 4");
  }
}

// ================= SUPABASE REST HELPER =================
bool supabaseRequest(const String& method, const String& endpoint, const String& payload,
                     String& response, const char* prefer = nullptr) {
  response = "";
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(5000);
  String url = String(SUPABASE_URL) + "/rest/v1/" + endpoint;
  if (!http.begin(client, url)) return false;

  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");
  if (prefer) http.addHeader("Prefer", prefer);

  int httpCode = 0;
  if (method == "GET")        httpCode = http.GET();
  else if (method == "POST")  httpCode = http.POST(payload);
  else if (method == "PATCH") httpCode = http.PATCH(payload);

  if (httpCode > 0) response = http.getString();
  http.end();

  if (httpCode < 200 || httpCode >= 300) {
    Serial.printf("[HTTP] %s %s -> %d %s\n", method.c_str(), endpoint.c_str(), httpCode, response.c_str());
    return false;
  }
  return true;
}

// ================= RECORD QUEUE =================
bool enqueueRecord(uint8_t slotNum, uint8_t qty, uint8_t action) {
  if (qCount >= QUEUE_SIZE) {
    Serial.println("[QUEUE] full, record dropped");
    return false;
  }
  uint8_t pos = (qHead + qCount) % QUEUE_SIZE;
  recQueue[pos] = {slotNum, qty, action};
  qCount++;
  queuedQty[slotNum - 1] += qty;
  return true;
}

// Sends the oldest queued record via the record_dispense RPC.
bool flushOneRecord() {
  if (qCount == 0) return true;
  PendingRecord& r = recQueue[qHead];

  JsonDocument doc;
  doc["p_slot"]   = r.slot;
  doc["p_qty"]    = r.qty;
  doc["p_action"] = ACTION_DB[r.action];
  String body, resp;
  serializeJson(doc, body);

  if (!supabaseRequest("POST", "rpc/record_dispense", body, resp)) return false;

  int idx = r.slot - 1;
  queuedQty[idx] -= r.qty;
  int serverStock = resp.toInt();  // RPC returns the new stock as a plain number
  slots[idx].stock = max(0, serverStock - queuedQty[idx]);

  qHead = (qHead + 1) % QUEUE_SIZE;
  qCount--;
  return true;
}

// ================= DISPENSE (one timed spin = one pill) =================
void spinOnce(uint8_t idx) {
  uint8_t ch = servoChannels[idx];
  bool goLeft = spinLeftNext[idx];
  int speedAngle = goLeft ? (STOP_POINT - SPIN_SPEED) : (STOP_POINT + SPIN_SPEED);

  pwm.setPWM(ch, 0, angleToPulse(speedAngle));
  delay(SPIN_MS);
  stopServo(ch);
  delay(SETTLE_MS);

  if (ALTERNATE_DIRECTION) spinLeftNext[idx] = !spinLeftNext[idx];
}

// Dispenses `qty` pills from slot idx, one at a time. Returns how many were dispensed.
int dispensePills(uint8_t idx, int qty, uint8_t action) {
  int slotNum = idx + 1;

  if (stockKnown && slots[idx].stock <= 0) {
    updateLCD("Slot " + String(slotNum) + " EMPTY", "Refill needed");
    idleScreenAt = millis() + 2000;
    return 0;
  }
  if (stockKnown) qty = min(qty, slots[idx].stock);
  if (qty <= 0) return 0;

  for (int q = 0; q < qty; q++) {
    updateLCD(String(ACTION_LCD[action]) + " S" + String(slotNum) + " " + String(q + 1) + "/" + String(qty),
              slots[idx].pillName);
    spinOnce(idx);
  }

  slots[idx].stock = max(0, slots[idx].stock - qty);
  enqueueRecord(slotNum, qty, action);

  updateLCD(String(ACTION_LCD[action]) + ": " + String(qty) + " pc",
            "Left: " + String(slots[idx].stock) + " pills");
  idleScreenAt = millis() + 1500;
  return qty;
}

// ================= MANUAL BUTTONS =================
// 1 press = 1 pill. One slot at a time.
void handleButtons() {
  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    if (btnFlag[i]) {
      btnFlag[i] = false;
      dispensePills(i, 1, ACT_MANUAL);
      lastButtonAction = millis();
    }
  }
}

// ================= SYNC SLOTS + REMOTE (WEB) REQUESTS =================
void syncSlots() {
  String resp;
  if (!supabaseRequest("GET",
        "dispenser_slots?select=slot_number,pill_name,current_stock,remote_dispense_qty&order=slot_number.asc",
        "", resp)) return;

  int remoteReq[NUM_SLOTS] = {0, 0, 0, 0};
  {
    JsonDocument doc;
    if (deserializeJson(doc, resp)) return;
    for (JsonObject row : doc.as<JsonArray>()) {
      int sNum = row["slot_number"];
      if (sNum < 1 || sNum > NUM_SLOTS) continue;
      int idx = sNum - 1;
      slots[idx].pillName = row["pill_name"].as<String>();
      // Server stock minus pills dispensed but not yet reported.
      slots[idx].stock = max(0, (int)row["current_stock"] - queuedQty[idx]);
      remoteReq[idx] = row["remote_dispense_qty"] | 0;
    }
    stockKnown = true;
  }

  // Web requests, one slot at a time.
  for (uint8_t idx = 0; idx < NUM_SLOTS; idx++) {
    if (remoteReq[idx] <= 0) continue;

    // Claim FIRST (reset to 0 only if still > 0) so a request is never dispensed twice.
    String claimResp;
    String endpoint = "dispenser_slots?slot_number=eq." + String(idx + 1) + "&remote_dispense_qty=gt.0";
    if (!supabaseRequest("PATCH", endpoint, "{\"remote_dispense_qty\":0}", claimResp, "return=representation")) continue;
    if (claimResp.length() < 3) continue;  // "[]" = cancelled from the web

    dispensePills(idx, remoteReq[idx], ACT_REMOTE);
    handleButtons();
  }
}

// ================= SCHEDULES =================
// Download all active schedules (once a minute).
void fetchSchedules() {
  String resp;
  if (!supabaseRequest("GET",
        "pill_schedules?is_active=eq.true&select=id,slot_number,schedule_time,dose_qty,days_of_week,last_triggered_date",
        "", resp)) return;

  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;

  schedCount = 0;
  for (JsonObject s : doc.as<JsonArray>()) {
    if (schedCount >= MAX_SCHEDULES) break;
    CachedSchedule& c = schedCache[schedCount];
    String t = s["schedule_time"].as<String>();  // "HH:MM:SS"
    c.id = s["id"].as<String>();
    c.slot = s["slot_number"] | 0;
    c.minuteOfDay = t.substring(0, 2).toInt() * 60 + t.substring(3, 5).toInt();
    c.qty = s["dose_qty"] | 1;
    c.daysMask = 0;
    for (int d : s["days_of_week"].as<JsonArray>()) {
      if (d >= 0 && d <= 6) c.daysMask |= (1 << d);
    }
    c.lastDate = s["last_triggered_date"].isNull() ? "" : s["last_triggered_date"].as<String>();
    schedCount++;
  }
  schedulesLoaded = true;
}

// Check the cached schedules against the clock (every second, no network unless a dose is due).
void checkSchedulesLocal() {
  if (!schedulesLoaded) return;
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10)) return;

  char currentDate[11];
  strftime(currentDate, sizeof(currentDate), "%Y-%m-%d", &timeinfo);
  int nowMin = timeinfo.tm_hour * 60 + timeinfo.tm_min;
  uint8_t todayBit = 1 << timeinfo.tm_wday;

  for (uint8_t i = 0; i < schedCount; i++) {
    CachedSchedule& c = schedCache[i];
    if (!(c.daysMask & todayBit)) continue;
    if (c.lastDate == currentDate) continue;
    int late = nowMin - c.minuteOfDay;
    if (late < 0 || late > SCHEDULE_CATCHUP_MIN) continue;

    // Mark as done locally right away so we don't retry every second.
    c.lastDate = currentDate;

    // Claim in Supabase: only succeeds if not yet triggered today -> never double-doses.
    String claimResp;
    String endpoint = "pill_schedules?id=eq." + c.id +
                      "&or=(last_triggered_date.is.null,last_triggered_date.neq." + String(currentDate) + ")";
    String body = "{\"last_triggered_date\":\"" + String(currentDate) + "\"}";
    if (!supabaseRequest("PATCH", endpoint, body, claimResp, "return=representation")) {
      c.lastDate = "";  // network failed -> allow a retry next second (still within catch-up window)
      continue;
    }
    if (claimResp.length() < 3) continue;  // already triggered (or schedule was deleted/paused)

    if (c.slot >= 1 && c.slot <= NUM_SLOTS) {
      dispensePills(c.slot - 1, c.qty, ACT_SCHEDULE);
      handleButtons();
    }
  }
}

// ================= SETUP & LOOP =================
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);

  lcd.init();
  lcd.backlight();
  updateLCD("Pill Dispenser", "Booting...");

  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  delay(10);

  // 360° servos: make sure all are STOPPED on boot.
  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    stopServo(servoChannels[i]);
  }

  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    pinMode(buttonPins[i], INPUT_PULLUP);
    attachInterruptArg(digitalPinToInterrupt(buttonPins[i]), onButton, (void*)(uintptr_t)i, CHANGE);
  }

  updateLCD("WiFi Setup Mode", "AP: PillBox_AP");
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  if (!wm.autoConnect("PillBox_AP")) {
    updateLCD("WiFi Offline", "Manual Mode Only");
    delay(2000);
  } else {
    WiFi.setAutoReconnect(true);
    updateLCD("WiFi Connected!", WiFi.localIP().toString());
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    delay(1500);
    syncSlots();
    fetchSchedules();
    lastSlotSync = lastScheduleFetch = millis();
  }

  // Ignore presses that happened during boot / WiFi setup.
  for (uint8_t i = 0; i < NUM_SLOTS; i++) btnFlag[i] = false;
  showIdleScreen();
}

void loop() {
  unsigned long now = millis();

  // 1. Manual buttons always first.
  handleButtons();

  // 2. Report queued dispenses (not right after a press, so rapid presses stay snappy).
  if (qCount > 0 && WiFi.status() == WL_CONNECTED &&
      now - lastButtonAction > 1000 &&
      now - lastFlushAttempt > (lastFlushOk ? 200UL : FLUSH_RETRY_INTERVAL)) {
    lastFlushAttempt = now;
    lastFlushOk = flushOneRecord();
    handleButtons();
  }

  if (WiFi.status() == WL_CONNECTED) {
    // 3. Slots + web dispense requests every 10s.
    if (now - lastSlotSync >= SLOT_SYNC_INTERVAL) {
      lastSlotSync = now;
      syncSlots();
      handleButtons();
    }

    // 4. Refresh schedule list once a minute.
    if (now - lastScheduleFetch >= SCHEDULE_FETCH_INTERVAL) {
      lastScheduleFetch = now;
      fetchSchedules();
    }
  }

  // 5. Check schedules locally every second (works from cache).
  if (now - lastScheduleCheck >= SCHEDULE_CHECK_INTERVAL) {
    lastScheduleCheck = now;
    checkSchedulesLocal();
  }

  // 6. Back to the idle clock after a dispense message.
  if (millis() >= idleScreenAt) showIdleScreen();

  delay(5);
}
