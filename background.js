/**
 * MaiZone Browser Extension
 * Background Script: Central coordinator for all extension features
 * @feature f01 - Distraction Blocking
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 * @feature f05 - State Management
 * @feature f06 - ClipMD (Clipboard to Markdown)
 */

import { ensureInitialized, setupStateListeners } from './background_state.js';
import { initDistraction } from './background_distraction.js';
import { initBreakReminder, sendBreakReminder } from './background_breakReminder.js';
import { initClipmd, startClipmdMarkdownPicker } from './background_clipmd.js';
import { DEFAULT_DISTRACTING_SITES, DEFAULT_DEEPWORK_BLOCKED_SITES } from './constants.js';

/**
 * Summarize state for logs (privacy-first).
 * @param {Object} state - Full state object
 * @returns {Object}
 */
function summarizeStateForLog(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    isEnabled: !!s.isEnabled,
    blockDistractions: !!s.blockDistractions,
    isInFlow: !!s.isInFlow,
    breakReminderEnabled: !!s.breakReminderEnabled
  };
}

/**
 * Initialize background script
 */
function initBackgroundScript() {
  console.info('🌸 Mai background script initializing...');
  
  try {
    // MV3 reliability: register listeners synchronously (avoid missing wake events).
    setupStateListeners();
    
    // Initialize feature modules
    initDistraction();
    initBreakReminder();
    initClipmd();
    
    // Set up event listeners
    setupEventListeners();
    
    // Hydrate state after listeners are ready (safe with MV3 service worker lifecycle).
    ensureInitialized()
      .then((state) => console.info('🌸 State ready:', summarizeStateForLog(state)))
      .catch((error) => console.error('🌸🌸🌸 Error hydrating state:', error));

    console.info('🌸 Mai background script loaded successfully');
  } catch (error) {
    console.error('🌸🌸🌸 Error initializing background script:', error);
  }
}

/**
 * Set up various event listeners
 */
function setupEventListeners() {
  // Handle extension installation or update
  chrome.runtime.onInstalled.addListener(onInstalledListener);
  
  // Handle keyboard commands
  chrome.commands.onCommand.addListener(handleCommand);
}

/**
 * Handle keyboard commands
 */
function showNotification(title, message) {
  try {
    if (!chrome?.notifications?.create) return;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: typeof title === 'string' ? title : 'MaiZone',
      message: typeof message === 'string' ? message : ''
    });
  } catch {
    // ignore
  }
}

/**
 * Handle keyboard commands
 */
async function handleCommand(command) {
  console.log('🌸 Command received:', command);

  // MV3 reliability: wake handlers should hydrate state (even if this handler doesn't always need it).
  try {
    await ensureInitialized();
  } catch (error) {
    // ignore (ClipMD/Break reminder can still run without state)
  }

  if (command === 'test-break-reminder') {
    sendBreakReminder();
    console.log('🌸 Break reminder sent successfully');
    return;
  }

  if (command === 'clipmd-markdown') {
    try {
      const ok = await startClipmdMarkdownPicker();
      if (!ok) {
        showNotification('MaiZone', 'Không thể bật ClipMD trên tab này. Hãy mở trang http/https và thử lại nhé.');
      }
    } catch (error) {
      console.error('🌸🌸🌸 Error starting ClipMD:', error);
      showNotification('MaiZone', 'ClipMD gặp lỗi khi khởi chạy. Thử reload trang và bấm Alt+Q lại nhé.');
    }
  }
}

/**
 * Handle extension installation or update
 */
async function onInstalledListener(details) {
  console.info('🌸 Mai extension installed or updated:', details.reason);

  if (details.reason === 'install') {
    // Set default settings on first install
    setupDefaultSettings();
  }
}

/**
 * Setup default settings on first install
 */
async function setupDefaultSettings() {
  try {
    const { updateState } = await import('./background_state.js');
    
    await updateState({
      isEnabled: true,
      blockDistractions: true,
      breakReminderEnabled: false,
      distractingSites: DEFAULT_DISTRACTING_SITES,
      deepWorkBlockedSites: DEFAULT_DEEPWORK_BLOCKED_SITES
    });
    
    console.info('🌸 Default settings initialized on install');
  } catch (error) {
    console.error('🌸🌸🌸 Error setting up default settings:', error);
  }
}

// Start initialization
initBackgroundScript();
