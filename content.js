/**
 * MaiZone Browser Extension
 * Content Script: Monitors text input fields, displays UI elements
 * @feature f00 - Text Input Detection
 * @feature f01 - Distraction Blocking (UI part)
 * @feature f02 - AI Text Prediction (UI part)
 * @feature f04c - Deep Work Mode Integration
 */

// Define global configuration with const for better encapsulation
const TEXT_PREDICTION_CONFIG = {
  // Delay before showing suggestion (ms)
  DELAY_BEFORE_SUGGESTION: 800,
  // Minimum characters to trigger prediction
  MIN_CHARS_TO_TRIGGER: 2,
  // Minimum time between API calls (ms)
  MIN_TIME_BETWEEN_CALLS: 3000,
  // Maximum suggestion length to display
  MAX_SUGGESTION_LENGTH: 50
};

/******************************************************************************
 * VARIABLES AND CONFIGURATION
 ******************************************************************************/

// Constants specific to content.js
const TYPING_INTERVAL = 500; // Typing detection interval (ms)
const DEFAULT_PREDICTION_DELAY = 800; // Default delay before prediction (ms)
const DEFAULT_MIN_CHARS = 2; // Default minimum characters to trigger prediction

// Global variables
let currentElement = null;
let lastContent = '';
let typingTimer = null;
let predictionTimer = null;
let suggestionElement = null;
let isPredicting = false;

/**
 * Tải các phụ thuộc cần thiết cho content script
 * @returns {Promise<boolean>} Promise resolving to true indicating successful loading
 */
function loadDependencies() {
  console.log('🌸 Using built-in configuration values');
  return Promise.resolve(true);
}

/******************************************************************************
 * INITIALIZATION
 ******************************************************************************/

/**
 * Initialize content script
 */
function initialize() {
  console.log('🌸 Mai content script initialized');

  // Set up event listeners
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  document.addEventListener('click', handleClick);

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(handleBackgroundMessages);

  // Check if current site is distracting
  checkIfDistractingSite();

  // Add special handling for YouTube SPA
  if (window.location.hostname.includes('youtube.com')) {
    console.log('🌸 YouTube detected, adding SPA navigation listener');
    observeYouTubeNavigation();
  }
  
  // Initialize suggestion UI
  initSuggestionUI();
  
  // [f04c] Listen for deep work status changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isInFlow) {
      console.log('🌸 Deep Work status changed:', changes.isInFlow.newValue);
      // Khi trạng thái flow thay đổi, kiểm tra lại URL hiện tại để áp dụng chặn trang nhắn tin (f04c)
      checkIfDistractingSite();
    }
  });
}

/**
 * Helper function for safe message sending
 * @param {Object} message - Message object to send to background script
 * @returns {Promise<any>} - Response from background script or null on error
 */
async function sendMessageSafely(message) {
  try {
    if (!chrome.runtime || chrome.runtime.id === undefined) {
      return null;
    }

    const response = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), 2000);

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

    return response;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) {
      // Expected during page unload or extension update - ignore silently
      return null;
    }
    console.warn('🌸🌸🌸 Failed to send message:', error);
    return null;
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
function handleTypingEvent(event, isKeyUp = false) {
  if (!currentElement) return;
  
  clearTimeout(typingTimer);
  clearTimeout(predictionTimer);

  // Handle special keys in keyup
  if (isKeyUp) {
    if (event.key === 'Enter' && !event.shiftKey) {
      captureCurrentContent();
      hideSuggestion();
      return;
    }
    
    if (event.key === 'Escape' && suggestionElement) {
      hideSuggestion();
      return;
    }
    
    if (event.key === 'Tab' && suggestionElement && suggestionElement.style.display !== 'none') {
      event.preventDefault();
      acceptSuggestion();
      return;
    }

    // Only schedule prediction for regular typing
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'Enter'].includes(event.key)) {
      const DELAY = TEXT_PREDICTION_CONFIG?.DELAY_BEFORE_SUGGESTION || DEFAULT_PREDICTION_DELAY;
      predictionTimer = setTimeout(() => captureCurrentContent(true), DELAY);
      return;
    }
  }

  // Always update content after a delay, but don't trigger prediction
  typingTimer = setTimeout(() => captureCurrentContent(false), TYPING_INTERVAL);
}

/**
 * Handle keydown events
 */
function handleKeyDown(event) {
  handleTypingEvent(event, false);
}

/**
 * Handle keyup events
 */
function handleKeyUp(event) {
  handleTypingEvent(event, true);
}

/******************************************************************************
 * CONTENT ANALYSIS
 ******************************************************************************/

/**
 * Capture and analyze current content
 */
function captureCurrentContent(shouldPredict = false) {
  if (!currentElement) return;
  const currentContentValue = getCurrentElementContent();
  if (currentContentValue !== lastContent) {
    console.log('🌸 Content updated:', currentContentValue);
    lastContent = currentContentValue;
    
    const MIN_CHARS = TEXT_PREDICTION_CONFIG?.MIN_CHARS_TO_TRIGGER || DEFAULT_MIN_CHARS;
    if (shouldPredict && currentContentValue.length >= MIN_CHARS) {
      requestTextPrediction();
    } else {
      hideSuggestion();
    }
  }
}

/**
 * Get content from current element
 */
function getCurrentElementContent() {
  if (!currentElement) return '';
  const tagName = currentElement.tagName.toLowerCase();
  return tagName === 'textarea' || tagName === 'input' 
    ? currentElement.value 
    : currentElement.getAttribute('contenteditable') === 'true'
      ? currentElement.innerText 
      : '';
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
    return ['text', 'email', 'search', 'url', 'tel', 'password', 'number'].includes(inputType);
  }
  return element.getAttribute('contenteditable') === 'true';
}

/**
 * Set current focused element
 */
function setCurrentElement(element) {
  try {
    if (currentElement && currentElement !== element) {
      // Don't trigger prediction when switching elements
      captureCurrentContent(false);
    }
    currentElement = element;
    lastContent = getCurrentElementContent();

    sendMessageSafely({
      action: 'elementFocused',
      data: {
        type: element.tagName.toLowerCase(),
        id: element.id || null,
        url: window.location.href
      }
    });
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
  switch (message.action) {
    case 'distractingWebsite':
      showDistractionWarning(message.data);
      sendResponse({ received: true });
      break;
    case 'textPredictionResult':
      handlePredictionResult(message.data);
      sendResponse({ received: true });
      break;
  }
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

  // Log thông tin về cảnh báo
  console.log('🌸 Showing distraction warning:', data);

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
  
  warningDiv.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; gap: 20px;">
      <span style="font-size: 48px;">${icon}</span>
      <span style="font-size: 24px; margin: 20px 0;">${messageText}</span>
      <div id="mai-countdown" style="font-size: 20px; margin: 10px 0;">Tab sẽ tự đóng sau <span style="font-weight: bold;">5</span> giây</div>
      <div style="display: flex; gap: 20px; margin-top: 20px;">
        <button id="mai-continue-btn" 
          style="background-color: white; color: ${data.isDeepWorkBlocked && data.isInDeepWorkMode ? '#8a2be2' : '#FF8FAB'}; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 18px;">
          Tiếp tục
        </button>
        <button id="mai-back-btn" 
          style="background-color: ${data.isDeepWorkBlocked && data.isInDeepWorkMode ? '#8a2be2' : '#FF8FAB'}; color: white; border: 2px solid white; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 18px;">
          Đóng
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(warningDiv);
  setupWarningButtons(warningDiv);
}

/**
 * Setup buttons for distraction warning
 */
function setupWarningButtons(warningDiv) {
  const continueBtn = document.getElementById('mai-continue-btn');
  const backBtn = document.getElementById('mai-back-btn');
  const countdownEl = document.getElementById('mai-countdown').querySelector('span');

  let secondsLeft = 5;
  const countdownInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      countdownEl.textContent = secondsLeft;
    } else {
      clearInterval(countdownInterval);
      sendMessageSafely({ action: 'closeTab' });
    }
  }, 1000);

  continueBtn?.addEventListener('click', () => {
    clearInterval(countdownInterval);
    warningDiv.remove();
  });

  backBtn?.addEventListener('click', () => {
    clearInterval(countdownInterval);
    warningDiv.remove();
    sendMessageSafely({ action: 'closeTab' });
  });
}

/******************************************************************************
 * TEXT PREDICTION UI
 ******************************************************************************/

/**
 * Khởi tạo UI cho gợi ý văn bản (Text Suggestion)
 * Tạo và thêm phần tử suggestion vào DOM nếu chưa tồn tại
 * @returns {void}
 */
function initSuggestionUI() {
  try {
    if (!suggestionElement) {
      suggestionElement = document.createElement('div');
      suggestionElement.id = 'mai-text-suggestion';
      Object.assign(suggestionElement.style, {
        position: 'absolute',
        backgroundColor: 'rgba(255, 143, 171, 0.1)',
        border: '1px solid rgba(255, 143, 171, 0.3)',
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: '14px',
        color: '#888',
        pointerEvents: 'none',
        display: 'none',
        zIndex: '9999',
        fontStyle: 'italic',
        fontFamily: 'inherit',
        maxWidth: '80%',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      });
      document.body.appendChild(suggestionElement);
      console.log('🌸 Text suggestion UI initialized');
    }
  } catch (error) {
    console.error('🌸🌸🌸 Error initializing suggestion UI:', error);
  }
}

/**
 * [f02] Gửi yêu cầu dự đoán văn bản đến background script
 * Phần của tính năng f02 - dự đoán văn bản người dùng sẽ nhập
 * @returns {void}
 */
function requestTextPrediction() {
  try {
    if (!currentElement || isPredicting) return;
    
    const MIN_CHARS = TEXT_PREDICTION_CONFIG?.MIN_CHARS_TO_TRIGGER || DEFAULT_MIN_CHARS;
    const currentContent = getCurrentElementContent();
    
    if (!currentContent || currentContent.length < MIN_CHARS) return;
    
    isPredicting = true;
    console.log('🌸 Requesting text prediction for:', currentContent);
    
    sendMessageSafely({
      action: 'requestTextPrediction',
      data: {
        currentContent,
        inputType: currentElement.tagName.toLowerCase(),
        placeholder: currentElement.placeholder || '',
        pageTitle: document.title,
        url: window.location.href
      }
    }).finally(() => {
      isPredicting = false;
    });
  } catch (error) {
    console.error('🌸🌸🌸 Error requesting text prediction:', error);
    isPredicting = false;
  }
}

/**
 * Handle prediction result from background script
 */
function handlePredictionResult(data) {
  if (!data?.suggestion || !currentElement) return;
  
  console.log('🌸 Received text prediction:', data.suggestion);
  
  if (suggestionElement) {
    positionSuggestionElement();
    suggestionElement.textContent = data.suggestion;
    suggestionElement.style.display = 'block';
    
    setTimeout(hideSuggestion, 5000);
  }
}

/**
 * Định vị phần tử gợi ý dưới đúng vị trí của trường nhập liệu
 * Tính toán vị trí cho cả input thông thường và textarea
 * @returns {void}
 */
function positionSuggestionElement() {
  try {
    if (!currentElement || !suggestionElement) return;
    
    // Đọc thông tin về vị trí một lần để tránh layout thrashing
    const rect = currentElement.getBoundingClientRect();
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    const isTextarea = currentElement.tagName.toLowerCase() === 'textarea';
    const style = window.getComputedStyle(currentElement);
    const lineHeight = parseInt(style.lineHeight, 10) || 18;
    const paddingTop = parseInt(style.paddingTop, 10) || 0;
    const paddingLeft = parseInt(style.paddingLeft, 10) || 0;
    const direction = style.direction; // Hỗ trợ cho văn bản RTL
    
    let offsetTop = isTextarea
      ? paddingTop + (currentElement.value.split('\n').length - 1) * lineHeight
      : rect.height + 4;
      
    let offsetLeft = isTextarea
      ? paddingLeft + (currentElement.value.split('\n').pop()?.length || 0) * 8
      : 8;
    
    // Điều chỉnh vị trí cho văn bản RTL
    if (direction === 'rtl') {
      offsetLeft = rect.width - offsetLeft - (suggestionElement.offsetWidth || 150);
    }
    
    // Thực hiện tất cả các ghi DOM cùng một lúc
    requestAnimationFrame(() => {
      Object.assign(suggestionElement.style, {
        top: `${rect.top + scrollTop + offsetTop}px`,
        left: `${rect.left + scrollLeft + offsetLeft}px`
      });
    });
  } catch (error) {
    console.error('🌸🌸🌸 Error positioning suggestion element:', error);
  }
}

/**
 * Accept current suggestion
 */
function acceptSuggestion() {
  if (!suggestionElement || !currentElement || suggestionElement.style.display === 'none') return;
  
  const suggestion = suggestionElement.textContent;
  if (!suggestion) return;
  
  const isContentEditable = currentElement.getAttribute('contenteditable') === 'true';
  
  if (isContentEditable) {
    currentElement.innerText += suggestion;
  } else {
    currentElement.value += suggestion;
  }
  
  currentElement.dispatchEvent(new Event('input', { bubbles: true }));
  hideSuggestion();
  
  sendMessageSafely({
    action: 'suggestionAccepted',
    data: { suggestion }
  });
}

/**
 * Hide suggestion element
 */
function hideSuggestion() {
  if (suggestionElement) {
    suggestionElement.style.display = 'none';
    suggestionElement.textContent = '';
  }
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
    chrome.storage.local.get(['isEnabled', 'blockDistractions', 'isInFlow'], ({ isEnabled, blockDistractions, isInFlow }) => {
      if (!isEnabled || !blockDistractions) return;
      
      const currentUrl = window.location.href;
      if (!currentUrl || currentUrl === 'about:blank') return;

      // Thêm trạng thái isInFlow vào request để background script biết có đang trong deep work mode không
      sendMessageSafely({
        action: 'checkCurrentUrl',
        data: { 
          url: currentUrl,
          isInFlow: isInFlow 
        }
      }).catch(error => {
        console.error('🌸🌸🌸 Error checking current URL:', error);
      });
      
      // Kiểm tra lại trạng thái sau 1 giây để đảm bảo trạng thái mới nhất được áp dụng
      setTimeout(() => {
        chrome.storage.local.get(['isInFlow'], (result) => {
          if (result.isInFlow) {
            console.log('🌸 Deep Work mode active, rechecking current URL');
            sendMessageSafely({
              action: 'checkCurrentUrl',
              data: { 
                url: currentUrl,
                isInFlow: true
              }
            }).catch(error => {
              console.error('🌸🌸🌸 Error rechecking current URL:', error);
            });
          }
        });
      }, 1000);
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
function observeYouTubeNavigation() {
  try {
    let lastYoutubeUrl = window.location.href;
    
    // Sử dụng MutationObserver để theo dõi thay đổi DOM thay vì polling
    const observer = new MutationObserver((mutations) => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastYoutubeUrl) {
        console.log('🌸 YouTube URL changed:', lastYoutubeUrl, '->', currentUrl);
        lastYoutubeUrl = currentUrl;
        
        sendMessageSafely({
          action: 'youtubeNavigation',
          data: { url: currentUrl }
        });
      }
    });
    
    // Theo dõi thay đổi trong thẻ title và body để phát hiện điều hướng
    observer.observe(document.querySelector('head > title'), { subtree: true, characterData: true, childList: true });
    observer.observe(document.body, { childList: true, subtree: true });
    
    console.log('🌸 YouTube navigation observer started');
  } catch (error) {
    console.error('🌸🌸🌸 Error setting up YouTube navigation observer:', error);
    
    // Fallback to polling if MutationObserver fails
    let lastYoutubeUrl = window.location.href;
    setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastYoutubeUrl) {
        console.log('🌸 YouTube URL changed (fallback method):', lastYoutubeUrl, '->', currentUrl);
        lastYoutubeUrl = currentUrl;
        
        sendMessageSafely({
          action: 'youtubeNavigation',
          data: { url: currentUrl }
        });
      }
    }, 1000);
  }
}

/******************************************************************************
 * SCRIPT INITIALIZATION
 ******************************************************************************/

loadDependencies().then(success => {
  if (success) {
    initialize();
  } else {
    console.error('🌸🌸🌸 Cannot initialize content script due to missing dependencies');
  }
});
