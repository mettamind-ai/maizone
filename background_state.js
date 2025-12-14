/**
 * MaiZone Browser Extension
 * State Management: Centralized state handling in background
 * @feature f05 - State Management
 */

import { messageActions } from './actions.js';
import { DEFAULT_STATE, computeNextState, diffState, getDefaultState, sanitizeStoredState } from './state_core.js';
import { STATE_KEYS, UI_ALLOWED_UPDATE_KEYS, UNTRUSTED_STATE_KEYS } from './state_contract.js';

// In-memory state snapshot (hydrated lazily for MV3 reliability).
let state = getDefaultState();

// MV3 service worker can wake for events before async init finishes.
let initPromise = null;
let hasInitialized = false;

// Serialize state updates to avoid race conditions (popup + alarms + webNavigation).
let updateChain = Promise.resolve();

/***** INITIALIZATION (MV3-SAFE) *****/

let hasRegisteredStorageReconcile = false;

/**
 * Broadcast a state delta safely (guard Promise support across environments).
 * @param {Object} delta - Partial state delta
 * @returns {void}
 */
function broadcastStateDelta(delta) {
  try {
    const maybePromise = chrome.runtime.sendMessage({
      action: messageActions.stateUpdated,
      delta,
      // Backward compatible field name (deprecated): older listeners used message.state.
      state: delta
    });

    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {
        // Ignore errors from no listeners / SW lifecycle
      });
    }
  } catch (error) {
    // Ignore broadcast errors during invalidation
  }
}

/**
 * Reconcile in-memory state when something else writes to storage.
 * - Prevents drift when UI falls back to storage writes while SW is alive.
 * - Applies sanitize/invariants (via computeNextState) and persists derived deltas back to storage.
 * @returns {void}
 */
function setupStorageReconcileListener() {
  if (hasRegisteredStorageReconcile) return;
  hasRegisteredStorageReconcile = true;

  if (!chrome?.storage?.onChanged) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!hasInitialized) return;
    if (!changes || typeof changes !== 'object') return;

    const rawUpdates = {};
    Object.entries(changes).forEach(([key, change]) => {
      if (!(key in DEFAULT_STATE)) return;
      rawUpdates[key] = change?.newValue;
    });

    if (!Object.keys(rawUpdates).length) return;

    updateChain = updateChain
      .then(async () => {
        // Ensure state is hydrated (extra safe; should already be true if hasInitialized).
        await ensureInitialized();

        const nextState = computeNextState(state, rawUpdates);
        const delta = diffState(state, nextState);
        if (!Object.keys(delta).length) return;

        state = nextState;

        // Persist any derived/sanitized changes so storage stays canonical/consistent.
        await new Promise((resolve) => chrome.storage.local.set(delta, () => resolve()));

        broadcastStateDelta(delta);
      })
      .catch((error) => {
        console.error('🌸🌸🌸 Error reconciling storage change:', error);
      });
  });
}

/**
 * Check whether sender is a trusted extension page (popup/options).
 * @param {chrome.runtime.MessageSender} sender - Sender info
 * @returns {boolean}
 */
function isTrustedExtensionSender(sender) {
  const senderUrl = typeof sender?.url === 'string' ? sender.url : '';
  const extensionOrigin = `chrome-extension://${chrome.runtime?.id || ''}/`;
  return !!(senderUrl && extensionOrigin && senderUrl.startsWith(extensionOrigin));
}

/**
 * Filter payload keys by allowlist to avoid unintended/unsafe updates.
 * @param {Object} payload - Raw payload
 * @param {Array<string>|Set<string>} allowedKeys - Key allowlist
 * @returns {Object}
 */
function filterPayloadKeys(payload, allowedKeys) {
  if (!payload || typeof payload !== 'object') return {};
  const filtered = {};

  Object.keys(payload).forEach((key) => {
    const isAllowed =
      allowedKeys instanceof Set ? allowedKeys.has(key) : Array.isArray(allowedKeys) ? allowedKeys.includes(key) : false;
    if (!isAllowed) return;
    filtered[key] = payload[key];
  });

  return filtered;
}

const UI_ALLOWED_UPDATE_KEYS_SET = new Set(UI_ALLOWED_UPDATE_KEYS);

/**
 * Ensure state is hydrated before any logic relies on it (MV3 init race safe).
 * @feature f05 - State Management
 * @returns {Promise<Object>} Current hydrated state snapshot
 */
export function ensureInitialized() {
  if (hasInitialized) return Promise.resolve({ ...state });
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const storedState = await new Promise((resolve) => {
        chrome.storage.local.get(null, (data) => resolve(data || {}));
      });

      // Remove unknown keys from storage to avoid stale/deprecated state lingering
      const allowedKeys = new Set(Object.keys(DEFAULT_STATE));
      const deprecatedKeys = Object.keys(storedState || {}).filter((key) => !allowedKeys.has(key));

      if (deprecatedKeys.length) {
        await new Promise((resolve) => chrome.storage.local.remove(deprecatedKeys, () => resolve()));
      }

      const nextState = sanitizeStoredState(storedState);

      // Only persist when something actually needs to change (avoid write churn on MV3 restarts).
      const filteredStoredState = {};
      Object.keys(DEFAULT_STATE).forEach((key) => {
        if (key in (storedState || {})) filteredStoredState[key] = storedState[key];
      });
      const deltaToStore = diffState(filteredStoredState, nextState);

      if (Object.keys(deltaToStore).length) {
        await new Promise((resolve) => chrome.storage.local.set(deltaToStore, () => resolve()));
      }

      state = nextState;
      hasInitialized = true;

      console.log('🌸 State hydrated:', state);
      setupStorageReconcileListener();
      return { ...state };
    } catch (error) {
      console.error('🌸🌸🌸 Error hydrating state:', error);

      state = sanitizeStoredState(null);
      hasInitialized = true;
      setupStorageReconcileListener();
      return { ...state };
    } finally {
      // Allow GC of the init promise after completion.
      initPromise = null;
    }
  })();

  return initPromise;
}

// Load state from storage on initialization (legacy entrypoint)
/**
 * Initialize state from storage
 * @feature f05 - State Management
 */
export async function initState() {
  await ensureInitialized();
  return getState();
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
  if (!updates || typeof updates !== 'object') return false;

  updateChain = updateChain
    .then(async () => {
      await ensureInitialized();

      const nextState = computeNextState(state, updates);
      const delta = diffState(state, nextState);

      if (!Object.keys(delta).length) return true;

      // Update in-memory state
      state = nextState;

      // Persist to storage
      await new Promise((resolve) => chrome.storage.local.set(delta, () => resolve()));

      // Broadcast delta update to other parts of the extension
      broadcastStateDelta(delta);

      return true;
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error updating state:', error);
      return false;
    });

  return updateChain;
}

// Listen for state update requests
export function setupStateListeners() {
  setupStorageReconcileListener();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.getState) {
      (async () => {
        await ensureInitialized();

        const isTrusted = isTrustedExtensionSender(sender);
        const allowedKeys = isTrusted ? STATE_KEYS : UNTRUSTED_STATE_KEYS;

        if (Array.isArray(message.keys)) {
          const subset = {};
          message.keys.forEach((k) => {
            if (typeof k !== 'string' || !allowedKeys.includes(k)) return;
            subset[k] = state[k];
          });
          return subset;
        }

        if (typeof message.key === 'string') {
          if (!allowedKeys.includes(message.key)) return {};
          return { [message.key]: state[message.key] };
        }

        // Default: return full state only for trusted extension pages.
        if (isTrusted) return { ...state };

        const subset = {};
        allowedKeys.forEach((k) => {
          subset[k] = state[k];
        });
        return subset;
      })()
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('🌸🌸🌸 Error handling getState:', error);
          sendResponse({});
        });

      return true; // Keep channel open for async response
    } 
    else if (message.action === messageActions.updateState) {
      (async () => {
        await ensureInitialized();

        if (!message.payload || typeof message.payload !== 'object') {
          return { success: false, error: 'Invalid payload' };
        }

        const isTrusted = isTrustedExtensionSender(sender);
        if (!isTrusted) {
          return { success: false, error: 'Forbidden' };
        }

        const filteredPayload = filterPayloadKeys(message.payload, UI_ALLOWED_UPDATE_KEYS_SET);
        if (!Object.keys(filteredPayload).length) {
          return { success: false, error: 'No valid keys' };
        }

        const success = await updateState(filteredPayload);
        return { success: !!success };
      })()
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('🌸🌸🌸 Error handling updateState:', error);
          sendResponse({ success: false, error: error?.message || String(error) });
        });

      return true; // Keep channel open for async response
    }
    return false;
  });
}
