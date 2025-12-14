/**
 * MaiZone Browser Extension
 * Break Reminder Module: Manages break reminders and timer
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode (timer integration)
 */

import { getState, updateState } from './background_state.js';
import { BREAK_REMINDER_INTERVAL, BREAK_REMINDER_MESSAGES } from './constants.js';
import { endDeepWork } from './background_deepWork.js';

// Timer ID for break reminder
let breakReminderTimerId = null;

/**
 * Initialize break reminder module
 */
export function initBreakReminder() {
  setupMessageListeners();
  initializeBreakReminderIfEnabled();
}

/**
 * Setup message listeners for break reminder commands
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleBreakReminder') {
      toggleBreakReminder(message.data?.enabled);
      sendResponse({ success: true });
      return true;
    }
    else if (message.action === 'resetBreakReminder') {
      resetBreakReminder(message.data, sendResponse);
      return true;
    }
    else if (message.action === 'testBreakReminder') {
      sendBreakReminder();
      sendResponse({ success: true });
      return true;
    }
    else if (message.action === 'getBreakReminderState') {
      getBreakReminderState(sendResponse);
      return true;
    }
    return false;
  });
}

/**
 * Initialize break reminder if enabled
 */
function initializeBreakReminderIfEnabled() {
  const { breakReminderEnabled, isEnabled, reminderStartTime, reminderInterval } = getState();
  
  if (breakReminderEnabled && isEnabled) {
    // If there's an existing timer that hasn't expired, resume it
    if (reminderStartTime) {
      const now = Date.now();
      const elapsed = now - reminderStartTime;
      const interval = reminderInterval || BREAK_REMINDER_INTERVAL;
      
      // If the timer hasn't expired yet, resume with remaining time
      if (elapsed < interval) {
        const remaining = interval - elapsed;
        console.log(`🌸 Resuming timer with ${Math.round(remaining/1000)} seconds remaining`);
        startBreakReminder(remaining);
        return;
      }
    }
    
    // Start a new timer
    startBreakReminder();
  }
}

/**
 * Toggle break reminder
 */
export function toggleBreakReminder(enabled) {
  if (typeof enabled === 'boolean') {
    updateState({ breakReminderEnabled: enabled });
    
    if (enabled) {
      console.info('🌸 Break reminder enabled');
      startBreakReminder();
    } else {
      console.info('🌸 Break reminder disabled');
      stopBreakReminder();
      
      // If disabling break reminder, also exit flow state
      const { isInFlow } = getState();
      if (isInFlow) {
        updateState({ isInFlow: false, currentTask: '' });
      }
    }
    
    // Update badge - show remaining time if timer is running
    if (enabled) {
      updateBadgeWithTimerDisplay();
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
    chrome.action.setBadgeBackgroundColor({ color: '#FF8FAB' });
  } else {
    // Toggle current state
    const { breakReminderEnabled } = getState();
    toggleBreakReminder(!breakReminderEnabled);
  }
}

/**
 * Update badge with timer display
 */
function updateBadgeWithTimerDisplay() {
  const { reminderStartTime, reminderInterval, isInFlow } = getState();
  
  if (!isInFlow || !reminderStartTime || !reminderInterval) {
    return;
  }
  
  const now = Date.now();
  const elapsed = now - reminderStartTime;
  const remaining = reminderInterval - elapsed;
  
  if (remaining <= 0) {
    chrome.action.setBadgeText({ text: '00:00' });
    return;
  }
  
  const minutes = Math.floor(remaining / 60000).toString().padStart(2, '0');
  const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
  
  chrome.action.setBadgeText({ text: `${minutes}:${seconds}` });
}

/**
 * Start break reminder timer
 * @feature f03 - Break Reminder
 */
export function startBreakReminder(customInterval) {
  // Stop existing timer
  stopBreakReminder();
  
  const interval = customInterval || BREAK_REMINDER_INTERVAL;
  console.debug(`🌸 Starting break reminder timer (${interval / 1000 / 60} minutes)`);
  
  // Store the start time and interval
  const reminderStartTime = Date.now();
  const reminderExpectedEndTime = reminderStartTime + interval;
  
  // Update state
  updateState({ 
    reminderStartTime,
    reminderInterval: interval,
    reminderExpectedEndTime
  });
  
  // Initialize badge with timer
  updateBadgeWithTimerDisplay();
  
  // Set up the timer
  const checkTimerInterval = Math.min(3000, interval / 20); // Check every 3 seconds
  
  const checkBreakReminder = function() {
    const now = Date.now();
    console.log('🌸 Checking break reminder at:', new Date(now).toLocaleTimeString());
    
    const { 
      reminderStartTime, 
      reminderInterval, 
      reminderExpectedEndTime, 
      isInFlow, 
      currentTask, 
      breakReminderEnabled 
    } = getState();
    
    if (!reminderStartTime) return;
    
    // Check if still in flow state
    if (!isInFlow || !currentTask) {
      console.log('🌸 Not in flow state anymore, updating break reminder state');
      updateState({ 
        breakReminderEnabled: false,
        reminderStartTime: null,
        reminderInterval: null,
        reminderExpectedEndTime: null
      });
      // Clear badge
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    
    const elapsed = now - reminderStartTime;
    const timeLeft = reminderInterval - elapsed;
    
    console.log(`🌸 Time left: ${Math.floor(timeLeft/1000)}s, Expected end: ${new Date(reminderExpectedEndTime).toLocaleTimeString()}`);
    
    // Update badge with timer
    updateBadgeWithTimerDisplay();
    
    // If timer has expired
    if (timeLeft <= 0 || now >= reminderExpectedEndTime) {
      console.log('🌸 Break time reached! Sending reminder...');
      try {
        sendBreakReminder();
        
        // Reset deep work state
        updateState({
          isInFlow: false,
          currentTask: '',
          breakReminderEnabled: false
        });
        
        // End deep work mode
        endDeepWork();
      } catch (error) {
        console.error('🌸 Error in timer trigger:', error);
        // Restart timer even if reminder fails
        startBreakReminder();
      }
    } else {
      // Continue checking
      const nextCheck = Math.min(checkTimerInterval, timeLeft + 500);
      console.log(`🌸 Next check in: ${nextCheck/1000}s`);
      breakReminderTimerId = setTimeout(checkBreakReminder, nextCheck);
    }
  };
  
  // Start the check cycle
  breakReminderTimerId = setTimeout(checkBreakReminder, checkTimerInterval);
  console.log('🌸 Break reminder started with ID:', breakReminderTimerId);
}

/**
 * Stop break reminder timer
 */
export function stopBreakReminder() {
  if (breakReminderTimerId) {
    clearTimeout(breakReminderTimerId);
    breakReminderTimerId = null;
    
    // Clear stored timer data
    updateState({
      reminderStartTime: null,
      reminderInterval: null,
      reminderExpectedEndTime: null
    });
    
    console.debug('🌸 Break reminder timer stopped');
  }
}

/**
 * Send break reminder notification
 * @feature f03 - Break Reminder
 */
export function sendBreakReminder() {
  console.debug('🌸 Break reminder triggered');
  
  // Check if the flow cycle has ended
  const { isInFlow, currentTask } = getState();
  
  // If cycle completed, disable break reminder
  if (!isInFlow || !currentTask) {
    console.log('🌸 Flow cycle completed - disabling break reminder');
    updateState({ breakReminderEnabled: false });
  }
  
  // Show notification
  showBreakReminderNotification();
}

/**
 * Show break reminder notification
 */
function showBreakReminderNotification() {
  // Get a random message
  const randomMessage = BREAK_REMINDER_MESSAGES[Math.floor(Math.random() * BREAK_REMINDER_MESSAGES.length)];
  console.log('🌸 Selected random message:', randomMessage);
  
  try {
    chrome.notifications.create('break-reminder-notification', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: '🌸 Nghỉ xíu nhỉ! ✨',
      message: randomMessage,
      priority: 2,
      buttons: [{ title: 'Okieee, chill! 👌' }, { title: 'Nhắc lại sau, đang gấp! ⏱️' }]
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('🌸 Error creating notification:', chrome.runtime.lastError);
        
        // Retry with alternative ID
        setTimeout(() => {
          chrome.notifications.create('break-reminder-notification-alt', {
            type: 'basic',
            iconUrl: 'icon.png',
            title: '🌸 Nghỉ xíu nhỉ! ✨',
            message: randomMessage,
            priority: 2,
            buttons: [{ title: 'Okieee, chill! 👌' }, { title: 'Nhắc lại sau, đang gấp! ⏱️' }]
          });
        }, 1000);
      }
      
      // Check if still in flow state and restart timer if needed
      const { isInFlow, breakReminderEnabled } = getState();
      if (isInFlow && breakReminderEnabled) {
        startBreakReminder();
      }
    });
    
    console.info('🌸 Break reminder sent');
  } catch (error) {
    console.error('🌸 Error in sendBreakReminder:', error);
  }
}

/**
 * Handle notification button click
 */
export function handleNotificationButtonClick(notificationId, buttonIndex) {
  if (buttonIndex === 1) {
    // Remind again in 10 minutes
    console.debug('🌸 User requested reminder delay for 10 minutes');
    startBreakReminder(10 * 60 * 1000); // 10 minutes
  }
}

/**
 * Reset break reminder timer with new task
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 */
export function resetBreakReminder(data, sendResponse) {
  try {
    console.log('🌸 Resetting break reminder timer with task:', data?.task);
    
    // Ensure task is saved
    if (data?.task) {
      updateState({ 
        currentTask: data.task,
        isInFlow: true
      });
    }
    
    // Make sure break reminder is enabled
    updateState({ breakReminderEnabled: true });
    
    // Reset the timer to 40 minutes
    startBreakReminder();
    
    // Update badge with timer
    updateBadgeWithTimerDisplay();
    
    // Send success response
    if (sendResponse) {
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('🌸 Error in resetBreakReminder:', error);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

/**
 * Get current break reminder state
 */
export function getBreakReminderState(sendResponse) {
  const { 
    breakReminderEnabled, 
    reminderStartTime, 
    reminderInterval, 
    reminderExpectedEndTime, 
    isInFlow, 
    currentTask 
  } = getState();
  
  // If not in flow state, should not have timer running
  if (!isInFlow || !currentTask) {
    if (breakReminderEnabled) {
      console.log('🌸 Not in flow but break reminder is enabled. Disabling it.');
      updateState({ breakReminderEnabled: false });
    }
    
    sendResponse({
      enabled: false,
      startTime: null,
      interval: BREAK_REMINDER_INTERVAL
    });
    return;
  }
  
  // Check if break reminder is enabled but timer not started
  if (breakReminderEnabled && !reminderStartTime && isInFlow) {
    // Start a new timer
    if (!breakReminderTimerId) {
      console.log('🌸 Timer enabled but not started. Starting now.');
      startBreakReminder();
      
      // Get updated values
      const newState = getState();
      sendResponse({
        enabled: true,
        startTime: newState.reminderStartTime,
        interval: newState.reminderInterval || BREAK_REMINDER_INTERVAL,
        expectedEndTime: newState.reminderExpectedEndTime
      });
      return;
    }
  }
  
  // Send current state
  sendResponse({
    enabled: breakReminderEnabled,
    startTime: reminderStartTime,
    interval: reminderInterval || BREAK_REMINDER_INTERVAL,
    expectedEndTime: reminderExpectedEndTime
  });
}
