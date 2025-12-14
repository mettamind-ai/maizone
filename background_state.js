/**
 * MaiZone Browser Extension
 * State Management: Centralized state handling in background
 * @feature f05 - State Management
 */

import { DEFAULT_DISTRACTING_SITES, DEFAULT_DEEPWORK_BLOCKED_SITES } from './constants.js';

// Initial state
let state = {
  isEnabled: true,
  interactionLevel: 'balanced',
  currentTask: '',
  isInFlow: false,
  blockDistractions: true,
  textPredictionEnabled: true,
  breakReminderEnabled: true,
  notifyTextAnalysis: true,
  distractingSites: DEFAULT_DISTRACTING_SITES,
  deepWorkBlockedSites: DEFAULT_DEEPWORK_BLOCKED_SITES
};

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
    
    // Merge stored state with default state
    state = { ...state, ...storedState };
    
    // Ensure default state is saved to storage if not present
    await new Promise(resolve => {
      chrome.storage.local.set(state, () => resolve());
    });
    
    console.log('🌸 State initialized:', state);
    return state;
  } catch (error) {
    console.error('🌸 Error initializing state:', error);
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
    // Update in-memory state
    state = { ...state, ...updates };
    
    // Persist to storage
    await new Promise(resolve => {
      chrome.storage.local.set(updates, () => resolve());
    });
    
    // Broadcast state update to other parts of the extension
    chrome.runtime.sendMessage({ 
      action: 'stateUpdated', 
      state: updates
    }).catch(() => {
      // Ignore errors from no listeners
    });
    
    return true;
  } catch (error) {
    console.error('🌸 Error updating state:', error);
    return false;
  }
}

// Listen for state update requests
export function setupStateListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getState') {
      const requestedState = message.key ? { [message.key]: state[message.key] } : state;
      sendResponse(requestedState);
      return true;
    } 
    else if (message.action === 'updateState') {
      updateState(message.payload)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async response
    }
    return false;
  });
}
