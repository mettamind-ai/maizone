/**
 * MaiZone Browser Extension
 * State Core: Schema + normalization + invariants (pure functions)
 * @feature f05 - State Management
 */

import { DEFAULT_DISTRACTING_SITES, DEFAULT_DEEPWORK_BLOCKED_SITES } from './constants.js';

/***** DEFAULT STATE *****/

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

/**
 * Tạo default state mới (clone arrays để tránh mutation theo reference).
 * @returns {Object}
 */
export function getDefaultState() {
  return {
    ...DEFAULT_STATE,
    distractingSites: [...DEFAULT_STATE.distractingSites],
    deepWorkBlockedSites: [...DEFAULT_STATE.deepWorkBlockedSites]
  };
}

/***** NORMALIZATION HELPERS *****/

/**
 * Chuẩn hoá boolean (chỉ nhận đúng kiểu boolean).
 * @param {any} value - Giá trị cần normalize
 * @param {boolean} fallback - Giá trị mặc định nếu không hợp lệ
 * @returns {boolean}
 */
function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Chuẩn hoá string (chỉ nhận đúng kiểu string).
 * @param {any} value - Giá trị cần normalize
 * @param {string} fallback - Giá trị mặc định nếu không hợp lệ
 * @returns {string}
 */
function normalizeString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Chuẩn hoá mảng domain (lowercase, strip protocol/path, strip www, dedupe, sort).
 * @param {any} value - Giá trị cần normalize
 * @param {Array<string>} fallback - Giá trị mặc định nếu không hợp lệ
 * @param {Object} [options]
 * @param {number} [options.maxItems=200] - Số lượng tối đa
 * @returns {Array<string>}
 */
function normalizeDomainList(value, fallback, { maxItems = 200 } = {}) {
  if (!Array.isArray(value)) return fallback;

  const out = [];
  const seen = new Set();

  for (const rawValue of value) {
    if (typeof rawValue !== 'string') continue;

    const raw = rawValue.trim().toLowerCase();
    if (!raw) continue;

    const withoutProtocol = raw.replace(/^https?:\/\//, '');
    const hostname = withoutProtocol
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .replace(/^www\./, '');

    if (!hostname) continue;
    if (hostname.length > 253) continue;
    if (!hostname.includes('.')) continue;
    if (hostname.startsWith('.') || hostname.endsWith('.')) continue;
    if (hostname.includes('..')) continue;
    if (/\s/.test(hostname)) continue;
    if (!/^[a-z0-9.-]+$/.test(hostname)) continue;

    if (seen.has(hostname)) continue;
    seen.add(hostname);
    out.push(hostname);

    if (out.length >= maxItems) break;
  }

  out.sort();
  return out;
}

/**
 * Chuẩn hoá number hoặc null.
 * @param {any} value - Giá trị cần normalize
 * @param {number|null} fallback - Giá trị mặc định nếu không hợp lệ
 * @returns {number|null}
 */
function normalizeNumberOrNull(value, fallback) {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/***** DOMAIN LISTS *****/

const MAX_SITE_LIST_ITEMS = 200;

/***** TIMER NORMALIZATION *****/

const MIN_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Chuẩn hoá interval ms (giới hạn khoảng hợp lý).
 * @param {any} value - Raw value
 * @param {number|null} fallback - Fallback
 * @returns {number|null}
 */
function normalizeIntervalMs(value, fallback) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) return fallback;
  return value;
}

/***** TASK NORMALIZATION *****/

const MAX_TASK_LENGTH = 120;

/**
 * Chuẩn hoá task string (trim + giới hạn độ dài).
 * @param {any} value - Raw value
 * @param {string} fallback - Fallback
 * @returns {string}
 */
function normalizeTask(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_TASK_LENGTH ? trimmed.slice(0, MAX_TASK_LENGTH) : trimmed;
}

/***** INVARIANTS *****/

/**
 * Enforce các invariants để tránh state mâu thuẫn.
 * @param {Object} nextState - State sau merge/sanitize
 * @returns {Object} State đã được chỉnh theo invariants
 */
function enforceStateInvariants(nextState) {
  const sanitized = { ...nextState };

  // Ensure task is always a string.
  if (!sanitized.currentTask) sanitized.currentTask = '';

  if (!sanitized.isEnabled) {
    sanitized.isInFlow = false;
    sanitized.currentTask = '';
    sanitized.breakReminderEnabled = false;
    sanitized.reminderStartTime = null;
    sanitized.reminderInterval = null;
    sanitized.reminderExpectedEndTime = null;
  }

  if (sanitized.isInFlow && !sanitized.currentTask) {
    sanitized.isInFlow = false;
  }

  if (!sanitized.isInFlow || !sanitized.currentTask) {
    sanitized.isInFlow = false;
    sanitized.breakReminderEnabled = false;
    sanitized.reminderStartTime = null;
    sanitized.reminderInterval = null;
    sanitized.reminderExpectedEndTime = null;
  }

  return sanitized;
}

/***** PURE TRANSITIONS *****/

/**
 * Sanitize state load từ storage (loại bỏ kiểu sai và set defaults).
 * @param {Object} storedState - Raw state từ chrome.storage.local
 * @returns {Object} State đã sanitize
 */
export function sanitizeStoredState(storedState) {
  const base = getDefaultState();
  const stored = storedState || {};

  const merged = {
    isEnabled: normalizeBoolean(stored.isEnabled, base.isEnabled),
    currentTask: normalizeTask(stored.currentTask, base.currentTask),
    isInFlow: normalizeBoolean(stored.isInFlow, base.isInFlow),
    blockDistractions: normalizeBoolean(stored.blockDistractions, base.blockDistractions),
    breakReminderEnabled: normalizeBoolean(stored.breakReminderEnabled, base.breakReminderEnabled),
    distractingSites: normalizeDomainList(stored.distractingSites, base.distractingSites, { maxItems: MAX_SITE_LIST_ITEMS }),
    deepWorkBlockedSites: normalizeDomainList(stored.deepWorkBlockedSites, base.deepWorkBlockedSites, {
      maxItems: MAX_SITE_LIST_ITEMS
    }),
    reminderStartTime: normalizeNumberOrNull(stored.reminderStartTime, base.reminderStartTime),
    reminderInterval: normalizeIntervalMs(stored.reminderInterval, base.reminderInterval),
    reminderExpectedEndTime: normalizeNumberOrNull(stored.reminderExpectedEndTime, base.reminderExpectedEndTime)
  };

  return enforceStateInvariants({ ...base, ...merged });
}

/**
 * Apply partial updates -> next full state (sanitize + invariants).
 * @param {Object} currentState - Current full state
 * @param {Object} updates - Partial updates
 * @returns {Object} Next full state
 */
export function computeNextState(currentState, updates) {
  const current = currentState && typeof currentState === 'object' ? currentState : getDefaultState();
  if (!updates || typeof updates !== 'object') return { ...current };

  const sanitized = {};

  if ('isEnabled' in updates) sanitized.isEnabled = normalizeBoolean(updates.isEnabled, current.isEnabled);
  if ('currentTask' in updates) sanitized.currentTask = normalizeTask(updates.currentTask, current.currentTask);
  if ('isInFlow' in updates) sanitized.isInFlow = normalizeBoolean(updates.isInFlow, current.isInFlow);
  if ('blockDistractions' in updates) {
    sanitized.blockDistractions = normalizeBoolean(updates.blockDistractions, current.blockDistractions);
  }
  if ('breakReminderEnabled' in updates) {
    sanitized.breakReminderEnabled = normalizeBoolean(updates.breakReminderEnabled, current.breakReminderEnabled);
  }
  if ('distractingSites' in updates) {
    sanitized.distractingSites = normalizeDomainList(updates.distractingSites, current.distractingSites, {
      maxItems: MAX_SITE_LIST_ITEMS
    });
  }
  if ('deepWorkBlockedSites' in updates) {
    sanitized.deepWorkBlockedSites = normalizeDomainList(updates.deepWorkBlockedSites, current.deepWorkBlockedSites, {
      maxItems: MAX_SITE_LIST_ITEMS
    });
  }

  if ('reminderStartTime' in updates) {
    sanitized.reminderStartTime = normalizeNumberOrNull(updates.reminderStartTime, current.reminderStartTime);
  }
  if ('reminderInterval' in updates) {
    sanitized.reminderInterval = normalizeIntervalMs(updates.reminderInterval, current.reminderInterval);
  }
  if ('reminderExpectedEndTime' in updates) {
    sanitized.reminderExpectedEndTime = normalizeNumberOrNull(updates.reminderExpectedEndTime, current.reminderExpectedEndTime);
  }

  return enforceStateInvariants({ ...current, ...sanitized });
}

/***** DIFF *****/

/**
 * So sánh 2 mảng string theo giá trị.
 * @param {any} a - Array 1
 * @param {any} b - Array 2
 * @returns {boolean}
 */
function areStringArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Tạo delta giữa 2 states (so sánh theo value, không theo reference).
 * @param {Object} prevState - State trước
 * @param {Object} nextState - State sau
 * @returns {Object} Delta object chỉ chứa keys thay đổi
 */
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
