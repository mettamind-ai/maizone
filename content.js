/**
 * MaiZone Browser Extension
 * Content Script: Monitors text input fields, displays UI elements
 * @feature f00 - Text Input Detection
 * @feature f01 - Distraction Blocking (UI part)
 * @feature f04c - Deep Work Mode Integration
 */

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

// Message actions (prefer shared global injected via `actions_global.js`).
const messageActions = globalThis.MAIZONE_ACTIONS || Object.freeze({
  checkCurrentUrl: 'checkCurrentUrl',
  youtubeNavigation: 'youtubeNavigation',
  closeTab: 'closeTab',
  distractingWebsite: 'distractingWebsite'
});

// Global variables
let currentElement = null;
let lastContentLength = 0;
let typingTimer = null;
let isExtensionEnabled = true;
let isDistractionBlockingEnabled = true;
let domListenersAttached = false;

// YouTube SPA monitoring
let youtubeObserver = null;
let youtubeFallbackIntervalId = null;
let lastYoutubeUrl = '';

/******************************************************************************
 * INITIALIZATION
 ******************************************************************************/

/**
 * Initialize content script
 */
function initialize() {
  console.log('🌸 Mai content script initialized');

  // Load state early so we can avoid unnecessary listeners work when disabled
  chrome.storage.local.get(['isEnabled', 'blockDistractions'], ({ isEnabled, blockDistractions }) => {
    isExtensionEnabled = typeof isEnabled === 'boolean' ? isEnabled : true;
    isDistractionBlockingEnabled = typeof blockDistractions === 'boolean' ? blockDistractions : true;
    syncContentScriptActiveState();
  });
  
  // Listen for messages from background script (attach once; will ignore when disabled)
  chrome.runtime.onMessage.addListener(handleBackgroundMessages);

  // [f04c] Listen for deep work status changes and settings
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isEnabled) {
      isExtensionEnabled = !!changes.isEnabled.newValue;
      syncContentScriptActiveState();
    }

    if (changes.blockDistractions) {
      isDistractionBlockingEnabled = !!changes.blockDistractions.newValue;

      if (!isDistractionBlockingEnabled) {
        stopYouTubeNavigationObserver();
        document.getElementById('mai-distraction-warning')?.remove?.();
      } else if (isExtensionEnabled && window.location.hostname.includes('youtube.com')) {
        startYouTubeNavigationObserver();
        checkIfDistractingSite();
      }
    }

    if (changes.isInFlow) {
      console.log('🌸 Deep Work status changed:', changes.isInFlow.newValue);
      // Khi trạng thái flow thay đổi, kiểm tra lại URL hiện tại để áp dụng chặn trang nhắn tin (f04c)
      checkIfDistractingSite();
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

  domListenersAttached = true;
}

/**
 * Detach DOM listeners when extension is disabled to reduce overhead.
 * @returns {void}
 */
function detachDomListeners() {
  if (!domListenersAttached) return;

  document.removeEventListener('focusin', handleFocusIn);
  document.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('keyup', handleKeyUp);
  document.removeEventListener('click', handleClick);

  domListenersAttached = false;
}

/**
 * Stop any transient work/UI and reset in-memory state.
 * @returns {void}
 */
function resetTransientState() {
  clearTimeout(typingTimer);
  typingTimer = null;
  currentElement = null;
  lastContentLength = 0;

  stopYouTubeNavigationObserver();
  document.getElementById('mai-distraction-warning')?.remove?.();
}

/**
 * Sync active state (enabled/disabled) for the content script.
 * @returns {void}
 */
function syncContentScriptActiveState() {
  if (!isExtensionEnabled) {
    detachDomListeners();
    resetTransientState();
    return;
  }

  attachDomListeners();

  if (isDistractionBlockingEnabled && window.location.hostname.includes('youtube.com')) {
    startYouTubeNavigationObserver();
  } else {
    stopYouTubeNavigationObserver();
  }

  checkIfDistractingSite();
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
  if (!isExtensionEnabled) return;
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
  if (!isExtensionEnabled) return;
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
  if (!isExtensionEnabled) return;
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
  handleTypingEvent(event);
}

/**
 * Handle keyup events
 */
function handleKeyUp(event) {
  handleTypingEvent(event);
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
  if (!isExtensionEnabled) return false;
  if (message?.action !== messageActions.distractingWebsite) return false;

  showDistractionWarning(message.data);
  sendResponse({ received: true });
  return true;
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

  continueBtn?.addEventListener('click', () => {
    clearInterval(countdownInterval);
    warningDiv.remove();
  });

  backBtn?.addEventListener('click', () => {
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
    if (!isExtensionEnabled || !isDistractionBlockingEnabled) return;

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

/******************************************************************************
 * YOUTUBE INTEGRATION
 ******************************************************************************/

/**
 * Giám sát thay đổi URL trong YouTube SPA để kiểm tra trang gây sao nhãng
 * Sử dụng MutationObserver thay vì polling cho hiệu suất tốt hơn
 * @returns {void}
 */
function startYouTubeNavigationObserver() {
  if (!isExtensionEnabled || !isDistractionBlockingEnabled) return;
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
