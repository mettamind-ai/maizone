# MaiZone MV3 Extension — Architecture/Quality Review (Round 1)

## Context
Mình đang build một Chrome extension (MV3) tên MaiZone: “do one thing at a time”.
Core features:
- f01: Cảnh báo/chặn trang gây sao nhãng (webNavigation + content UI)
- f03/f04: Deep Work 40 phút + nhắc nghỉ (timer + badge + notification)
- f05: State management tập trung (sanitize + invariants + broadcast stateUpdated)

Mục tiêu kỹ thuật:
- Ít lỗi runtime (đặc biệt MV3 service worker lifecycle)
- Maintain dễ về sau (SRP, clean data flow, ít coupling)
- Không over-permission, ưu tiên privacy
- Vietnamese user-facing messages
- Không thêm dependency nặng/bundler (repo nhỏ, flat structure)

## Current Design (tóm tắt)
- `background.js`: entrypoint/orchestrator, init state + modules, handle command Alt+A
- `background_state.js`: DEFAULT_STATE + sanitize/invariants + updateState(delta) + broadcast `stateUpdated`
- `background_distraction.js`: webNavigation listeners + isDistractingWebsite + send warning to tab
- `background_breakReminder.js`: dùng `chrome.alarms` cho timer (MV3-safe)
- `popup.js/options.js`: ES module; dùng `messaging.js` + `state_helpers.js` để get/update state (fallback storage)
- `content.js`: chạy trên mọi trang; **classic script** (không dùng import) vì từng gặp lỗi “Cannot use import statement outside a module”; có local `sendMessageSafely` + gating theo `isEnabled`; không theo dõi password inputs.

## Incident / Symptom
Đã gặp runtime error trên một site:
`Uncaught SyntaxError: Cannot use import statement outside a module` tại `content.js: import ...`
=> giải pháp hiện tại: content script không dùng import, và manifest không ép module cho content script.

## Analysis Needed (hãy làm Pro work hard)
1) **Edge cases / Bugs I missed**
   - MV3 service worker sleep/wake: alarms, message channels, badge updates, notification reliability
   - State invariants có thể tạo “side effects” không mong muốn khi update partial
   - Race conditions giữa popup <-> background <-> content (đặc biệt khi tab đổi nhanh)
   - webNavigation events spam / multiple listeners / leaks

2) **Compare 3 alternatives (tradeoffs table)**
   - Code organization: giữ 4 file background modules vs merge 1 file vs partial merge (ex: keep `background_state` separate, merge 2 feature files)
   - Timer design: `chrome.alarms` vs setTimeout loop vs offscreen document/other
   - Content messaging: inline helper (hiện tại) vs dynamic import vs build step (bundler) — trong constraint “no bundler”

3) **Security implications**
   - Permission review: `tabs`, `webNavigation`, `<all_urls>`; có thể giảm/optional không?
   - Content script: theo dõi input (đã bỏ password) nhưng còn risk gì? (PII, overlay UI, clickjacking cảm giác, etc.)
   - Message validation: action payload có cần schema/whitelist để tránh misuse?

4) **Performance scaling**
   - 100 tabs / 1000 tabs: webNavigation + content listeners + storage access
   - Khi `isEnabled=false` thì chi phí còn bao nhiêu? có điểm nào vẫn chạy ngầm?

5) **Migration plan**
   - 3-phase plan để cải tiến maintainability + giảm quyền + tăng reliability, không phá UX hiện tại.

## Constraints
- Không thêm thư viện nặng/bundler
- Giữ structure phẳng, module ES6 (trừ content script nếu cần)
- Vietnamese strings cho user-facing UI
- Logging convention: 🌸 log thường, 🌸🌸🌸 cho errors
- Không được có bất kỳ code/tính năng liên quan Gemini/LLM key

## Deliverables
- [ ] Gaps analysis theo mức độ (P0/P1/P2) + lý do
- [ ] Bảng so sánh 3 alternatives (code org + timers + content module strategy)
- [ ] Đề xuất refactor cụ thể (kèm ví dụ code ngắn) cho các chỗ rủi ro
- [ ] Migration plan 3 phases + “lowest-risk first”
- [ ] Checklist “verify locally” (manual test scenarios)

---

## Code (self-contained excerpts)

### manifest.json (relevant)
```json
{
  "manifest_version": 3,
  "permissions": ["storage", "alarms", "webNavigation", "notifications", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }
  ]
}
```

### background_state.js (invariants + delta update)
```js
const DEFAULT_STATE = {
  isEnabled: true,
  currentTask: '',
  isInFlow: false,
  blockDistractions: true,
  breakReminderEnabled: false,
  distractingSites: DEFAULT_DISTRACTING_SITES,
  deepWorkBlockedSites: DEFAULT_DEEPWORK_BLOCKED_SITES,
  reminderStartTime: null,
  reminderInterval: null,
  reminderExpectedEndTime: null
};

function enforceStateInvariants(nextState) {
  const sanitized = { ...nextState };

  if (!sanitized.currentTask) sanitized.currentTask = '';

  if (!sanitized.isEnabled) {
    sanitized.isInFlow = false;
    sanitized.currentTask = '';
    sanitized.breakReminderEnabled = false;
    sanitized.reminderStartTime = null;
    sanitized.reminderInterval = null;
    sanitized.reminderExpectedEndTime = null;
  }

  if (sanitized.isInFlow && !sanitized.currentTask) sanitized.isInFlow = false;

  if (!sanitized.isInFlow || !sanitized.currentTask) {
    sanitized.isInFlow = false;
    sanitized.breakReminderEnabled = false;
    sanitized.reminderStartTime = null;
    sanitized.reminderInterval = null;
    sanitized.reminderExpectedEndTime = null;
  }

  return sanitized;
}

export async function updateState(updates) {
  const nextState = sanitizeStateUpdates(updates);
  const delta = {};
  Object.keys(nextState).forEach((k) => { if (state[k] !== nextState[k]) delta[k] = nextState[k]; });
  if (!Object.keys(delta).length) return true;

  state = { ...state, ...delta };
  await chrome.storage.local.set(delta);

  try {
    chrome.runtime.sendMessage({ action: 'stateUpdated', state: delta }).catch(() => {});
  } catch {}
  return true;
}
```

### background_breakReminder.js (MV3-safe alarms)
```js
const BREAK_REMINDER_END_ALARM = 'maizone_breakReminderEnd';
const BREAK_REMINDER_BADGE_ALARM = 'maizone_breakReminderBadgeTick';

function scheduleBreakReminderAlarms(expectedEndTime) {
  chrome.alarms.create(BREAK_REMINDER_END_ALARM, { when: expectedEndTime });
  chrome.alarms.create(BREAK_REMINDER_BADGE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

function handleBreakReminderEnd() {
  const { isEnabled, isInFlow, currentTask, breakReminderEnabled, reminderExpectedEndTime } = getState();
  if (!isEnabled || !isInFlow || !currentTask || !breakReminderEnabled) return;

  if (Date.now() < reminderExpectedEndTime) {
    scheduleBreakReminderAlarms(reminderExpectedEndTime);
    return;
  }

  updateState({ isInFlow: false, currentTask: '', breakReminderEnabled: false });
  chrome.action.setBadgeText({ text: '' });
  showBreakReminderNotification();
}

function resetBreakReminder(data, sendResponse) {
  const task = typeof data?.task === 'string' ? data.task.trim() : '';
  if (!task) return sendResponse?.({ success: false });

  updateState({ currentTask: task, isInFlow: true, breakReminderEnabled: true });
  startBreakReminder();
  sendResponse?.({ success: true });
}
```

### background_distraction.js (webNavigation + content warning)
```js
export function initDistraction() {
  setupMessageListeners();
  syncDistractionBlocking();
}

function syncDistractionBlocking() {
  const { isEnabled, blockDistractions } = getState();
  if (isEnabled && blockDistractions) enableDistractionsBlocking();
  else disableDistractionsBlocking();
}

async function isDistractingWebsite(url) {
  const normalized = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const { distractingSites, deepWorkBlockedSites, isInFlow, blockDistractions, isEnabled } = getState();
  if (!blockDistractions || !isEnabled) return false;

  const hit = distractingSites.some(s => normalized === s || normalized.endsWith('.' + s));
  if (hit) return true;

  if (isInFlow) {
    const hitDW = deepWorkBlockedSites.some(s => normalized === s || normalized.endsWith('.' + s));
    if (hitDW) return true;
  }
  return false;
}
```

### content.js (classic script + privacy gating)
```js
// local sendMessageSafely (no import)
async function sendMessageSafely(message, { timeoutMs = 2000 } = {}) { /* ... */ }

let isExtensionEnabled = true;
chrome.storage.local.get(['isEnabled'], ({ isEnabled }) => {
  isExtensionEnabled = typeof isEnabled === 'boolean' ? isEnabled : true;
});

function isTextInput(el) {
  if (!el?.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    const t = el.type?.toLowerCase();
    return ['text', 'email', 'search', 'url', 'tel', 'number'].includes(t); // no password
  }
  return el.getAttribute('contenteditable') === 'true';
}
```

---

## Question explicitly for Pro
“Có nên merge 4 files background này thành 1 không?”
- background.js
- background_state.js
- background_distraction.js
- background_breakReminder.js

Hãy trả lời bằng: (a) recommendation, (b) tradeoffs table, (c) rule-of-thumb khi nào merge/tách.

