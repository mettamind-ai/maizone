/**
 * MaiZone Browser Extension
 * Popup Script - Xử lý các tính năng chính của giao diện người dùng
 * @feature f03 - Break Reminder (UI part)
 * @feature f04 - Deep Work Mode (UI part)
 */

/******************************************************************************
 * ELEMENT REFERENCES AND VARIABLES
 ******************************************************************************/

// Reference đến các DOM elements chính
const enableToggle = document.getElementById('enable-toggle');                     // Toggle kích hoạt extension
const textAnalysisToggle = document.getElementById('text-analysis-toggle');        // Toggle phân tích nội dung
const blockDistractionsToggle = document.getElementById('block-distractions-toggle'); // Toggle chặn trang web gây sao nhãng
const breakReminderToggle = document.getElementById('break-reminder-toggle');      // Toggle nhắc nhở nghỉ ngơi
const settingsButton = document.getElementById('settings-button');                 // Nút mở trang cài đặt
const statusText = document.getElementById('status-text');                         // Hiển thị trạng thái hiện tại
const breakReminderCountdown = document.getElementById('break-reminder-countdown'); // Hiển thị thời gian còn lại
const taskInput = document.getElementById('task-input');  // Input field để nhập task cần tập trung

// Biến toàn cục quản lý trạng thái
let countdownInterval = null; // Interval cho đồng hồ đếm ngược

/******************************************************************************
 * INITIALIZATION
 ******************************************************************************/

document.addEventListener('DOMContentLoaded', initializePopup);

/**
 * Khởi tạo popup và đăng ký các event listeners
 */
function initializePopup() {
  console.log('🌸 Mai popup initialized');
  loadState();  // Load các cài đặt từ background state

  // Đăng ký các event listeners
  console.log('🌸 Registering event listeners...');
  enableToggle.addEventListener('change', () => handleToggle('isEnabled'));
  textAnalysisToggle.addEventListener('change', () => handleToggle('notifyTextAnalysis'));
  blockDistractionsToggle.addEventListener('change', () => handleToggle('blockDistractions'));
  breakReminderToggle.addEventListener('change', () => handleToggle('breakReminderEnabled'));
  settingsButton.addEventListener('click', openSettings);
  
  // Event listener cho task input - Deep Work Flow với phím Enter
  taskInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      setCurrentTask();
    }
  });

  // Khởi động đồng hồ đếm ngược
  startCountdownTimer();
  
  // Listen for state updates from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'stateUpdated') {
      handleStateUpdate(message.state);
    }
  });
  
  // Get current tab for status display
  updateCurrentStatus();
}

/******************************************************************************
 * STATE MANAGEMENT
 ******************************************************************************/

/**
 * Load state from background script
 */
function loadState() {
  sendMessageSafely({ action: 'getState' })
    .then(state => {
      if (state) {
        updateUI(state);
      } else {
        // Fallback to local storage if message fails
        chrome.storage.local.get(null, (data) => {
          if (data && Object.keys(data).length > 0) {
            updateUI(data);
          } else {
            // Use hardcoded defaults as last resort
            const defaults = {
              isEnabled: true,
              notifyTextAnalysis: true,
              blockDistractions: true,
              breakReminderEnabled: true,
              isInFlow: false,
              currentTask: ''
            };
            updateUI(defaults);
          }
        });
      }
    })
    .catch(error => {
      console.error('🌸 Error loading state:', error);
      // Fallback to storage
      chrome.storage.local.get(null, (data) => {
        if (data && Object.keys(data).length > 0) {
          updateUI(data);
        }
      });
    });
}

/**
 * Update UI based on state
 */
function updateUI(state) {
  // Update toggles
  enableToggle.checked = state.isEnabled;
  textAnalysisToggle.checked = state.notifyTextAnalysis;
  blockDistractionsToggle.checked = state.blockDistractions;
  breakReminderToggle.checked = state.breakReminderEnabled;
  
  // Update task input
  taskInput.value = state.currentTask || '';
  taskInput.disabled = state.isInFlow;
  
  // Update task label if in deep work
  if (state.isInFlow) {
    const breakReminderLabel = document.querySelector('.switch-label:has(#break-reminder-countdown)');
    if (breakReminderLabel) {
      const countdown = breakReminderLabel.querySelector('#break-reminder-countdown');
      breakReminderLabel.innerHTML = 'Deep Working... ';
      breakReminderLabel.appendChild(countdown);
    }
  }
  
  // Update enabled state UI
  updateEnabledState(state.isEnabled);
}

/**
 * Update UI when state changes
 */
function handleStateUpdate(updates) {
  // Only update relevant UI elements for the changes
  if ('isEnabled' in updates) {
    updateEnabledState(updates.isEnabled);
    enableToggle.checked = updates.isEnabled;
  }
  
  if ('notifyTextAnalysis' in updates) {
    textAnalysisToggle.checked = updates.notifyTextAnalysis;
  }
  
  if ('blockDistractions' in updates) {
    blockDistractionsToggle.checked = updates.blockDistractions;
  }
  
  if ('breakReminderEnabled' in updates) {
    breakReminderToggle.checked = updates.breakReminderEnabled;
  }
  
  if ('isInFlow' in updates) {
    taskInput.disabled = updates.isInFlow;
    
    // Update task label
    const breakReminderLabel = document.querySelector('.switch-label:has(#break-reminder-countdown)');
    if (breakReminderLabel) {
      const countdown = breakReminderLabel.querySelector('#break-reminder-countdown');
      
      if (updates.isInFlow) {
        breakReminderLabel.innerHTML = 'Deep Working... ';
        breakReminderLabel.appendChild(countdown);
      } else {
        breakReminderLabel.innerHTML = 'Deep Work Time Block ';
        breakReminderLabel.appendChild(countdown);
      }
    }
  }
  
  if ('currentTask' in updates) {
    taskInput.value = updates.currentTask || '';
  }
}

/**
 * Update UI based on enabled state
 */
function updateEnabledState(isEnabled) {
  if (!isEnabled) {
    statusText.textContent = 'Mai đang ngủ. Nhấn kích hoạt để đánh thức.';
    textAnalysisToggle.disabled = true;
    blockDistractionsToggle.disabled = true;
    breakReminderToggle.disabled = true;
    taskInput.disabled = true;
  } else {
    updateCurrentStatus();
    textAnalysisToggle.disabled = false;
    blockDistractionsToggle.disabled = false;
    breakReminderToggle.disabled = false;
    
    // Set task input state based on current flow state
    sendMessageSafely({ action: 'getState', key: 'isInFlow' })
      .then(state => {
        taskInput.disabled = state.isInFlow;
      });
  }
}

/******************************************************************************
 * EVENT HANDLERS
 ******************************************************************************/

/**
 * Handle toggle changes
 * @feature f02 - AI Text Prediction (dependency on text analysis)
 */
function handleToggle(settingKey) {
  const toggleMap = {
    'isEnabled': enableToggle,
    'notifyTextAnalysis': textAnalysisToggle,
    'blockDistractions': blockDistractionsToggle,
    'breakReminderEnabled': breakReminderToggle
  };
  
  const value = toggleMap[settingKey].checked;
  
  // Special handling for break reminder toggle
  if (settingKey === 'breakReminderEnabled' && !value) {
    // When disabling break reminder, also exit deep work
    sendMessageSafely({
      action: 'updateState',
      payload: {
        breakReminderEnabled: false,
        isInFlow: false,
        currentTask: ''
      }
    });
    
    // Reset UI
    taskInput.value = '';
    taskInput.disabled = false;
    
    // Reset label
    const breakReminderLabel = document.querySelector('.switch-label:has(#break-reminder-countdown)');
    if (breakReminderLabel) {
      const countdown = breakReminderLabel.querySelector('#break-reminder-countdown');
      breakReminderLabel.innerHTML = 'Deep Work Time Block ';
      breakReminderLabel.appendChild(countdown);
    }
    
    // Clear badge
    chrome.action.setBadgeText({ text: '' });
    
    return;
  }
  
  // Special handling for text analysis toggle
  if (settingKey === 'notifyTextAnalysis') {
    // When disabling text analysis, also disable text prediction
    if (!value) {
      sendMessageSafely({
        action: 'updateState',
        payload: {
          notifyTextAnalysis: false,
          textPredictionEnabled: false
        }
      });
      
      // Also toggle text prediction in background
      sendMessageSafely({
        action: 'toggleTextPrediction',
        data: { enabled: false }
      });
      
      return;
    } else {
      // When enabling text analysis, also enable text prediction
      sendMessageSafely({
        action: 'updateState',
        payload: {
          notifyTextAnalysis: true,
          textPredictionEnabled: true
        }
      });
      
      // Also toggle text prediction in background
      sendMessageSafely({
        action: 'toggleTextPrediction',
        data: { enabled: true }
      });
      
      return;
    }
  }
  
  // Update state in background
  sendMessageSafely({
    action: 'updateState',
    payload: { [settingKey]: value }
  });
}

/**
 * Open options page
 */
function openSettings() {
  chrome.runtime.openOptionsPage();
}

/******************************************************************************
 * DEEP WORK
 ******************************************************************************/

/**
 * Set current task and enter deep work mode
 * @feature f04 - Deep Work Mode
 */
function setCurrentTask() {
  const task = taskInput.value.trim();
  if (!task) {
    alert('Vui lòng nhập công việc cần tập trung');
    return;
  }
  
  // Update state
  sendMessageSafely({
    action: 'updateState',
    payload: {
      currentTask: task,
      isInFlow: true,
      breakReminderEnabled: true
    }
  })
  .then(() => {
    // Reset break reminder timer
    sendMessageSafely({
      action: 'resetBreakReminder',
      data: { task }
    });
    
    // Update UI
    taskInput.disabled = true;
    breakReminderToggle.checked = true;
    
    // Update label
    const breakReminderLabel = document.querySelector('.switch-label:has(#break-reminder-countdown)');
    if (breakReminderLabel) {
      const countdown = breakReminderLabel.querySelector('#break-reminder-countdown');
      breakReminderLabel.innerHTML = 'Deep Working... ';
      breakReminderLabel.appendChild(countdown);
    }
    
    // Update status message temporarily
    statusText.textContent = `Mai sẽ giúp bạn tập trung vào: ${task}`;
    setTimeout(updateCurrentStatus, 3000);
  });
}

/******************************************************************************
 * COUNTDOWN TIMER
 ******************************************************************************/

/**
 * Start countdown timer for break reminder
 */
function startCountdownTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  
  updateCountdownTimer();
  countdownInterval = setInterval(updateCountdownTimer, 1000);
}

/**
 * Update countdown timer display
 */
function updateCountdownTimer() {
  if (!breakReminderCountdown) {
    console.warn('🌸🌸🌸 Countdown element not found');
    return;
  }

  sendMessageSafely({ action: 'getBreakReminderState' })
    .then((state) => {
      if (!state || !state.enabled || !state.startTime) {
        breakReminderCountdown.textContent = '(40:00)';
        return;
      }
      
      const now = Date.now();
      const elapsed = now - state.startTime;
      const remaining = state.interval - elapsed;
      
      if (remaining <= 0) {
        breakReminderCountdown.textContent = '(00:00)';
        
        // Reset task and flow state
        sendMessageSafely({
          action: 'updateState',
          payload: {
            isInFlow: false,
            currentTask: '',
            breakReminderEnabled: false
          }
        }).catch(err => console.error('🌸 Error updating state:', err));
        
        // End deep work mode
        sendMessageSafely({ action: 'endDeepWork' }).catch(err => console.error('🌸 Error ending deep work:', err));
        
        // Trigger break reminder
        sendMessageSafely({ action: 'testBreakReminder' }).catch(err => console.error('🌸 Error sending break reminder:', err));
        
        return;
      }
      
      const minutes = Math.floor(remaining / 60000).toString().padStart(2, '0');
      const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
      
      breakReminderCountdown.textContent = `(${minutes}:${seconds})`;
    })
    .catch(error => {
      console.error('🌸 Error updating countdown:', error);
      breakReminderCountdown.textContent = '(40:00)';
    });
}

/******************************************************************************
 * UI STATUS UPDATE
 ******************************************************************************/

/**
 * Update status message based on current tab
 */
function updateCurrentStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) return;
    
    // Get enabled state
    sendMessageSafely({ action: 'getState', key: 'isEnabled' })
      .then(state => {
        if (!state.isEnabled) {
          statusText.textContent = 'Mai đang ngủ. Nhấn kích hoạt để đánh thức.';
          return;
        }
        
        const currentTab = tabs[0];
        
        if (currentTab.url) {
          try {
            const url = new URL(currentTab.url);
            const hostname = url.hostname.replace(/^www\./, '');
            
            // Site-specific messages
            const messages = {
              'youtube.com': 'Mai đang quan sát YouTube... Nhớ đừng xem quá lâu nhé!',
              'facebook.com': 'Mai đang theo dõi Facebook... Đừng scroll quá nhiều nhé!',
              'gmail.com': 'Mai đang hỗ trợ bạn đọc email... Trả lời ngắn gọn thôi nhé!',
              'netflix.com': 'Mai nhắc bạn đừng xem phim quá khuya nhé!',
              'github.com': 'Mai đang theo dõi bạn code trên GitHub... hấn hảo!',
              'google.com': 'Mai đang quan sát bạn tìm kiếm... Tìm được gì hay chưa?'
            };
            
            statusText.textContent = messages[hostname] || `Mai đang quan sát ${hostname}...`;
          } catch (err) {
            statusText.textContent = 'Mai đang quan sát âm thầm...';
          }
        } else {
          statusText.textContent = 'Mai đang quan sát âm thầm...';
        }
      });
  });
}

/******************************************************************************
 * UTILITIES
 ******************************************************************************/

/**
 * Helper function để gửi message an toàn tới background script
 * @param {Object} message - Message object to send to background script
 * @returns {Promise<any>} - Response from background script or null on error
 */
async function sendMessageSafely(message) {
  try {
    // Check if extension context is valid before sending
    if (!chrome.runtime || chrome.runtime.id === undefined) {
      console.warn('🌸🌸🌸 Extension context is invalid, not sending message');
      return null;
    }

    // Use a more reliable approach for timeouts with a wrapper Promise
    const response = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        console.warn('🌸🌸🌸 Message sending timed out after 2 seconds');
        resolve(null);  // Resolve with null instead of rejecting
      }, 2000);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timeoutId);
          
          // Check for chrome runtime errors
          if (chrome.runtime.lastError) {
            console.warn('🌸🌸🌸 Chrome runtime error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          
          resolve(response);
        });
      } catch (innerError) {
        clearTimeout(timeoutId);
        console.warn('🌸🌸🌸 Error in chrome.runtime.sendMessage:', innerError);
        resolve(null);
      }
    });
    
    return response;
  } catch (error) {
    // These catch blocks should only trigger for errors in the outer function
    if (error.message?.includes('Extension context invalidated')) {
      console.warn('🌸🌸🌸 Extension context invalidated in popup.js');
      return null;
    }
    
    if (error.message?.includes('Could not establish connection')) {
      console.warn('🌸🌸🌸 Could not connect to background script, might be loading');
      return null;
    }
    
    console.warn('🌸🌸🌸 Failed to send message:', error);
    return null;
  }
}
