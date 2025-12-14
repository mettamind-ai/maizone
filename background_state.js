/**
 * MaiZone Browser Extension
 * State Management: Centralized state handling in background
 * @feature f05 - State Management
 */

import { messageActions } from './actions.js';
import { DEFAULT_STATE, computeNextState, diffState, getDefaultState, sanitizeStoredState } from './state_core.js';

// In-memory state snapshot (hydrated lazily for MV3 reliability).
let state = getDefaultState();

// MV3 service worker can wake for events before async init finishes.
let initPromise = null;
let hasInitialized = false;

// Serialize state updates to avoid race conditions (popup + alarms + webNavigation).
let updateChain = Promise.resolve();

/***** INITIALIZATION (MV3-SAFE) *****/

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
      return { ...state };
    } catch (error) {
      console.error('🌸🌸🌸 Error hydrating state:', error);

      state = sanitizeStoredState(null);
      hasInitialized = true;
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
      try {
        chrome.runtime
          .sendMessage({
            action: messageActions.stateUpdated,
            delta,
            // Backward compatible field name (deprecated): older listeners used message.state.
            state: delta
          })
          .catch(() => {
            // Ignore errors from no listeners / SW lifecycle
          });
      } catch (broadcastError) {
        // Ignore broadcast errors during invalidation
      }

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

        const success = await updateState(message.payload);
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
