/**
 * MaiZone Browser Extension
 * State Helpers: Safe get/update state with fallbacks
 * @feature f05 - State Management
 */

import { sendMessageSafely } from './messaging.js';
import { messageActions } from './actions.js';
import { computeNextState, diffState, sanitizeStoredState } from './state_core.js';

/***** GET STATE *****/

/**
 * Lấy state an toàn (ưu tiên background, fallback qua chrome.storage.local).
 * @param {string|Array<string>|null} keyOrKeys - Key, list keys, hoặc null để lấy toàn bộ
 * @returns {Promise<Object>} Object state tương ứng (partial hoặc full)
 */
export async function getStateSafely(keyOrKeys = null) {
  const request = { action: messageActions.getState };
  if (Array.isArray(keyOrKeys)) request.keys = keyOrKeys;
  else if (typeof keyOrKeys === 'string') request.key = keyOrKeys;

  const state = await sendMessageSafely(request);
  if (state) return state;

  const storedState = await new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => resolve(data || {}));
  });

  const sanitized = sanitizeStoredState(storedState);

  if (Array.isArray(keyOrKeys)) {
    const subset = {};
    keyOrKeys.forEach((k) => {
      subset[k] = sanitized[k];
    });
    return subset;
  }

  if (typeof keyOrKeys === 'string') {
    return { [keyOrKeys]: sanitized[keyOrKeys] };
  }

  return sanitized;
}

/***** UPDATE STATE *****/

/**
 * Cập nhật state an toàn (ưu tiên background, fallback qua chrome.storage.local).
 * @param {Object} payload - Partial state update
 * @returns {Promise<boolean>} True nếu cập nhật thành công (kể cả qua fallback)
 */
export async function updateStateSafely(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const response = await sendMessageSafely({ action: messageActions.updateState, payload });
  if (response?.success) return true;

  const storedState = await new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => resolve(data || {}));
  });

  const currentState = sanitizeStoredState(storedState);
  const nextState = computeNextState(currentState, payload);
  const delta = diffState(currentState, nextState);

  if (!Object.keys(delta).length) return true;

  await new Promise((resolve) => chrome.storage.local.set(delta, () => resolve()));
  return true;
}
