/**
 * MaiZone Browser Extension
 * Content Script: Monitors text input fields, displays UI elements
 * @feature f00 - Text Input Detection
 * @feature f01 - Distraction Blocking (UI part)
 * @feature f03 - Break Reminder (badge ticker fallback)
 * @feature f04c - Deep Work Mode Integration
 * @feature f06 - ClipMD (Clipboard to Markdown)
 * @feature f07 - ChatGPT Zen Hotkeys (chatgpt.com)
 * @feature f08 - Mindfulness Reminders (toast)
 * @feature f10 - Context Menu Quick Actions (toast)
 */

// Content scripts can be programmatically injected multiple times (install/update, retries).
// Wrap in an IIFE so repeated injections don't crash on top-level re-declarations.
(() => {

/******************************************************************************
 * MESSAGING (COMPAT LAYER)
 ******************************************************************************/

// Some browsers/versions may treat content scripts as classic scripts (no static `import`).
// Keep a local safe messaging helper to avoid module import issues entirely.

/**
 * Check whether extension context is still valid.
 * @returns {boolean} True if safe to call chrome.runtime APIs
 */
function isExtensionContextValid() {
  return !!(globalThis?.chrome?.runtime && chrome.runtime.id !== undefined);
}

/**
 * Send a message to the background script safely (timeout + invalidation handling).
 * @param {Object} message - Message payload
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=2000] - Timeout in ms
 * @returns {Promise<any|null>} Response object or null on failure/timeout
 */
async function sendMessageSafely(message, { timeoutMs = 2000 } = {}) {
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

/******************************************************************************
 * VARIABLES AND CONFIGURATION
 ******************************************************************************/

// Constants specific to content.js
const TYPING_INTERVAL = 500; // Typing detection interval (ms)

// [f07] ChatGPT helpers (domain-scoped; safe no-op elsewhere).
const CHATGPT_HOST_SUFFIX = 'chatgpt.com';
const CHATGPT_ZEN_STORAGE_KEY = 'chatgptZenMode';
const CHATGPT_ZEN_SELECTORS = Object.freeze(['.cursor-pointer', '#page-header', '#thread-bottom', '#full_editor']);
const CHATGPT_TEMPLATE = "You are very smart, intellectually curious, empathetic, patient, nurturing, and engaging. You proceed in small steps, asking if the user understands and has completed a step, and waiting for their answer before continuing. You should be concise, direct, and without unnecessary explanations or summaries. Avoid giving unnecessary details or deviating from the user's request, focusing solely on the specific question at hand. Trình bày output text dưới dạng văn xuôi, dễ hiểu, ít gạch đầu dòng. Các lệnh tắt cần ghi nhớ: `vx`: là lệnh cho bạn viết lại phản hồi gần nhất dưới dạng văn xuôi. `vd`: là lệnh cho bạn cho thêm ví dụ minh hoạ cho phản hồi gần nhất.";

// [f03] Opera badge tick fallback: keep badge updated per-second by keeping the SW active via a Port.
const OPERA_BADGE_PORT_NAME = 'maizoneBreakReminderBadgeTicker';
const OPERA_BADGE_PORT_KEEPALIVE_MS = 25_000;

// Message actions (prefer shared global injected via `actions_global.js`).
const messageActions = globalThis.MAIZONE_ACTIONS || Object.freeze({
  checkCurrentUrl: 'checkCurrentUrl',
  youtubeNavigation: 'youtubeNavigation',
  closeTab: 'closeTab',
  distractingWebsite: 'distractingWebsite',
  maiToast: 'maiToast',
  mindfulnessToast: 'mindfulnessToast',
  clipmdStart: 'clipmdStart',
  clipmdConvertMarkdown: 'clipmdConvertMarkdown',
  resetBreakReminder: 'resetBreakReminder',
  getBreakReminderState: 'getBreakReminderState',
  breakReminderBadgeTick: 'breakReminderBadgeTick',
  getState: 'getState',
  updateState: 'updateState',
  stateUpdated: 'stateUpdated'
});

// Global variables
let currentElement = null;
let lastContentLength = 0;
let typingTimer = null;
let isDistractionBlockingEnabled = true;
let domListenersAttached = false;

// [f03] Opera badge tick fallback state
let operaBadgePort = null;
let operaBadgePortKeepaliveIntervalId = null;

// [f07] ChatGPT helpers state
let isChatgptZenModeEnabled = false;
let chatgptZenObserver = null;
let chatgptZenApplyTimeoutId = null;
let chatgptToastTimeoutId = null;
let mindfulnessToastTimeoutId = null;
let mindfulnessToastFadeTimeoutId = null;
let mindfulnessAudioContext = null;
let mindfulnessAudioUnlocked = false;
let hasRegisteredMindfulnessAudioUnlock = false;

// YouTube SPA monitoring
let youtubeObserver = null;
let youtubeFallbackIntervalId = null;
let lastYoutubeUrl = '';

// Generic Mai toast (non-mindfulness)
let maiToastTimeoutId = null;
let maiToastFadeTimeoutId = null;

// [f01] When lists/flow change while tab is hidden, defer re-check until visible to avoid
// showing an auto-close warning in background tabs.
let pendingDistractionRecheckWhenVisible = false;

/******************************************************************************
 * INITIALIZATION
 ******************************************************************************/

/**
 * Initialize content script
 */
function initialize() {
  // Prevent double-initialization if this file gets programmatically injected.
  if (globalThis.__MAIZONE_CONTENT_SCRIPT_INITIALIZED) return;
  globalThis.__MAIZONE_CONTENT_SCRIPT_INITIALIZED = true;

  console.log('🌸 Mai content script initialized');

  // Load settings early so we can avoid unnecessary work for disabled features
  chrome.storage.local.get(
    ['blockDistractions', CHATGPT_ZEN_STORAGE_KEY, 'isInFlow', 'breakReminderEnabled', 'currentTask'],
    (result) => {
      const { blockDistractions } = result || {};
      isDistractionBlockingEnabled = typeof blockDistractions === 'boolean' ? blockDistractions : true;

      const rawChatgptZenMode = result?.[CHATGPT_ZEN_STORAGE_KEY];
      isChatgptZenModeEnabled = typeof rawChatgptZenMode === 'boolean' ? rawChatgptZenMode : false;

      syncContentScriptActiveState();
      syncOperaBadgeTickFallback(result || {});
    }
  );
  
  // Listen for messages from background script (attach once; will ignore when disabled)
  chrome.runtime.onMessage.addListener(handleBackgroundMessages);

  // [f04c] Listen for deep work status changes and settings
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.blockDistractions) {
      isDistractionBlockingEnabled = !!changes.blockDistractions.newValue;

      if (!isDistractionBlockingEnabled) {
        stopYouTubeNavigationObserver();
        document.getElementById('mai-distraction-warning')?.remove?.();
      } else if (window.location.hostname.includes('youtube.com')) {
        startYouTubeNavigationObserver();
        checkIfDistractingSite();
      }
    }

    if (changes[CHATGPT_ZEN_STORAGE_KEY]) {
      const nextValue = changes[CHATGPT_ZEN_STORAGE_KEY]?.newValue;
      isChatgptZenModeEnabled = typeof nextValue === 'boolean' ? nextValue : false;
      syncChatgptHelperActiveState();
    }

    if (changes.isInFlow) {
      console.log('🌸 Deep Work status changed:', changes.isInFlow.newValue);
      // Khi trạng thái flow thay đổi, kiểm tra lại URL hiện tại để áp dụng chặn trang nhắn tin (f04c)
      scheduleDistractionRecheck();
    }

    if (changes.distractingSites) {
      scheduleDistractionRecheck();
    }

    if (changes.deepWorkBlockedSites) {
      scheduleDistractionRecheck();
    }

    // [f03] Opera badge tick fallback: sync on any timer-related change.
    if (
      changes.isInFlow ||
      changes.breakReminderEnabled ||
      changes.currentTask ||
      changes.reminderStartTime ||
      changes.reminderInterval ||
      changes.reminderExpectedEndTime
    ) {
      syncOperaBadgeTickFallback();
    }
  });
}

/**
 * Attach DOM listeners only when extension is enabled.
 * @returns {void}
 */
function attachDomListeners() {
  if (domListenersAttached) return;

  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  document.addEventListener('click', handleClick);
  document.addEventListener('visibilitychange', () => {
    syncOperaBadgeTickFallback();
    if (document.visibilityState === 'visible') runPendingDistractionRecheck();
  });
  setupMindfulnessAudioUnlockListeners();

  domListenersAttached = true;
}

/**
 * Sync features based on current settings.
 * @returns {void}
 */
function syncContentScriptActiveState() {
  attachDomListeners();

  if (isDistractionBlockingEnabled && window.location.hostname.includes('youtube.com')) {
    startYouTubeNavigationObserver();
  } else {
    stopYouTubeNavigationObserver();
  }

  syncChatgptHelperActiveState();
  checkIfDistractingSite();
}

/******************************************************************************
 * OPERA BADGE TICK FALLBACK [f03]
 ******************************************************************************/

/**
 * Check whether the browser is Opera (best-effort via UA marker).
 * @returns {boolean}
 */
function isOperaBrowser() {
  try {
    const ua = typeof navigator?.userAgent === 'string' ? navigator.userAgent : '';
    return /\bOPR\//.test(ua);
  } catch {
    return false;
  }
}

/**
 * Determine whether Deep Work timer is active (privacy-first: no task content logging).
 * @param {Object} data - Storage snapshot
 * @returns {boolean}
 */
function isDeepWorkTimerActive(data) {
  const isInFlow = !!data?.isInFlow;
  const breakReminderEnabled = !!data?.breakReminderEnabled;
  const hasTask = !!(data?.currentTask && String(data.currentTask).trim());
  return !!(isInFlow && breakReminderEnabled && hasTask);
}

/**
 * Start per-second ticker that wakes SW to update badge.
 * @returns {void}
 */
function startOperaBadgeTickFallback() {
  if (operaBadgePort) return;

  try {
    operaBadgePort = chrome.runtime.connect({ name: OPERA_BADGE_PORT_NAME });
  } catch {
    operaBadgePort = null;
    return;
  }

  try {
    operaBadgePort.onDisconnect.addListener(() => {
      operaBadgePort = null;
      if (operaBadgePortKeepaliveIntervalId) clearInterval(operaBadgePortKeepaliveIntervalId);
      operaBadgePortKeepaliveIntervalId = null;
      syncOperaBadgeTickFallback();
    });
  } catch {
    // ignore
  }

  // Keepalive: some browsers may still stop the SW if no events arrive.
  operaBadgePortKeepaliveIntervalId = setInterval(() => {
    try {
      operaBadgePort?.postMessage?.({ type: 'keepalive' });
    } catch {
      // ignore
    }
  }, OPERA_BADGE_PORT_KEEPALIVE_MS);

  // Ask background to start per-second badge ticker (best-effort).
  try {
    operaBadgePort.postMessage({ type: 'start' });
  } catch {
    // ignore
  }

  // Also kick a one-off tick message for immediate update on some browsers.
  sendMessageSafely({ action: messageActions.breakReminderBadgeTick }, { timeoutMs: 800 }).catch(() => {});
}

/**
 * Stop Opera badge tick fallback.
 * @returns {void}
 */
function stopOperaBadgeTickFallback() {
  if (operaBadgePortKeepaliveIntervalId) clearInterval(operaBadgePortKeepaliveIntervalId);
  operaBadgePortKeepaliveIntervalId = null;

  try {
    operaBadgePort?.postMessage?.({ type: 'stop' });
  } catch {
    // ignore
  }

  try {
    operaBadgePort?.disconnect?.();
  } catch {
    // ignore
  }

  operaBadgePort = null;
}

/**
 * Sync Opera badge tick fallback with current timer state (only runs on Opera).
 * @param {Object} [prefetched] - Optional storage snapshot to avoid extra reads
 * @returns {void}
 */
function syncOperaBadgeTickFallback(prefetched) {
  if (!isOperaBrowser()) return;

  const syncWithData = (data) => {
    const shouldRun = isDeepWorkTimerActive(data);
    if (shouldRun) startOperaBadgeTickFallback();
    else stopOperaBadgeTickFallback();
  };

  if (prefetched && typeof prefetched === 'object') {
    syncWithData(prefetched);
    return;
  }

  try {
    chrome.storage.local.get(['isInFlow', 'breakReminderEnabled', 'currentTask'], (data) => syncWithData(data || {}));
  } catch {
    stopOperaBadgeTickFallback();
  }
}


/******************************************************************************
 * EVENT HANDLERS
 ******************************************************************************/

/**
 * [f00] Xử lý sự kiện khi người dùng focus vào một text input element
 * Phần cốt lõi của tính năng f00 - nhận diện khi text input elem được focus
 * @param {FocusEvent} event - The focus event object
 * @returns {void}
 */
function handleFocusIn(event) {
  try {
    const element = event.target;
    if (isTextInput(element)) {
      setCurrentElement(element);
      console.log('🌸 Text field focused:', {
        tag: element.tagName.toLowerCase(),
        id: element.id || 'no-id',
        class: element.className || 'no-class',
        placeholder: element.placeholder || ''
      });
    }
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) {
      // Extension was updated or reloaded - quietly fail
      console.warn('🌸🌸🌸 Extension context invalidated during focus handling');
      return;
    }
    console.warn('🌸🌸🌸 Error in handleFocusIn:', error);
  }
}

/**
 * Handle click on text input elements
 */
function handleClick(event) {
  try {
    const element = event.target;
    if (isTextInput(element) && element !== currentElement) {
      setCurrentElement(element);
    }
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) {
      // Extension was updated or reloaded - quietly fail
      console.warn('🌸🌸🌸 Extension context invalidated during click handling');
      return;
    }
    console.warn('🌸🌸🌸 Error in handleClick:', error);
  }
}

/**
 * Handle typing events (shared by keydown and keyup)
 */
function handleTypingEvent(event) {
  if (!currentElement) return;
  
  clearTimeout(typingTimer);

  if (event?.key === 'Enter' && !event.shiftKey) {
    captureCurrentContent();
    return;
  }

  typingTimer = setTimeout(() => captureCurrentContent(), TYPING_INTERVAL);
}

/**
 * Handle keydown events
 */
function handleKeyDown(event) {
  if (handleChatgptHotkeys(event)) return;
  if (handleClipmdHotkey(event)) return;
  handleTypingEvent(event);
}

/**
 * Handle keyup events
 */
function handleKeyUp(event) {
  handleTypingEvent(event);
}

/******************************************************************************
 * CLIPMD HOTKEY (IN-PAGE FALLBACK) [f06]
 ******************************************************************************/

/**
 * Fallback hotkey handler for ClipMD when Chrome shortcuts are not configured.
 * @feature f06 - ClipMD (Clipboard to Markdown)
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {boolean} True if handled
 */
function handleClipmdHotkey(event) {
  if (!event?.isTrusted) return false;
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.shiftKey) return false;
  if (event.repeat) return false;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key !== 'q') return false;

  event.preventDefault?.();
  event.stopPropagation?.();

  // Prefer the "native" inspect overlay flow (background), fallback to in-page picker.
  (async () => {
    const reply = await sendMessageSafely(
      { action: messageActions.clipmdStart, data: { mode: 'markdown', source: 'contentHotkey' } },
      { timeoutMs: 2500 }
    );

    if (reply?.success) return;
    startClipmdPickMode();
  })();

  return true;
}

/******************************************************************************
 * CHATGPT ZEN HOTKEYS (chatgpt.com) [f07]
 ******************************************************************************/

/**
 * Check whether current page is chatgpt.com (or subdomain).
 * @returns {boolean}
 */
function isChatgptHost() {
  const host = (window.location?.hostname || '').toLowerCase();
  return host === CHATGPT_HOST_SUFFIX || host.endsWith(`.${CHATGPT_HOST_SUFFIX}`);
}

/**
 * Sync ChatGPT helper effects with current enabled state.
 * @returns {void}
 */
function syncChatgptHelperActiveState() {
  if (!isChatgptHost()) return;

  if (isChatgptZenModeEnabled) {
    applyChatgptZenMode(true, { scope: 'all' });
    startChatgptZenObserver();
    return;
  }

  stopChatgptZenObserver();
  restoreAllChatgptZenHiddenElements();
}

/**
 * Handle ChatGPT-only hotkeys.
 * - Alt+Z: toggle "Zen" (hide/show selected UI blocks)
 * - Alt+S: paste a prompt template into the current editor
 * @feature f07 - ChatGPT Zen Hotkeys (chatgpt.com)
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {boolean} True if handled
 */
function handleChatgptHotkeys(event) {
  if (!isChatgptHost()) return false;
  if (!event?.isTrusted) return false;
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.shiftKey) return false;
  if (event.repeat) return false;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';

  if (key === 'z') {
    toggleChatgptZenMode();
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  if (key === 's') {
    const ok = pasteChatgptTemplate();
    if (!ok) showChatgptToast('🌸 Không tìm thấy ô để dán. Click vào ô nhập trước nhé.');
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  return false;
}

/**
 * Toggle Zen mode and persist to storage.
 * @returns {void}
 */
function toggleChatgptZenMode() {
  isChatgptZenModeEnabled = !isChatgptZenModeEnabled;
  syncChatgptHelperActiveState();

  try {
    chrome.storage.local.set({ [CHATGPT_ZEN_STORAGE_KEY]: isChatgptZenModeEnabled });
  } catch {
    // ignore (context may be invalidated)
  }

  showChatgptToast(isChatgptZenModeEnabled ? '🌸 Zen mode: ON (Alt+Z để tắt)' : '🌸 Zen mode: OFF (Alt+Z để bật)');
}

/**
 * Apply or restore Zen mode for known selectors.
 * @param {boolean} enable - True to hide, false to restore
 * @param {Object} [options]
 * @param {'all'|'observed'} [options.scope='all'] - Apply to all selectors or only "stable" observed selectors
 * @returns {void}
 */
function applyChatgptZenMode(enable, { scope = 'all' } = {}) {
  const selectors =
    scope === 'observed' ? CHATGPT_ZEN_SELECTORS.filter((s) => typeof s === 'string' && s.trim().startsWith('#')) : CHATGPT_ZEN_SELECTORS;

  if (!enable) {
    restoreAllChatgptZenHiddenElements();
    return;
  }

  selectors.forEach((selector) => {
    if (typeof selector !== 'string') return;
    const el = document.querySelector(selector);
    if (!el) return;
    hideElementForZen(el);
  });
}

/**
 * Hide an element and remember its previous inline display.
 * @param {Element} el - DOM element
 * @returns {void}
 */
function hideElementForZen(el) {
  if (!el || !(el instanceof HTMLElement)) return;
  if (el.dataset?.maizoneZenHidden === '1') return;

  const prevDisplay = el.style.display;
  const prevPriority = el.style.getPropertyPriority?.('display') || '';

  el.dataset.maizoneZenHidden = '1';
  el.dataset.maizoneZenPrevDisplay = prevDisplay;
  el.dataset.maizoneZenPrevDisplayPriority = prevPriority;

  try {
    el.style.setProperty('display', 'none', 'important');
  } catch {
    el.style.display = 'none';
  }
}

/**
 * Restore all elements hidden by Zen mode.
 * @returns {void}
 */
function restoreAllChatgptZenHiddenElements() {
  try {
    const hiddenEls = document.querySelectorAll('[data-maizone-zen-hidden="1"]');
    hiddenEls.forEach((el) => restoreElementFromZen(el));
  } catch {
    // ignore
  }
}

/**
 * Restore a single element that was hidden by Zen mode.
 * @param {Element} el - DOM element
 * @returns {void}
 */
function restoreElementFromZen(el) {
  if (!el || !(el instanceof HTMLElement)) return;
  if (el.dataset?.maizoneZenHidden !== '1') return;

  const prevDisplay = typeof el.dataset.maizoneZenPrevDisplay === 'string' ? el.dataset.maizoneZenPrevDisplay : '';
  const prevPriority = typeof el.dataset.maizoneZenPrevDisplayPriority === 'string' ? el.dataset.maizoneZenPrevDisplayPriority : '';

  if (prevDisplay) {
    try {
      el.style.setProperty('display', prevDisplay, prevPriority || '');
    } catch {
      el.style.display = prevDisplay;
    }
  } else {
    try {
      el.style.removeProperty('display');
    } catch {
      el.style.display = '';
    }
  }

  delete el.dataset.maizoneZenHidden;
  delete el.dataset.maizoneZenPrevDisplay;
  delete el.dataset.maizoneZenPrevDisplayPriority;
}

/**
 * Start a lightweight observer to re-apply Zen for stable selectors on SPA DOM changes.
 * NOTE: Only re-applies ID selectors to avoid creeping hides on broad class selectors.
 * @returns {void}
 */
function startChatgptZenObserver() {
  if (!isChatgptHost()) return;
  if (!isChatgptZenModeEnabled) return;
  if (chatgptZenObserver) return;

  const root = document.documentElement;
  if (!root) return;

  chatgptZenObserver = new MutationObserver(() => scheduleChatgptZenObservedApply());
  chatgptZenObserver.observe(root, { childList: true, subtree: true });
}

/**
 * Stop Zen observer.
 * @returns {void}
 */
function stopChatgptZenObserver() {
  try {
    chatgptZenObserver?.disconnect?.();
  } catch {
    // ignore
  }
  chatgptZenObserver = null;

  clearTimeout(chatgptZenApplyTimeoutId);
  chatgptZenApplyTimeoutId = null;
}

/**
 * Debounce observed Zen re-apply to keep overhead low on streaming UIs.
 * @returns {void}
 */
function scheduleChatgptZenObservedApply() {
  if (!isChatgptHost()) return;
  if (!isChatgptZenModeEnabled) return;
  if (chatgptZenApplyTimeoutId) return;

  chatgptZenApplyTimeoutId = setTimeout(() => {
    chatgptZenApplyTimeoutId = null;
    applyChatgptZenMode(true, { scope: 'observed' });
  }, 180);
}

/**
 * Paste the prompt template into the active editor (or ChatGPT composer as fallback).
 * @returns {boolean} True if paste succeeded
 */
function pasteChatgptTemplate() {
  const active = document.activeElement;
  if (setEditableText(active, CHATGPT_TEMPLATE)) {
    showChatgptToast('🌸 Đã dán prompt mẫu (Alt+S).');
    return true;
  }

  const fallback = findChatgptComposerElement();
  if (fallback && setEditableText(fallback, CHATGPT_TEMPLATE)) {
    showChatgptToast('🌸 Đã dán prompt mẫu (Alt+S).');
    return true;
  }

  return false;
}

/**
 * Attempt to locate ChatGPT composer textarea for convenience.
 * @returns {HTMLElement|null}
 */
function findChatgptComposerElement() {
  const candidates = [
    'textarea#prompt-textarea',
    'textarea[name="prompt"]',
    'form textarea',
    'textarea'
  ];

  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (!el || !(el instanceof HTMLElement)) continue;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) continue; // hidden
    return el;
  }

  return null;
}

/**
 * Set text for an editable element and dispatch input events so React/Vue can detect changes.
 * @param {Element|null} el - Target element
 * @param {string} text - Text to set
 * @returns {boolean} True if updated
 */
function setEditableText(el, text) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const nextText = typeof text === 'string' ? text : '';

  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (inputType === 'password') return false;
    el.focus?.();
    el.value = nextText;
    el.dispatchEvent?.(new Event('input', { bubbles: true }));
    el.dispatchEvent?.(new Event('change', { bubbles: true }));
    try {
      el.setSelectionRange?.(nextText.length, nextText.length);
    } catch {
      // ignore
    }
    return true;
  }

  if (tag === 'textarea') {
    el.focus?.();
    el.value = nextText;
    el.dispatchEvent?.(new Event('input', { bubbles: true }));
    el.dispatchEvent?.(new Event('change', { bubbles: true }));
    try {
      el.setSelectionRange?.(nextText.length, nextText.length);
    } catch {
      // ignore
    }
    return true;
  }

  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    el.focus?.();
    el.textContent = nextText;
    el.dispatchEvent?.(new Event('input', { bubbles: true }));
    return true;
  }

  return false;
}

/**
 * Show a minimal toast on ChatGPT to confirm actions.
 * @param {string} text - Toast text
 * @returns {void}
 */
function showChatgptToast(text) {
  if (!isChatgptHost()) return;
  const message = typeof text === 'string' ? text : '';
  if (!message) return;

  let el = document.getElementById('mai-chatgpt-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mai-chatgpt-toast';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      zIndex: '99999999',
      maxWidth: '92vw',
      padding: '10px 12px',
      borderRadius: '12px',
      backgroundColor: 'rgba(0,0,0,0.85)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: '13px',
      lineHeight: '1.25',
      boxShadow: '0 6px 18px rgba(0,0,0,0.28)'
    });
    document.documentElement.appendChild(el);
  }

  el.textContent = message;

  clearTimeout(chatgptToastTimeoutId);
  chatgptToastTimeoutId = setTimeout(() => {
    removeChatgptToast();
  }, 1200);
}

/**
 * Remove ChatGPT toast (if any).
 * @returns {void}
 */
function removeChatgptToast() {
  clearTimeout(chatgptToastTimeoutId);
  chatgptToastTimeoutId = null;
  document.getElementById('mai-chatgpt-toast')?.remove?.();
}

/******************************************************************************
 * MAI TOAST (GENERIC) [f10]
 ******************************************************************************/

const MAI_TOAST_VISIBLE_MS = 2200;
const MAI_TOAST_FADE_MS = 320;

/**
 * Show a small Mai toast (site-agnostic, no chime).
 * @feature f10 - Context Menu Quick Actions
 * @param {string} text - Toast text
 * @returns {void}
 */
function showMaiToast(text) {
  const message = typeof text === 'string' ? text : '';
  if (!message) return;

  ensureMaiToastStyles();

  let el = document.getElementById('mai-generic-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mai-generic-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      zIndex: '99999999',
      maxWidth: 'min(560px, 92vw)',
      padding: '10px 12px',
      borderRadius: '12px',
      backgroundColor: 'rgba(0,0,0,0.86)',
      border: '1px solid rgba(255, 143, 171, 0.55)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      lineHeight: '1.25',
      boxShadow: '0 10px 24px rgba(0,0,0,0.28), 0 0 0 5px rgba(255, 143, 171, 0.06)',
      textAlign: 'center',
      letterSpacing: '0.1px',
      pointerEvents: 'none',
      opacity: '1',
      transition: `opacity ${MAI_TOAST_FADE_MS}ms ease, transform ${MAI_TOAST_FADE_MS}ms ease`,
      willChange: 'transform, opacity',
      animation: 'maiGenericToastIn 220ms ease-out'
    });

    document.documentElement.appendChild(el);
  }

  el.textContent = message;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0px)';

  clearTimeout(maiToastTimeoutId);
  clearTimeout(maiToastFadeTimeoutId);

  maiToastTimeoutId = setTimeout(() => {
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(6px)';

    maiToastFadeTimeoutId = setTimeout(() => {
      removeMaiToast();
    }, MAI_TOAST_FADE_MS + 60);
  }, MAI_TOAST_VISIBLE_MS);
}

/**
 * Ensure CSS keyframes for generic toast exist.
 * @feature f10 - Context Menu Quick Actions
 * @returns {void}
 */
function ensureMaiToastStyles() {
  const id = 'mai-generic-toast-styles';
  if (document.getElementById(id)) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    @keyframes maiGenericToastIn {
      from { opacity: 0; transform: translateX(-50%) translateY(8px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0px); }
    }
  `;
  document.documentElement.appendChild(style);
}

/**
 * Remove generic toast (if any).
 * @feature f10 - Context Menu Quick Actions
 * @returns {void}
 */
function removeMaiToast() {
  clearTimeout(maiToastTimeoutId);
  clearTimeout(maiToastFadeTimeoutId);
  maiToastTimeoutId = null;
  maiToastFadeTimeoutId = null;
  document.getElementById('mai-generic-toast')?.remove?.();
}

/******************************************************************************
 * MINDFULNESS TOAST [f08]
 ******************************************************************************/

const MINDFULNESS_TOAST_VISIBLE_MS = 10_000;
const MINDFULNESS_TOAST_FADE_MS = 450;

/**
 * Show a gentle mindfulness toast (site-agnostic).
 * @feature f08 - Mindfulness Reminders
 * @param {string} text - Toast text
 * @returns {void}
 */
function showMindfulnessToast(text) {
  const message = typeof text === 'string' ? text : '';
  if (!message) return;

  ensureMindfulnessToastStyles();

  let el = document.getElementById('mai-mindfulness-toast');
  let labelEl = el?.querySelector?.('#mai-mindfulness-toast-label') || null;
  let prefixEl = el?.querySelector?.('#mai-mindfulness-toast-prefix') || null;
  let suffixEl = el?.querySelector?.('#mai-mindfulness-toast-suffix') || null;

  if (!el) {
    el = document.createElement('div');
    el.id = 'mai-mindfulness-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    Object.assign(el.style, {
      position: 'fixed',
      top: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999999',
      maxWidth: 'min(560px, 92vw)',
      padding: '12px 14px',
      borderRadius: '14px',
      backgroundColor: 'rgba(0,0,0,0.88)',
      border: '1px solid rgba(255, 143, 171, 0.55)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '1.25',
      boxShadow: '0 14px 34px rgba(0,0,0,0.32), 0 0 0 6px rgba(255, 143, 171, 0.08)',
      textAlign: 'center',
      letterSpacing: '0.1px',
      pointerEvents: 'none',
      willChange: 'transform, opacity'
    });

    prefixEl = document.createElement('span');
    prefixEl.id = 'mai-mindfulness-toast-prefix';
    prefixEl.textContent = '🌸';
    Object.assign(prefixEl.style, { marginRight: '8px' });

    labelEl = document.createElement('span');
    labelEl.id = 'mai-mindfulness-toast-label';
    labelEl.textContent = '';

    suffixEl = document.createElement('span');
    suffixEl.id = 'mai-mindfulness-toast-suffix';
    suffixEl.textContent = '🌸';
    Object.assign(suffixEl.style, { marginLeft: '8px' });

    el.appendChild(prefixEl);
    el.appendChild(labelEl);
    el.appendChild(suffixEl);

    document.documentElement.appendChild(el);
  }

  // Backward compatible: if toast exists from an older version, add missing prefix/suffix.
  if (el && !prefixEl) {
    prefixEl = document.createElement('span');
    prefixEl.id = 'mai-mindfulness-toast-prefix';
    prefixEl.textContent = '🌸';
    Object.assign(prefixEl.style, { marginRight: '8px' });
    try {
      el.insertBefore(prefixEl, el.firstChild);
    } catch {
      // ignore
    }
  }

  if (el && !suffixEl) {
    suffixEl = document.createElement('span');
    suffixEl.id = 'mai-mindfulness-toast-suffix';
    suffixEl.textContent = '🌸';
    Object.assign(suffixEl.style, { marginLeft: '8px' });
    try {
      el.appendChild(suffixEl);
    } catch {
      // ignore
    }
  }

  const cleanMessage = message.replace(/^\s*🌸\s*/u, '');
  if (labelEl) labelEl.textContent = cleanMessage;

  // Ensure fade transition exists even if the element was created by an older version.
  try {
    el.style.transition = `opacity ${MINDFULNESS_TOAST_FADE_MS}ms ease`;
    el.style.opacity = '1';
  } catch {
    // ignore
  }

  // Visual attention: restart entrance animation.
  try {
    el.classList.remove('mai-mindfulness-toast--show');
    // Force reflow to restart animation.
    el.offsetHeight;
    el.classList.add('mai-mindfulness-toast--show');
  } catch {
    // ignore
  }

  // Sound (best-effort): if blocked by autoplay policies, just ignore.
  playMindfulnessChime().catch(() => {});

  clearTimeout(mindfulnessToastTimeoutId);
  clearTimeout(mindfulnessToastFadeTimeoutId);

  mindfulnessToastFadeTimeoutId = setTimeout(() => {
    try {
      el.style.opacity = '0';
    } catch {
      // ignore
    }
  }, MINDFULNESS_TOAST_VISIBLE_MS);

  mindfulnessToastTimeoutId = setTimeout(() => {
    removeMindfulnessToast();
  }, MINDFULNESS_TOAST_VISIBLE_MS + MINDFULNESS_TOAST_FADE_MS);
}

/**
 * Ensure CSS (keyframes + reduced-motion handling) exists for the mindfulness toast.
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function ensureMindfulnessToastStyles() {
  const styleId = 'mai-mindfulness-toast-style';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    #mai-mindfulness-toast.mai-mindfulness-toast--show {
      animation: maiMindfulnessToastIn 260ms ease-out, maiMindfulnessToastPulse 1200ms ease-in-out 2;
    }

    @keyframes maiMindfulnessToastIn {
      0% { opacity: 0; transform: translateX(-50%) translateY(-10px) scale(0.985); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
    }

    @keyframes maiMindfulnessToastPulse {
      0% { box-shadow: 0 14px 34px rgba(0,0,0,0.32), 0 0 0 6px rgba(255, 143, 171, 0.08); }
      50% { box-shadow: 0 18px 44px rgba(0,0,0,0.36), 0 0 0 10px rgba(255, 143, 171, 0.14); }
      100% { box-shadow: 0 14px 34px rgba(0,0,0,0.32), 0 0 0 6px rgba(255, 143, 171, 0.08); }
    }

    @media (prefers-reduced-motion: reduce) {
      #mai-mindfulness-toast.mai-mindfulness-toast--show {
        animation: none !important;
      }
    }
  `;

  document.documentElement.appendChild(style);
}

/**
 * Unlock mindfulness audio after a user gesture (required by autoplay policies).
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function setupMindfulnessAudioUnlockListeners() {
  if (hasRegisteredMindfulnessAudioUnlock) return;
  hasRegisteredMindfulnessAudioUnlock = true;

  const unlock = () => {
    mindfulnessAudioUnlocked = true;
    primeMindfulnessAudioContext();
  };

  // Capture + once: minimal overhead and counts as a user gesture on the page.
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true, once: true });
  document.addEventListener('keydown', unlock, { capture: true, passive: true, once: true });
}

/**
 * Create/resume AudioContext (must be called from a user gesture).
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function primeMindfulnessAudioContext() {
  try {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;
    if (!mindfulnessAudioContext) mindfulnessAudioContext = new AudioCtx();
    mindfulnessAudioContext.resume?.().catch(() => {});
  } catch {
    // ignore
  }
}

/**
 * Play a short, gentle chime (best-effort).
 * NOTE: Some sites may block playback due to autoplay policies; we ignore failures.
 * @feature f08 - Mindfulness Reminders
 * @returns {Promise<boolean>} True if a chime was scheduled
 */
async function playMindfulnessChime() {
  try {
    if (!mindfulnessAudioUnlocked) return false;

    const ctx = mindfulnessAudioContext;
    if (!ctx || ctx.state !== 'running') return false;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, now); // G5
    osc.frequency.setValueAtTime(988, now + 0.11); // B5
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.22);

    // Cleanup connections after the sound ends (avoid leaks).
    osc.onended = () => {
      try { osc.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    };

    return true;
  } catch {
    return false;
  }
}

/**
 * Remove mindfulness toast (if any).
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function removeMindfulnessToast() {
  clearTimeout(mindfulnessToastTimeoutId);
  mindfulnessToastTimeoutId = null;
  clearTimeout(mindfulnessToastFadeTimeoutId);
  mindfulnessToastFadeTimeoutId = null;
  document.getElementById('mai-mindfulness-toast')?.remove?.();
}

/******************************************************************************
 * CONTENT ANALYSIS
 ******************************************************************************/

/**
 * Capture and analyze current content
 */
function captureCurrentContent() {
  if (!currentElement) return;
  const currentLength = getCurrentElementContentLength();
  if (currentLength !== lastContentLength) {
    console.debug('🌸 Content updated (len):', currentLength);
    lastContentLength = currentLength;
  }
}

/**
 * Get content length from current element (avoid storing content for privacy).
 */
function getCurrentElementContentLength() {
  if (!currentElement) return 0;
  const tagName = currentElement.tagName.toLowerCase();
  if (tagName === 'textarea' || tagName === 'input') {
    return (currentElement.value || '').length;
  }
  if (currentElement.getAttribute('contenteditable') === 'true') {
    return (currentElement.innerText || '').length;
  }
  return 0;
}



/******************************************************************************
 * UTILITY FUNCTIONS
 ******************************************************************************/

/**
 * Check if element is a text input
 */
function isTextInput(element) {
  if (!element?.tagName) return false;
  const tagName = element.tagName.toLowerCase();
  
  if (tagName === 'textarea') return true;
  if (tagName === 'input') {
    const inputType = element.type?.toLowerCase();
    // Never monitor password fields.
    return ['text', 'email', 'search', 'url', 'tel', 'number'].includes(inputType);
  }
  return element.getAttribute('contenteditable') === 'true';
}

/**
 * Set current focused element
 */
function setCurrentElement(element) {
  try {
    currentElement = element;
    lastContentLength = getCurrentElementContentLength();
  } catch (error) {
    console.warn('🌸🌸🌸 Error in setCurrentElement:', error);
    // Prevent further errors by resetting the current element
    currentElement = null;
  }
}

/******************************************************************************
 * MESSAGE HANDLING
 ******************************************************************************/

/**
 * Handle messages from background script
 */
function handleBackgroundMessages(message, sender, sendResponse) {
  if (message?.action === messageActions.maiToast) {
    const text = typeof message?.data?.text === 'string' ? message.data.text : '';
    showMaiToast(text);
    sendResponse?.({ ok: true });
    return true;
  }

  if (message?.action === messageActions.mindfulnessToast) {
    const text = typeof message?.data?.text === 'string' ? message.data.text : '';
    showMindfulnessToast(text);
    sendResponse?.({ ok: true });
    return true;
  }

  if (message?.action === messageActions.stateUpdated) {
    // [f03] Opera: ensure badge ticker fallback stays in sync with background state updates.
    syncOperaBadgeTickFallback();
    sendResponse?.({ received: true });
    return true;
  }

  if (message?.action === messageActions.clipmdStart) {
    startClipmdPickMode();
    sendResponse({ received: true });
    return true;
  }

  if (message?.action !== messageActions.distractingWebsite) return false;
  if (!isDistractionBlockingEnabled) return false;

  showDistractionWarning(message.data);
  sendResponse({ received: true });
  return true;
}

/******************************************************************************
 * CLIPMD (CLIPBOARD TO MARKDOWN) [f06]
 ******************************************************************************/

let isClipmdPickModeActive = false;
let clipmdHintEl = null;
let clipmdCleanupFn = null;

/**
 * Create a small hint UI for ClipMD pick mode.
 * @param {string} text - Hint text
 * @returns {HTMLDivElement}
 */
function createClipmdHint(text) {
  const hint = document.createElement('div');
  hint.id = 'mai-clipmd-hint';
  Object.assign(hint.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '99999999',
    backgroundColor: 'rgba(0,0,0,0.85)',
    color: 'white',
    padding: '10px 14px',
    borderRadius: '10px',
    fontFamily: '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: '92vw',
    boxShadow: '0 6px 18px rgba(0,0,0,0.3)'
  });

  const label = document.createElement('span');
  label.textContent = text;
  label.style.lineHeight = '1.2';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Hủy (ESC)';
  Object.assign(cancelBtn.style, {
    backgroundColor: 'transparent',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.6)',
    padding: '6px 10px',
    borderRadius: '999px',
    cursor: 'pointer',
    fontSize: '12px'
  });

  cancelBtn.addEventListener('click', (event) => {
    if (!event?.isTrusted) return;
    stopClipmdPickMode();
  });

  hint.appendChild(label);
  hint.appendChild(cancelBtn);

  return hint;
}

/**
 * Update hint text for ClipMD.
 * @param {string} text - New text
 * @returns {void}
 */
function setClipmdHintText(text) {
  try {
    const label = clipmdHintEl?.querySelector?.('span');
    if (!label) return;
    label.textContent = text;
  } catch {
    // ignore
  }
}

/**
 * Stop ClipMD pick mode and clean up listeners/UI.
 * @returns {void}
 */
function stopClipmdPickMode() {
  isClipmdPickModeActive = false;
  if (typeof clipmdCleanupFn === 'function') clipmdCleanupFn();
  clipmdCleanupFn = null;
}

/**
 * Start ClipMD pick mode: click an element to copy its Markdown.
 * @returns {void}
 */
function startClipmdPickMode() {
  try {
    if (isClipmdPickModeActive) return;
    isClipmdPickModeActive = true;

    document.getElementById('mai-clipmd-hint')?.remove?.();
    clipmdHintEl = createClipmdHint('🌸 Chọn phần bạn muốn copy Markdown (click vào element)');
    document.body.appendChild(clipmdHintEl);

    const onKeyDown = (event) => {
      if (event?.key === 'Escape') {
        event.preventDefault?.();
        stopClipmdPickMode();
      }
    };

    const onClickCapture = (event) => {
      if (!isClipmdPickModeActive) return;
      if (!event?.isTrusted) return;

      // Allow clicks on our hint (cancel button).
      if (clipmdHintEl && clipmdHintEl.contains(event.target)) return;

      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();

      isClipmdPickModeActive = false; // single pick
      setClipmdHintText('🌸 Đang tạo Markdown...');

      const el = event.target;
      const html = typeof el?.outerHTML === 'string' ? el.outerHTML : '';
      const maxChars = 300_000;
      if (!html || html.length > maxChars) {
        setClipmdHintText('🌸 Phần bạn chọn quá lớn. Hãy chọn một phần nhỏ hơn.');
        setTimeout(() => stopClipmdPickMode(), 1500);
        return;
      }

      sendMessageSafely(
        { action: messageActions.clipmdConvertMarkdown, data: { html } },
        { timeoutMs: 8000 }
      )
        .then(async (response) => {
          const markdown = typeof response?.markdown === 'string' ? response.markdown : '';
          if (!response?.success || !markdown) {
            setClipmdHintText('🌸 Không thể tạo Markdown lúc này. Thử lại nhé.');
            setTimeout(() => stopClipmdPickMode(), 1500);
            return;
          }

          try {
            await navigator.clipboard.writeText(markdown);
            setClipmdHintText('🌸 Đã copy Markdown! (Ctrl+V để dán)');
          } catch (error) {
            console.error('🌸🌸🌸 Error writing clipboard:', error);
            setClipmdHintText('🌸 Copy thất bại. Trang này có thể chặn clipboard.');
          }

          setTimeout(() => stopClipmdPickMode(), 1200);
        })
        .catch((error) => {
          console.error('🌸🌸🌸 Error converting markdown:', error);
          setClipmdHintText('🌸 Có lỗi khi tạo Markdown. Thử lại nhé.');
          setTimeout(() => stopClipmdPickMode(), 1500);
        });
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClickCapture, true);

    clipmdCleanupFn = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClickCapture, true);
      clipmdHintEl?.remove?.();
      clipmdHintEl = null;
    };
  } catch (error) {
    console.error('🌸🌸🌸 Error starting ClipMD mode:', error);
    stopClipmdPickMode();
  }
}

/******************************************************************************
 * UI COMPONENTS
 ******************************************************************************/

/**
 * [f01][f04c] Hiển thị cảnh báo khi truy cập trang web gây sao nhãng hoặc nhắn tin trong Deep Work mode
 * Cài đặt hiển thị UI với thiết kế khác nhau cho trang thông thường (f01) và trang nhắn tin trong Deep Work (f04c)
 * @param {Object} data - Dữ liệu cảnh báo gồm URL, loại cảnh báo và trạng thái
 */
function showDistractionWarning(data) {
  if (!data) {
    console.error('🌸🌸🌸 No data provided for warning');
    return;
  }

  // Log minimal info (privacy-first: avoid logging full URL/message).
  console.log('🌸 Showing distraction warning:', {
    isDeepWorkBlocked: !!data.isDeepWorkBlocked,
    isInDeepWorkMode: !!data.isInDeepWorkMode
  });

  // Remove existing warning
  const existingWarning = document.getElementById('mai-distraction-warning');
  if (existingWarning) existingWarning.remove();

  const warningDiv = document.createElement('div');
  warningDiv.id = 'mai-distraction-warning';
  
  // Thay đổi màu nền tùy thuộc vào loại cảnh báo
  const bgColor = data.isDeepWorkBlocked && data.isInDeepWorkMode 
    ? 'rgba(138, 43, 226, 0.95)' // Tím đậm cho Deep Work mode
    : 'rgba(255, 143, 171, 0.95)'; // Hồng cho distractions thông thường
  
  Object.assign(warningDiv.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '50vh',
    backgroundColor: bgColor,
    color: 'white',
    padding: '20px',
    textAlign: 'center',
    zIndex: '9999999',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: '20px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center'
  });

  // Tùy chỉnh icon và nội dung dựa trên loại cảnh báo
  const icon = data.isDeepWorkBlocked && data.isInDeepWorkMode ? '⚡' : '🌸';
  const messageText = data.message || 'Mai nhận thấy đây là trang web gây sao nhãng. Bạn có thật sự muốn tiếp tục?';

  const container = document.createElement('div');
  Object.assign(container.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px'
  });

  const iconEl = document.createElement('span');
  iconEl.textContent = icon;
  iconEl.style.fontSize = '48px';

  const messageEl = document.createElement('span');
  messageEl.textContent = messageText;
  Object.assign(messageEl.style, { fontSize: '24px', margin: '20px 0' });

  const countdownDiv = document.createElement('div');
  countdownDiv.id = 'mai-countdown';
  Object.assign(countdownDiv.style, { fontSize: '20px', margin: '10px 0' });
  countdownDiv.append('Tab sẽ tự đóng sau ');
  const countdownSpan = document.createElement('span');
  countdownSpan.textContent = '5';
  countdownSpan.style.fontWeight = 'bold';
  countdownDiv.appendChild(countdownSpan);
  countdownDiv.append(' giây');

  const buttonsRow = document.createElement('div');
  Object.assign(buttonsRow.style, { display: 'flex', gap: '20px', marginTop: '20px' });

  const accentColor = data.isDeepWorkBlocked && data.isInDeepWorkMode ? '#8a2be2' : '#FF8FAB';

  const continueBtn = document.createElement('button');
  continueBtn.id = 'mai-continue-btn';
  continueBtn.type = 'button';
  continueBtn.textContent = 'Tiếp tục';
  Object.assign(continueBtn.style, {
    backgroundColor: 'white',
    color: accentColor,
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '18px'
  });

  const backBtn = document.createElement('button');
  backBtn.id = 'mai-back-btn';
  backBtn.type = 'button';
  backBtn.textContent = 'Đóng';
  Object.assign(backBtn.style, {
    backgroundColor: accentColor,
    color: 'white',
    border: '2px solid white',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '18px'
  });

  buttonsRow.appendChild(continueBtn);
  buttonsRow.appendChild(backBtn);

  container.appendChild(iconEl);
  container.appendChild(messageEl);
  container.appendChild(countdownDiv);
  container.appendChild(buttonsRow);

  warningDiv.appendChild(container);

  document.body.appendChild(warningDiv);
  setupWarningButtons(warningDiv);
}

/**
 * Setup buttons for distraction warning
 */
function setupWarningButtons(warningDiv) {
  const continueBtn = warningDiv?.querySelector?.('#mai-continue-btn');
  const backBtn = warningDiv?.querySelector?.('#mai-back-btn');
  const countdownEl = warningDiv?.querySelector?.('#mai-countdown span');

  let secondsLeft = 5;
  const countdownInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      if (countdownEl) countdownEl.textContent = secondsLeft;
    } else {
      clearInterval(countdownInterval);
      sendMessageSafely({ action: messageActions.closeTab });
    }
  }, 1000);

  continueBtn?.addEventListener('click', (event) => {
    if (!event?.isTrusted) return;
    clearInterval(countdownInterval);
    warningDiv.remove();
  });

  backBtn?.addEventListener('click', (event) => {
    if (!event?.isTrusted) return;
    clearInterval(countdownInterval);
    warningDiv.remove();
    sendMessageSafely({ action: messageActions.closeTab });
  });
}

/******************************************************************************
 * DISTRACTION DETECTION
 ******************************************************************************/

/**
 * [f01][f04c] Kiểm tra xem trang hiện tại có gây sao nhãng không
 * - f01: Kiểm tra trang web gây sao nhãng thông thường
 * - f04c: Kiểm tra thêm trang nhắn tin nếu đang trong Deep Work mode
 * @returns {void}
 */
function checkIfDistractingSite() {
  try {
    if (!isDistractionBlockingEnabled) return;

    const currentUrl = window.location.href;
    if (!currentUrl || currentUrl === 'about:blank') return;

    sendMessageSafely({
      action: messageActions.checkCurrentUrl,
      data: { url: currentUrl }
    });
  } catch (error) {
    console.error('🌸🌸🌸 Error in checkIfDistractingSite:', error);
  }
}

/**
 * Schedule a distraction re-check safely (only run when tab is visible).
 * @returns {void}
 */
function scheduleDistractionRecheck() {
  if (!isDistractionBlockingEnabled) return;

  if (document.visibilityState === 'visible') {
    pendingDistractionRecheckWhenVisible = false;
    refreshDistractionWarningAfterListChange().catch(() => {});
    return;
  }

  pendingDistractionRecheckWhenVisible = true;
}

/**
 * Run a pending distraction re-check when the tab becomes visible.
 * @returns {void}
 */
function runPendingDistractionRecheck() {
  if (!pendingDistractionRecheckWhenVisible) return;
  pendingDistractionRecheckWhenVisible = false;
  refreshDistractionWarningAfterListChange().catch(() => {});
}

/**
 * Re-check current URL when the block list changes (and remove warning if no longer distracting).
 * @feature f10 - Context Menu Quick Actions
 * @returns {Promise<void>}
 */
async function refreshDistractionWarningAfterListChange() {
  try {
    if (!isDistractionBlockingEnabled) return;

    const currentUrl = window.location.href;
    if (!currentUrl || currentUrl === 'about:blank') return;

    const reply = await sendMessageSafely(
      {
        action: messageActions.checkCurrentUrl,
        data: { url: currentUrl }
      },
      { timeoutMs: 1200 }
    );

    if (reply && reply.received && reply.isDistracting === false) {
      document.getElementById('mai-distraction-warning')?.remove?.();
    }
  } catch {
    // ignore
  }
}

/******************************************************************************
 * YOUTUBE INTEGRATION
 ******************************************************************************/

/**
 * Giám sát thay đổi URL trong YouTube SPA để kiểm tra trang gây sao nhãng
 * Sử dụng MutationObserver thay vì polling cho hiệu suất tốt hơn
 * @returns {void}
 */
function startYouTubeNavigationObserver() {
  if (!isDistractionBlockingEnabled) return;
  if (youtubeObserver || youtubeFallbackIntervalId) return;

  lastYoutubeUrl = window.location.href;

  try {
    // Sử dụng MutationObserver để theo dõi thay đổi DOM thay vì polling
    youtubeObserver = new MutationObserver(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastYoutubeUrl) {
        console.log('🌸 YouTube route changed');
        lastYoutubeUrl = currentUrl;
        
        sendMessageSafely({
          action: messageActions.youtubeNavigation,
          data: { url: currentUrl }
        });
      }
    });
    
    // Theo dõi thay đổi trong thẻ title và body để phát hiện điều hướng
    const titleEl = document.querySelector('head > title');
    if (titleEl) {
      youtubeObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
    }
    if (document.body) {
      youtubeObserver.observe(document.body, { childList: true, subtree: true });
    }
    
    console.log('🌸 YouTube navigation observer started');
  } catch (error) {
    console.error('🌸🌸🌸 Error setting up YouTube navigation observer:', error);
    
    // Fallback to polling if MutationObserver fails
    lastYoutubeUrl = window.location.href;
    youtubeObserver = null;
    youtubeFallbackIntervalId = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastYoutubeUrl) {
        console.log('🌸 YouTube route changed (fallback method)');
        lastYoutubeUrl = currentUrl;
        
        sendMessageSafely({
          action: messageActions.youtubeNavigation,
          data: { url: currentUrl }
        });
      }
    }, 1000);
  }
}

/**
 * Stop YouTube SPA navigation observer/polling to reduce overhead when disabled.
 * @returns {void}
 */
function stopYouTubeNavigationObserver() {
  try {
    youtubeObserver?.disconnect?.();
  } catch (error) {
    // Ignore
  }
  youtubeObserver = null;

  if (youtubeFallbackIntervalId) {
    clearInterval(youtubeFallbackIntervalId);
    youtubeFallbackIntervalId = null;
  }

  lastYoutubeUrl = '';
}

/******************************************************************************
 * SCRIPT INITIALIZATION
 ******************************************************************************/

initialize();

})();
