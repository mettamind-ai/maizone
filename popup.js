/**
 * MaiZone Browser Extension
 * Popup Script - Xử lý các tính năng chính của giao diện người dùng
 * @feature f03 - Break Reminder (UI part)
 * @feature f04 - Deep Work Mode (UI part)
 */

import { sendMessageSafely } from './messaging.js';
import { getStateSafely, updateStateSafely } from './state_helpers.js';
import { messageActions } from './actions.js';

/******************************************************************************
 * ELEMENT REFERENCES AND VARIABLES
 ******************************************************************************/

// Reference đến các DOM elements chính
const enableToggle = document.getElementById('enable-toggle');                     // Toggle kích hoạt extension
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
    if (message?.action === messageActions.stateUpdated) {
      handleStateUpdate(message.delta || message.state);
    }
  });
  
  // Get current tab for status display
  updateCurrentStatus();
}

/******************************************************************************
 * STATE MANAGEMENT
 ******************************************************************************/

/**
 * Get the label element containing the countdown (avoid :has() for compatibility)
 */
function getBreakReminderLabel() {
  if (!breakReminderCountdown) return null;
  const label = breakReminderCountdown.parentElement;
  if (!label || !label.classList?.contains('switch-label')) return null;
  return label;
}

/**
 * Update the break reminder label text while preserving the countdown element
 */
function setBreakReminderLabelText(text) {
  const label = getBreakReminderLabel();
  if (!label || !breakReminderCountdown) return;
  label.textContent = `${text} `;
  label.appendChild(breakReminderCountdown);
}

/**
 * Load state from background script
 */
function loadState() {
  const defaults = {
    isEnabled: true,
    blockDistractions: true,
    breakReminderEnabled: false,
    isInFlow: false,
    currentTask: ''
  };

  getStateSafely()
    .then((state) => updateUI({ ...defaults, ...(state || {}) }))
    .catch((error) => {
      console.error('🌸🌸🌸 Error loading state:', error);
      updateUI(defaults);
    });
}

/**
 * Update UI based on state
 */
function updateUI(state) {
  // Update toggles
  enableToggle.checked = state.isEnabled;
  blockDistractionsToggle.checked = state.blockDistractions;
  breakReminderToggle.checked = state.breakReminderEnabled;
  
  // Update task input
  taskInput.value = state.currentTask || '';
  taskInput.disabled = state.isInFlow;
  
  // Update task label
  setBreakReminderLabelText(state.isInFlow ? 'Đang Deep Work...' : 'Khung Deep Work');
  
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
  
  if ('blockDistractions' in updates) {
    blockDistractionsToggle.checked = updates.blockDistractions;
  }
  
  if ('breakReminderEnabled' in updates) {
    breakReminderToggle.checked = updates.breakReminderEnabled;
  }
  
  if ('isInFlow' in updates) {
    taskInput.disabled = updates.isInFlow;
    
    // Update task label
    setBreakReminderLabelText(updates.isInFlow ? 'Đang Deep Work...' : 'Khung Deep Work');
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
    blockDistractionsToggle.disabled = true;
    breakReminderToggle.disabled = true;
    taskInput.disabled = true;
  } else {
    updateCurrentStatus();
    blockDistractionsToggle.disabled = false;
    breakReminderToggle.disabled = false;
    
    // Set task input state based on current flow state
    getStateSafely('isInFlow').then((state) => {
      taskInput.disabled = !!state?.isInFlow;
    });
  }
}

/******************************************************************************
 * EVENT HANDLERS
 ******************************************************************************/

/**
 * Handle toggle changes
 * @feature f01 - Distraction Blocking
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 * @feature f05 - State Management
 */
function handleToggle(settingKey) {
  const toggleMap = {
    'isEnabled': enableToggle,
    'blockDistractions': blockDistractionsToggle,
    'breakReminderEnabled': breakReminderToggle
  };
  
  const toggle = toggleMap[settingKey];
  if (!toggle) return;

  const value = toggle.checked;
  
  // Special handling for break reminder toggle
  if (settingKey === 'breakReminderEnabled') {
    if (!value) {
      // When disabling break reminder, also exit deep work
      updateStateSafely({
        breakReminderEnabled: false,
        isInFlow: false,
        currentTask: ''
      });

      // Reset UI
      taskInput.value = '';
      taskInput.disabled = false;

      // Reset label
      setBreakReminderLabelText('Khung Deep Work');

      // Clear badge
      chrome.action.setBadgeText({ text: '' });

      return;
    }

    // Enabling Deep Work requires a task
    const task = taskInput?.value?.trim?.() || '';
    if (!task) {
      alert('Hãy nhập công việc cần tập trung trước khi bật Deep Work.');
      breakReminderToggle.checked = false;
      setBreakReminderLabelText('Khung Deep Work');
      return;
    }

    setCurrentTask();
    return;
  }

  // Update state in background (with fallback)
  updateStateSafely({ [settingKey]: value });
}

/******************************************************************************
 * SETTINGS
 ******************************************************************************/

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
    breakReminderToggle.checked = false;
    return;
  }
  
  // Optimistic UI update for responsiveness
  taskInput.disabled = true;
  breakReminderToggle.checked = true;
  setBreakReminderLabelText('Đang Deep Work...');

  // Reset break reminder timer (authoritative start)
  sendMessageSafely({
    action: messageActions.resetBreakReminder,
    data: { task }
  }).then((response) => {
    if (!response?.success) {
      console.warn('🌸🌸🌸 resetBreakReminder failed, falling back to updateState');
      updateStateSafely({
        currentTask: task,
        isInFlow: true,
        breakReminderEnabled: true
      });
    }
  });
  
  // Update status message temporarily
  statusText.textContent = `Mai sẽ giúp bạn tập trung vào: ${task}`;
  setTimeout(updateCurrentStatus, 3000);
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

  sendMessageSafely({ action: messageActions.getBreakReminderState })
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
        return;
      }
      
      const minutes = Math.floor(remaining / 60000).toString().padStart(2, '0');
      const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
      
      breakReminderCountdown.textContent = `(${minutes}:${seconds})`;
    })
    .catch(error => {
      console.error('🌸🌸🌸 Error updating countdown:', error);
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
    getStateSafely('isEnabled').then((state) => {
      if (!state || !state.isEnabled) {
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
