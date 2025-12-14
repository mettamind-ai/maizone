/**
 * MaiZone Browser Extension
 * Deep Work Module: Manages deep work mode and focus sessions
 * @feature f04 - Deep Work Mode
 */

import { getState, updateState } from './background_state.js';
import { resetBreakReminder } from './background_breakReminder.js';

/**
 * Initialize deep work module
 */
export function initDeepWork() {
  // Setup listeners
  setupMessageListeners();
}

/**
 * Setup message listeners for deep work commands
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startDeepWork') {
      startDeepWork(message.data, sendResponse);
      return true;
    }
    else if (message.action === 'endDeepWork') {
      endDeepWork(sendResponse);
      return true;
    }
    else if (message.action === 'getDeepWorkState') {
      getDeepWorkState(sendResponse);
      return true;
    }
    return false;
  });
}

/**
 * Start deep work mode
 */
export function startDeepWork(data, sendResponse) {
  try {
    const task = data?.task;
    if (!task) {
      if (sendResponse) {
        sendResponse({ success: false, error: 'No task provided' });
      }
      return;
    }
    
    // Update state
    updateState({
      isInFlow: true,
      currentTask: task,
      breakReminderEnabled: true
    });
    
    // Reset break reminder timer
    resetBreakReminder({ task });
    
    console.log('🌸 Deep Work mode started with task:', task);
    
    if (sendResponse) {
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('🌸 Error starting Deep Work mode:', error);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

/**
 * End deep work mode
 */
export function endDeepWork(sendResponse) {
  try {
    // Update state
    updateState({
      isInFlow: false,
      currentTask: '',
      breakReminderEnabled: false
    });
    
    // Clear badge
    chrome.action.setBadgeText({ text: '' });
    
    console.log('🌸 Deep Work mode ended');
    
    if (sendResponse) {
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('🌸 Error ending Deep Work mode:', error);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

/**
 * Get current deep work state
 */
export function getDeepWorkState(sendResponse) {
  const { isInFlow, currentTask } = getState();
  
  if (sendResponse) {
    sendResponse({
      isInFlow,
      currentTask
    });
  }
}
