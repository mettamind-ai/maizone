/**
 * MaiZone Browser Extension
 * State Management: Centralized state handling in background
 * @feature f05 - State Management
 */

import { DEFAULT_DISTRACTING_SITES, DEFAULT_DEEPWORK_BLOCKED_SITES } from './constants.js';
import { messageActions } from './actions.js';

/***** DEFAULT STATE *****/

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

// Initial state
let state = { ...DEFAULT_STATE };

/***** STATE NORMALIZATION *****/

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

/**
 * Sanitize state load từ storage (loại bỏ kiểu sai và set defaults).
 * @param {Object} storedState - Raw state từ chrome.storage.local
 * @returns {Object} State đã sanitize
 */
function sanitizeStoredState(storedState) {
  const base = { ...DEFAULT_STATE };
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
 * Sanitize patch update (partial state) trước khi lưu.
 * @param {Object} updates - Partial updates
 * @returns {Object} Next state sau sanitize + invariants
 */
function sanitizeStateUpdates(updates) {
  if (!updates || typeof updates !== 'object') return {};

  const sanitized = {};

  if ('isEnabled' in updates) sanitized.isEnabled = normalizeBoolean(updates.isEnabled, state.isEnabled);
  if ('currentTask' in updates) sanitized.currentTask = normalizeString(updates.currentTask, state.currentTask);
  if ('isInFlow' in updates) sanitized.isInFlow = normalizeBoolean(updates.isInFlow, state.isInFlow);
  if ('blockDistractions' in updates) {
    sanitized.blockDistractions = normalizeBoolean(updates.blockDistractions, state.blockDistractions);
  }
  if ('breakReminderEnabled' in updates) {
    sanitized.breakReminderEnabled = normalizeBoolean(updates.breakReminderEnabled, state.breakReminderEnabled);
  }
  if ('distractingSites' in updates) {
    sanitized.distractingSites = normalizeArrayOfStrings(updates.distractingSites, state.distractingSites);
  }
  if ('deepWorkBlockedSites' in updates) {
    sanitized.deepWorkBlockedSites = normalizeArrayOfStrings(updates.deepWorkBlockedSites, state.deepWorkBlockedSites);
  }

  if ('reminderStartTime' in updates) {
    sanitized.reminderStartTime = normalizeNumberOrNull(updates.reminderStartTime, state.reminderStartTime);
  }
  if ('reminderInterval' in updates) {
    sanitized.reminderInterval = normalizeNumberOrNull(updates.reminderInterval, state.reminderInterval);
  }
  if ('reminderExpectedEndTime' in updates) {
    sanitized.reminderExpectedEndTime = normalizeNumberOrNull(updates.reminderExpectedEndTime, state.reminderExpectedEndTime);
  }

  return enforceStateInvariants({ ...state, ...sanitized });
}

// Load state from storage on initialization
/**
 * Initialize state from storage
 * @feature f05 - State Management
 */
export async function initState() {
  try {
    const storedState = await new Promise(resolve => {
      chrome.storage.local.get(null, data => resolve(data));
    });
    
    // Remove unknown keys from storage to avoid stale/deprecated state lingering
    const allowedKeys = new Set(Object.keys(DEFAULT_STATE));
    const deprecatedKeys = Object.keys(storedState || {}).filter((key) => !allowedKeys.has(key));
    if (deprecatedKeys.length) {
      await new Promise((resolve) => chrome.storage.local.remove(deprecatedKeys, () => resolve()));
    }

    state = sanitizeStoredState(storedState);
    
    // Ensure default state is saved to storage if not present
    await new Promise(resolve => {
      chrome.storage.local.set(state, () => resolve());
    });
    
    console.log('🌸 State initialized:', state);
    return state;
  } catch (error) {
    console.error('🌸🌸🌸 Error initializing state:', error);
    return state;
  }
}

// Get entire state or specific properties
/**
 * Get entire state or specific properties
 * @feature f05 - State Management
 */
export function getState(key = null) {
  if (key) {
    return state[key];
  }
  return { ...state };
}

// Update state and persist to storage
/**
 * Update state and persist to storage
 * @feature f05 - State Management
 */
export async function updateState(updates) {
  try {
    const nextState = sanitizeStateUpdates(updates);
    const delta = {};

    Object.keys(nextState).forEach((key) => {
      if (state[key] !== nextState[key]) {
        delta[key] = nextState[key];
      }
    });

    if (!Object.keys(delta).length) return true;

    // Update in-memory state
    state = { ...state, ...delta };
    
    // Persist to storage
    await new Promise(resolve => {
      chrome.storage.local.set(delta, () => resolve());
    });
    
    // Broadcast state update to other parts of the extension
    try {
      chrome.runtime.sendMessage({
        action: messageActions.stateUpdated,
        state: delta
      }).catch(() => {
        // Ignore errors from no listeners / SW lifecycle
      });
    } catch (broadcastError) {
      // Ignore broadcast errors during invalidation
    }
    
    return true;
  } catch (error) {
    console.error('🌸🌸🌸 Error updating state:', error);
    return false;
  }
}

// Listen for state update requests
export function setupStateListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.getState) {
      if (Array.isArray(message.keys)) {
        const subset = {};
        message.keys.forEach((k) => {
          subset[k] = state[k];
        });
        sendResponse(subset);
        return true;
      }

      const requestedState = message.key ? { [message.key]: state[message.key] } : state;
      sendResponse(requestedState);
      return true;
    } 
    else if (message.action === messageActions.updateState) {
      if (!message.payload || typeof message.payload !== 'object') {
        sendResponse({ success: false, error: 'Invalid payload' });
        return true;
      }

      updateState(message.payload)
        .then((success) => sendResponse({ success: !!success }))
        .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
      return true; // Keep channel open for async response
    }
    return false;
  });
}
