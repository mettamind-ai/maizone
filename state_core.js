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
 * Chuẩn hoá mảng string (trim + lọc empty).
 * @param {any} value - Giá trị cần normalize
 * @param {Array<string>} fallback - Giá trị mặc định nếu không hợp lệ
 * @returns {Array<string>}
 */
function normalizeArrayOfStrings(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
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

/***** INVARIANTS *****/

/**
 * Enforce các invariants để tránh state mâu thuẫn.
 * @param {Object} nextState - State sau merge/sanitize
 * @returns {Object} State đã được chỉnh theo invariants
 */
function enforceStateInvariants(nextState) {
  const sanitized = { ...nextState };

  if (!sanitized.currentTask) {
    sanitized.currentTask = '';
  }

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

