# MaiZone MV3 Extension — Architecture/Quality Review (Round 2, after refactor)

## Context
MaiZone là Chrome extension (MV3) với mục tiêu: “do one thing at a time”.
Core features:
- f01: Cảnh báo/chặn trang gây sao nhãng (webNavigation + content UI)
- f03/f04: Deep Work 40 phút + nhắc nghỉ (timer/badge/notification)
- f05: State management tập trung (sanitize + invariants + broadcast)

Mục tiêu kỹ thuật:
- **MV3 reliability** (service worker sleep/wake, tránh race, tránh “random bugs”)
- **Maintainability** (SRP, boundaries rõ, clean data flow, giảm coupling)
- **Least-privilege + privacy-first**
- Không bundler / không dependency nặng (repo phẳng)
- Vietnamese user-facing strings, logging 🌸/🌸🌸🌸
- Không có bất kỳ code/tính năng liên quan Gemini/LLM key

## What changed since Round 1 (applied your feedback)
Mình đã triển khai các điểm chính từ Round 1 (P0/P1):
- Thêm **MV3 init gating** `ensureInitialized()` để tránh đọc DEFAULT_STATE trước khi hydrate.
- Serialize `updateState()` bằng **promise queue** để tránh race giữa popup/alarms/webNavigation.
- Chuẩn hoá broadcast: `stateUpdated` gửi `{ delta }` (giữ `{ state }` alias tạm).
- Debounce warning theo tab+hostname để tránh spam do webNavigation/SPA.
- Harden fallback UI: nếu background unreachable thì fallback storage write vẫn chạy sanitize/invariants + diff, chỉ set **delta**.
- Tách “pure state core” sang `state_core.js` (schema + sanitize + invariants + diff) dùng chung background/UI.

Commit refs (để bạn hiểu intent, không cần đọc git):
- `15114c4`: MV3 gating + serialize update + delta broadcast + debounce + state_core + hardened fallback
- `43d3289`: Fix BreakReminder await `updateState()` sau khi serialize update queue

## Current Architecture (source-of-truth)
- `background.js`: register listeners sync, init modules, kick `ensureInitialized()`
- `background_state.js`: hydrate state, queued updates, storage persistence, broadcast `stateUpdated`
- `state_core.js`: pure functions (schema/sanitize/invariants/diff)
- `state_helpers.js`: UI get/update state (message-first, fallback sanitized)
- `background_distraction.js`: webNavigation blocking + warning to content (debounce)
- `background_breakReminder.js`: alarms-based timer + badge + notification
- `content.js`: classic script (no import), privacy-first, minimal footprint + YouTube SPA observer

---

## Analysis Needed (Round 2 — push harder, focus edgecases + maintainability)

### 1) Fresh gaps analysis (P0/P1/P2) — sau refactor
Hãy rà soát lại với góc nhìn “MV3 service worker unreliable by default”:
- P0: bug/race nào vẫn có thể xảy ra? (init timing, message channel, alarms, state drift…)
- P1: pin/cpu/perf issues (alarms wake, webNavigation spam, content overhead, storage churn…)
- P2: maintainability traps (coupling, naming, unclear contracts, future feature creep…)

### 2) State design review (state_core + background_state)
Hãy review như security auditor + maintainer 10 năm:
- Invariants hiện tại có “quá tay” không? (ví dụ disable extension wipe flow/task, hoặc !isInFlow wipe reminder fields)
- Có cần tách “validity invariants” vs “policy decisions” không? Nếu có, đề xuất API và migration path ít rủi ro.
- `diffState`/`computeNextState` hiện tại đủ chặt chưa? Có edgecases kiểu array order/duplicates/normalization drift?
- Có nên thêm **internal subscribers** (in-process) thay vì background modules tự nghe `stateUpdated` qua runtime messaging?
  - Nếu đề xuất: chỉ ra interface tối giản và lợi ích thực tế (giảm coupling/overhead/bugs).

### 3) Messaging contract & validation (no bundler, content = classic)
Hiện tại:
- `actions.js` có `messageActions`, nhưng `content.js` phải dùng string literals.
Hãy đề xuất cách giảm mismatch mà **không bundler**:
- Option A: 1 file `actions_shared.js` dạng UMD/global? (rủi ro gì?)
- Option B: generate step? (không muốn build phức tạp)
- Option C: chấp nhận string, nhưng thêm validation layer ở background (whitelist/schema).

Mình muốn bạn đưa ra:
- 3 lựa chọn + tradeoffs + recommendation.
- Checklist validate payload per action (types, required fields, bounds).

### 4) Permissions & security posture (least-privilege)
Manifest hiện có: `storage`, `alarms`, `webNavigation`, `notifications`, `tabs`, host permissions `http/https`.
Hãy audit:
- `tabs` có thể giảm scope không? (activeTab/optional permissions/đổi kiến trúc)
- `webNavigation` vs alternative (declarativeNetRequest?) có đáng không trong constraint?
- Content overlay có risk UX/security nào (clickjacking cảm giác, CSS conflicts, PII exposure by accident)?

Deliverable: bảng “permission -> used for -> can reduce? -> cost/benefit”.

### 5) webNavigation correctness/perf
Hiện lắng nghe `onCompleted` + `onHistoryStateUpdated`, filter frameId=0, scheme http/https.
Hãy review:
- Có event nào phù hợp hơn? (onCommitted?) và tại sao.
- Có trường hợp warning bị miss hoặc bị double không?
- Debounce theo hostname+tabId 4s có đủ hợp lý không? Có scenario UX xấu?
- Memory leak: map debounce có cần cleanup theo tab lifecycle không?

### 6) Break Reminder correctness in MV3
Timer dùng `chrome.alarms`:
- Badge tick 1 phút: có vấn đề UX/accuracy không?
- Alarm end early/late: logic reschedule hiện tại ok chưa?
- Edgecases: Chrome restart giữa chừng, disable/enable extension, user spam start/stop nhanh.

### 7) “Clean & maintainable” roadmap (next 3 phases)
Hãy đề xuất plan 3 phases (lowest-risk first) sau refactor này:
- Phase 1: fix P0/P1 còn lại (minimal behavior change)
- Phase 2: least-privilege + security hardening
- Phase 3: architecture improvements (nếu thật sự đáng)

Mỗi phase yêu cầu:
- danh sách thay đổi cụ thể
- rủi ro/rollback plan
- manual test checklist

### 8) Bonus: 3 perspectives
Hãy phân tích ngắn gọn từ 3 góc nhìn:
1) Junior dev: phần nào sẽ gây hiểu nhầm nhất?
2) Security auditor: phần nào dễ bị abuse/PII risk nhất?
3) 10-years maintainer: điều gì sẽ hối hận nhất nếu không sửa ngay?

---

## Constraints (nhắc lại)
- No bundler / no heavy deps
- Keep repo flat, ES modules (trừ content script)
- Vietnamese user-facing strings
- Logging: 🌸 normal, 🌸🌸🌸 errors only
- No Gemini/LLM code/keys

---

## Code (self-contained excerpts — current)

### actions.js (messageActions)
```js
export const messageActions = Object.freeze({
  checkCurrentUrl: 'checkCurrentUrl',
  youtubeNavigation: 'youtubeNavigation',
  closeTab: 'closeTab',
  distractingWebsite: 'distractingWebsite',
  resetBreakReminder: 'resetBreakReminder',
  getBreakReminderState: 'getBreakReminderState',
  getState: 'getState',
  updateState: 'updateState',
  stateUpdated: 'stateUpdated'
});
```

### messaging.js (safe runtime + tab messaging)
```js
function isExtensionContextValid() {
  return !!(globalThis?.chrome?.runtime && chrome.runtime.id !== undefined);
}

export async function sendMessageSafely(message, { timeoutMs = 2000 } = {}) {
  try {
    if (!isExtensionContextValid()) return null;

    return await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (reply) => {
          clearTimeout(timeoutId);

          const lastError = chrome.runtime.lastError;
          if (lastError) {
            resolve(null);
            return;
          }

          resolve(reply);
        });
      } catch (innerError) {
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) return null;
    return null;
  }
}

export async function sendMessageToTabSafely(tabId, message, { timeoutMs = 2000 } = {}) {
  try {
    if (!isExtensionContextValid()) return null;
    if (typeof tabId !== 'number') return null;

    return await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), timeoutMs);

      try {
        chrome.tabs.sendMessage(tabId, message, (reply) => {
          clearTimeout(timeoutId);

          const lastError = chrome.runtime.lastError;
          if (lastError) {
            resolve(null);
            return;
          }

          resolve(reply);
        });
      } catch (innerError) {
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) return null;
    return null;
  }
}
```

### manifest.json (relevant)
```json
{
  "manifest_version": 3,
  "permissions": ["storage", "alarms", "webNavigation", "notifications", "tabs"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    { "matches": ["http://*/*", "https://*/*"], "js": ["content.js"], "run_at": "document_idle" }
  ]
}
```

### background.js (register listeners sync + hydrate)
```js
import { ensureInitialized, setupStateListeners } from './background_state.js';
import { initDistraction } from './background_distraction.js';
import { initBreakReminder } from './background_breakReminder.js';

function initBackgroundScript() {
  setupStateListeners();
  initDistraction();
  initBreakReminder();

  ensureInitialized().catch(() => {});
}
initBackgroundScript();
```

### state_core.js (pure schema + sanitize + invariants + diff) — key parts
```js
export const DEFAULT_STATE = Object.freeze({
  isEnabled: true,
  currentTask: '',
  isInFlow: false,
  blockDistractions: true,
  breakReminderEnabled: false,
  distractingSites: Object.freeze([...DEFAULT_DISTRACTING_SITES]),
  deepWorkBlockedSites: Object.freeze([...DEFAULT_DEEPWORK_BLOCKED_SITES]),
  reminderStartTime: null,
  reminderInterval: null,
  reminderExpectedEndTime: null
});

export function getDefaultState() {
  return {
    ...DEFAULT_STATE,
    distractingSites: [...DEFAULT_STATE.distractingSites],
    deepWorkBlockedSites: [...DEFAULT_STATE.deepWorkBlockedSites]
  };
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function normalizeArrayOfStrings(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeNumberOrNull(value, fallback) {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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

export function sanitizeStoredState(storedState) {
  const base = getDefaultState();
  const stored = storedState || {};

  const merged = {
    isEnabled: normalizeBoolean(stored.isEnabled, base.isEnabled),
    currentTask: normalizeString(stored.currentTask, base.currentTask),
    isInFlow: normalizeBoolean(stored.isInFlow, base.isInFlow),
    blockDistractions: normalizeBoolean(stored.blockDistractions, base.blockDistractions),
    breakReminderEnabled: normalizeBoolean(stored.breakReminderEnabled, base.breakReminderEnabled),
    distractingSites: normalizeArrayOfStrings(stored.distractingSites, base.distractingSites),
    deepWorkBlockedSites: normalizeArrayOfStrings(stored.deepWorkBlockedSites, base.deepWorkBlockedSites),
    reminderStartTime: normalizeNumberOrNull(stored.reminderStartTime, base.reminderStartTime),
    reminderInterval: normalizeNumberOrNull(stored.reminderInterval, base.reminderInterval),
    reminderExpectedEndTime: normalizeNumberOrNull(stored.reminderExpectedEndTime, base.reminderExpectedEndTime)
  };

  return enforceStateInvariants({ ...base, ...merged });
}

export function computeNextState(currentState, updates) {
  const current = currentState && typeof currentState === 'object' ? currentState : getDefaultState();
  if (!updates || typeof updates !== 'object') return { ...current };

  const sanitized = {};

  if ('isEnabled' in updates) sanitized.isEnabled = normalizeBoolean(updates.isEnabled, current.isEnabled);
  if ('currentTask' in updates) sanitized.currentTask = normalizeString(updates.currentTask, current.currentTask);
  if ('isInFlow' in updates) sanitized.isInFlow = normalizeBoolean(updates.isInFlow, current.isInFlow);
  if ('blockDistractions' in updates) {
    sanitized.blockDistractions = normalizeBoolean(updates.blockDistractions, current.blockDistractions);
  }
  if ('breakReminderEnabled' in updates) {
    sanitized.breakReminderEnabled = normalizeBoolean(updates.breakReminderEnabled, current.breakReminderEnabled);
  }
  if ('distractingSites' in updates) {
    sanitized.distractingSites = normalizeArrayOfStrings(updates.distractingSites, current.distractingSites);
  }
  if ('deepWorkBlockedSites' in updates) {
    sanitized.deepWorkBlockedSites = normalizeArrayOfStrings(updates.deepWorkBlockedSites, current.deepWorkBlockedSites);
  }
  if ('reminderStartTime' in updates) {
    sanitized.reminderStartTime = normalizeNumberOrNull(updates.reminderStartTime, current.reminderStartTime);
  }
  if ('reminderInterval' in updates) {
    sanitized.reminderInterval = normalizeNumberOrNull(updates.reminderInterval, current.reminderInterval);
  }
  if ('reminderExpectedEndTime' in updates) {
    sanitized.reminderExpectedEndTime = normalizeNumberOrNull(
      updates.reminderExpectedEndTime,
      current.reminderExpectedEndTime
    );
  }

  return enforceStateInvariants({ ...current, ...sanitized });
}

function areStringArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function diffState(prevState, nextState) {
  const prev = prevState && typeof prevState === 'object' ? prevState : {};
  const next = nextState && typeof nextState === 'object' ? nextState : getDefaultState();

  const delta = {};
  Object.keys(next).forEach((key) => {
    const prevValue = prev[key];
    const nextValue = next[key];

    if (Array.isArray(nextValue)) {
      if (!areStringArraysEqual(prevValue, nextValue)) delta[key] = nextValue;
      return;
    }

    if (prevValue !== nextValue) delta[key] = nextValue;
  });

  return delta;
}
```

### background_state.js (MV3-safe hydrate + queued update + delta broadcast) — key parts
```js
let state = getDefaultState();
let initPromise = null;
let hasInitialized = false;
let updateChain = Promise.resolve();

export function ensureInitialized() {
  if (hasInitialized) return Promise.resolve({ ...state });
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const stored = await new Promise((resolve) => {
      chrome.storage.local.get(null, (data) => resolve(data || {}));
    });
    // remove deprecated keys...
    const nextState = sanitizeStoredState(stored);
    const filteredStoredState = {};
    Object.keys(DEFAULT_STATE).forEach((key) => {
      if (key in (stored || {})) filteredStoredState[key] = stored[key];
    });
    const deltaToStore = diffState(filteredStoredState, nextState);
    if (Object.keys(deltaToStore).length) {
      await new Promise((resolve) => chrome.storage.local.set(deltaToStore, () => resolve()));
    }
    state = nextState;
    hasInitialized = true;
    return { ...state };
  })().catch(() => {
    state = sanitizeStoredState(null);
    hasInitialized = true;
    return { ...state };
  }).finally(() => { initPromise = null; });
  return initPromise;
}

export async function updateState(updates) {
  updateChain = updateChain.then(async () => {
    await ensureInitialized();
    const nextState = computeNextState(state, updates);
    const delta = diffState(state, nextState);
    if (!Object.keys(delta).length) return true;
    state = nextState;
    await new Promise((resolve) => chrome.storage.local.set(delta, () => resolve()));
    chrome.runtime.sendMessage({ action: 'stateUpdated', delta, state: delta }).catch(() => {});
    return true;
  }).catch(() => false);
  return updateChain;
}

export function setupStateListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.getState) {
      (async () => {
        await ensureInitialized();
        if (Array.isArray(message.keys)) {
          const subset = {};
          message.keys.forEach((k) => {
            subset[k] = state[k];
          });
          return subset;
        }
        return message.key ? { [message.key]: state[message.key] } : { ...state };
      })()
        .then((response) => sendResponse(response))
        .catch(() => sendResponse({}));
      return true;
    }

    if (message.action === messageActions.updateState) {
      (async () => {
        await ensureInitialized();
        if (!message.payload || typeof message.payload !== 'object') return { success: false };
        const success = await updateState(message.payload);
        return { success: !!success };
      })()
        .then((response) => sendResponse(response))
        .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
      return true;
    }

    return false;
  });
}
```

### state_helpers.js (UI safe fallback)
```js
export async function updateStateSafely(payload) {
  const res = await sendMessageSafely({ action: 'updateState', payload });
  if (res?.success) return true;

  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => resolve(data || {}));
  });
  const current = sanitizeStoredState(stored);
  const next = computeNextState(current, payload);
  const delta = diffState(current, next);
  if (!Object.keys(delta).length) return true;
  await new Promise((resolve) => chrome.storage.local.set(delta, () => resolve()));
  return true;
}
```

### background_distraction.js (scheme filter + debounce) — key parts
```js
const WARNING_COOLDOWN_MS = 4000;
const lastWarningByTabId = new Map();

function getWarningKey(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url || '');
  }
}

function shouldSendWarning(tabId, url) {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return true;

  const key = getWarningKey(url);
  const now = Date.now();
  const previous = lastWarningByTabId.get(tabId);

  if (previous && previous.key === key && now - previous.ts < WARNING_COOLDOWN_MS) return false;

  lastWarningByTabId.set(tabId, { key, ts: now });
  return true;
}

async function handleWebNavigation(details) {
  if (details.frameId !== 0) return;
  if (!details.url?.startsWith('http')) return;
  await ensureInitialized();
  // if distracting -> sendWarningToTab(tabId, url) (debounced)
}

function sendWarningToTab(tabId, url) {
  if (!shouldSendWarning(tabId, url)) return;

  const { isInFlow, deepWorkBlockedSites } = getState();
  const normalizedHost = new URL(url).hostname.toLowerCase().replace(/^www\./, '');

  const isDeepWorkBlocked = deepWorkBlockedSites.some((site) => {
    const s = site.toLowerCase().replace(/^www\./, '');
    return normalizedHost === s || normalizedHost.endsWith('.' + s);
  });

  const message =
    isDeepWorkBlocked && isInFlow
      ? 'Bạn đang trong chế độ Deep Work... Bạn có chắc chắn muốn tiếp tục?'
      : 'Mai nhận thấy đây là trang web gây sao nhãng. Bạn có thật sự muốn tiếp tục?';

  sendMessageToTabSafely(tabId, {
    action: messageActions.distractingWebsite,
    data: { url, message, isDeepWorkBlocked, isInDeepWorkMode: isInFlow }
  });
}
```

### background_breakReminder.js (alarms + await queued updates) — key parts
```js
const BREAK_REMINDER_END_ALARM = 'maizone_breakReminderEnd';
const BREAK_REMINDER_BADGE_ALARM = 'maizone_breakReminderBadgeTick';

export function initBreakReminder() {
  setupAlarmListeners();
  ensureInitialized().then(() => initializeBreakReminderIfEnabled()).catch(() => initializeBreakReminderIfEnabled());
}

async function handleAlarm(alarm) {
  await ensureInitialized();
  if (alarm.name === BREAK_REMINDER_END_ALARM) await handleBreakReminderEnd();
}

async function startBreakReminder() {
  await updateState({ reminderStartTime, reminderInterval, reminderExpectedEndTime });
  scheduleBreakReminderAlarms(reminderExpectedEndTime);
}

function scheduleBreakReminderAlarms(expectedEndTime) {
  chrome.alarms.create(BREAK_REMINDER_END_ALARM, { when: expectedEndTime });
  chrome.alarms.create(BREAK_REMINDER_BADGE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

function stopBreakReminder() {
  chrome.alarms.clear(BREAK_REMINDER_END_ALARM);
  chrome.alarms.clear(BREAK_REMINDER_BADGE_ALARM);
  chrome.action.setBadgeText({ text: '' });
}

async function handleBreakReminderEnd() {
  const { isEnabled, isInFlow, currentTask, breakReminderEnabled, reminderExpectedEndTime } = getState();
  if (!isEnabled || !isInFlow || !currentTask || !breakReminderEnabled) return;

  const now = Date.now();
  if (typeof reminderExpectedEndTime === 'number' && now < reminderExpectedEndTime) {
    // Alarm can fire early; reschedule
    scheduleBreakReminderAlarms(reminderExpectedEndTime);
    return;
  }

  await updateState({ isInFlow: false, currentTask: '', breakReminderEnabled: false });
  stopBreakReminder(); // clears alarms + badge
  showBreakReminderNotification();
}
```

### content.js (classic, no import) — message contract + warning UI
```js
function handleBackgroundMessages(message, sender, sendResponse) {
  if (!isExtensionEnabled) return false;
  if (message?.action !== 'distractingWebsite') return false;

  showDistractionWarning(message.data);
  sendResponse({ received: true });
  return true;
}

function checkIfDistractingSite() {
  if (!isExtensionEnabled || !isDistractionBlockingEnabled) return;
  const currentUrl = window.location.href;
  if (!currentUrl || currentUrl === 'about:blank') return;

  sendMessageSafely({ action: 'checkCurrentUrl', data: { url: currentUrl } });
}
```

Notes:
- Classic script (no import), local `sendMessageSafely` + timeouts
- Không theo dõi `input[type=password]`, không lưu text user gõ (chỉ metadata như length)
- Gating theo `isEnabled` + detach listeners khi disabled
- YouTube SPA observer gửi `{ action: 'youtubeNavigation', data: { url } }`
