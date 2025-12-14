/**
 * MaiZone Browser Extension
 * Break Reminder Module: Manages break reminders and MV3-safe timers via chrome.alarms
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode (timer integration)
 */

import { ensureInitialized, getState, onStateDelta, updateState } from './background_state.js';
import { BREAK_REMINDER_INTERVAL, BREAK_REMINDER_MESSAGES } from './constants.js';
import { messageActions } from './actions.js';

/***** ALARM NAMES *****/

const BREAK_REMINDER_END_ALARM = 'maizone_breakReminderEnd';
const BREAK_REMINDER_BADGE_ALARM = 'maizone_breakReminderBadgeTick';

let unsubscribeStateDelta = null;

/***** TRUSTED SENDER (DEFENSE-IN-DEPTH) *****/

/**
 * Check whether the message sender is a trusted UI extension page (popup/options).
 * @param {chrome.runtime.MessageSender} sender - Sender info
 * @returns {boolean}
 */
function isTrustedUiSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  // Content scripts provide sender.tab; extension pages do not.
  if (sender.tab) return false;
  const senderUrl = typeof sender.url === 'string' ? sender.url : '';
  return senderUrl.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

/***** INITIALIZATION *****/

/**
 * Initialize break reminder module.
 * @returns {void}
 */
export function initBreakReminder() {
  setupMessageListeners();
  setupAlarmListeners();
  setupInternalStateSubscription();
  ensureInitialized()
    .then(() => initializeBreakReminderIfEnabled())
    .catch((error) => {
      console.error('🌸🌸🌸 Error initializing break reminder:', error);
      initializeBreakReminderIfEnabled();
    });
}

/***** INTERNAL SUBSCRIPTION *****/

/**
 * Subscribe to internal state updates (service worker).
 * @returns {void}
 */
function setupInternalStateSubscription() {
  if (unsubscribeStateDelta) return;
  unsubscribeStateDelta = onStateDelta((nextState, delta) => {
    handleStateUpdated(delta);
  });
}

/***** MESSAGING *****/

/**
 * Setup message listeners for break reminder commands.
 * @returns {void}
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.resetBreakReminder) {
      if (!isTrustedUiSender(sender)) {
        sendResponse?.({ success: false, error: 'Forbidden' });
        return true;
      }
      resetBreakReminder(message.data, sendResponse);
      return true;
    }

    if (message.action === messageActions.getBreakReminderState) {
      if (!isTrustedUiSender(sender)) {
        sendResponse?.({
          enabled: false,
          startTime: null,
          interval: BREAK_REMINDER_INTERVAL,
          expectedEndTime: null
        });
        return true;
      }
      getBreakReminderState(sendResponse);
      return true;
    }

    return false;
  });
}

/**
 * Handle state updates broadcasted by background_state.
 * @param {Object} updates - Partial state
 * @returns {void}
 */
function handleStateUpdated(updates) {
  if (!updates || typeof updates !== 'object') return;

  const shouldSync =
    'isEnabled' in updates ||
    'breakReminderEnabled' in updates ||
    'isInFlow' in updates ||
    'currentTask' in updates ||
    'reminderStartTime' in updates ||
    'reminderInterval' in updates ||
    'reminderExpectedEndTime' in updates;

  if (!shouldSync) return;

  const shouldStop =
    ('isEnabled' in updates && !updates.isEnabled) ||
    ('breakReminderEnabled' in updates && !updates.breakReminderEnabled) ||
    ('isInFlow' in updates && !updates.isInFlow) ||
    ('currentTask' in updates && !updates.currentTask);

  if (shouldStop) {
    stopBreakReminder();
    return;
  }

  // If something relevant changed and we didn't stop, ensure alarms/badge reflect current state.
  ensureInitialized()
    .then(() => initializeBreakReminderIfEnabled())
    .catch((error) => console.error('🌸🌸🌸 Error syncing break reminder after state update:', error));
}

/***** ALARMS *****/

/**
 * Setup alarm listeners (MV3-safe timers).
 * @returns {void}
 */
function setupAlarmListeners() {
  if (!chrome?.alarms?.onAlarm) {
    console.warn('🌸🌸🌸 chrome.alarms API unavailable; break reminders may be unreliable.');
    return;
  }

  if (!chrome.alarms.onAlarm.hasListener(handleAlarm)) {
    chrome.alarms.onAlarm.addListener(handleAlarm);
  }
}

/**
 * Alarm event handler.
 * @param {chrome.alarms.Alarm} alarm - Alarm object
 * @returns {void}
 */
async function handleAlarm(alarm) {
  if (!alarm?.name) return;

  await ensureInitialized();

  if (alarm.name === BREAK_REMINDER_BADGE_ALARM) {
    updateBadgeWithTimerDisplay();
    return;
  }

  if (alarm.name === BREAK_REMINDER_END_ALARM) {
    await handleBreakReminderEnd();
  }
}

/**
 * Schedule end + badge alarms for the current session.
 * @param {number} expectedEndTime - Epoch ms timestamp
 * @returns {void}
 */
function scheduleBreakReminderAlarms(expectedEndTime) {
  if (!chrome?.alarms) return;
  if (typeof expectedEndTime !== 'number' || !Number.isFinite(expectedEndTime)) return;

  try {
    chrome.alarms.create(BREAK_REMINDER_END_ALARM, { when: expectedEndTime });

    // Keep badge roughly in sync without relying on long-lived timers.
    chrome.alarms.create(BREAK_REMINDER_BADGE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
  } catch (error) {
    console.error('🌸🌸🌸 Error scheduling break reminder alarms:', error);
  }
}

/**
 * Clear all break reminder alarms.
 * @returns {void}
 */
function stopBreakReminder() {
  try {
    chrome.alarms?.clear(BREAK_REMINDER_END_ALARM);
    chrome.alarms?.clear(BREAK_REMINDER_BADGE_ALARM);
  } catch (error) {
    console.warn('🌸🌸🌸 Error clearing break reminder alarms:', error);
  }

  try {
    chrome.action?.setBadgeText({ text: '' });
  } catch (error) {
    console.warn('🌸🌸🌸 Error clearing break reminder badge:', error);
  }
}

/***** TIMER CORE *****/

/**
 * Initialize break reminder if enabled (service worker restart safe).
 * @returns {void}
 */
async function initializeBreakReminderIfEnabled() {
  const {
    breakReminderEnabled,
    isEnabled,
    isInFlow,
    currentTask,
    reminderStartTime,
    reminderInterval,
    reminderExpectedEndTime
  } = getState();

  if (!breakReminderEnabled || !isEnabled || !isInFlow || !currentTask) {
    stopBreakReminder();
    return;
  }

  const interval = reminderInterval || BREAK_REMINDER_INTERVAL;
  const startTime = reminderStartTime || Date.now();
  const expectedEndTime = reminderExpectedEndTime || (startTime + interval);

  if (Date.now() >= expectedEndTime) {
    await handleBreakReminderEnd();
    return;
  }

  if (!reminderStartTime || !reminderExpectedEndTime || !reminderInterval) {
    await updateState({
      reminderStartTime: startTime,
      reminderInterval: interval,
      reminderExpectedEndTime: expectedEndTime
    });
  }

  scheduleBreakReminderAlarms(expectedEndTime);
  updateBadgeWithTimerDisplay();
}

/**
 * Update badge with timer display.
 * @returns {void}
 */
function updateBadgeWithTimerDisplay() {
  const { breakReminderEnabled, reminderStartTime, reminderInterval, reminderExpectedEndTime, isInFlow } = getState();

  if (!isInFlow || !breakReminderEnabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  let expectedEndTime = reminderExpectedEndTime;
  if (typeof expectedEndTime !== 'number' || !Number.isFinite(expectedEndTime)) {
    if (typeof reminderStartTime !== 'number' || !Number.isFinite(reminderStartTime)) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    if (typeof reminderInterval !== 'number' || !Number.isFinite(reminderInterval)) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    expectedEndTime = reminderStartTime + reminderInterval;
  }

  const remainingMs = expectedEndTime - Date.now();
  if (remainingMs <= 0) {
    chrome.action.setBadgeText({ text: '00' });
    return;
  }

  // MV3 badge tick runs by minute; keep badge consistent by showing minutes only.
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  chrome.action.setBadgeText({ text: String(remainingMinutes).padStart(2, '0') });
}

/**
 * Start break reminder timer (MV3-safe via alarms).
 * @param {number} [customInterval] - Custom interval in ms
 * @returns {void}
 */
async function startBreakReminder(customInterval) {
  stopBreakReminder();

  const { isEnabled, isInFlow, currentTask, breakReminderEnabled } = getState();
  if (!isEnabled || !isInFlow || !currentTask || !breakReminderEnabled) {
    return;
  }

  const interval =
    typeof customInterval === 'number' && Number.isFinite(customInterval) && customInterval > 0
      ? customInterval
      : BREAK_REMINDER_INTERVAL;

  const reminderStartTime = Date.now();
  const reminderExpectedEndTime = reminderStartTime + interval;

  await updateState({
    reminderStartTime,
    reminderInterval: interval,
    reminderExpectedEndTime
  });

  scheduleBreakReminderAlarms(reminderExpectedEndTime);
  updateBadgeWithTimerDisplay();
}

/**
 * Handle timer end alarm (end Deep Work cycle + notify user).
 * @returns {void}
 */
async function handleBreakReminderEnd() {
  const { isEnabled, isInFlow, currentTask, breakReminderEnabled, reminderExpectedEndTime } = getState();

  // No longer valid -> just cleanup.
  if (!isEnabled || !isInFlow || !currentTask || !breakReminderEnabled) {
    stopBreakReminder();
    return;
  }

  const now = Date.now();
  if (
    typeof reminderExpectedEndTime === 'number' &&
    Number.isFinite(reminderExpectedEndTime) &&
    now < reminderExpectedEndTime
  ) {
    // Alarm can fire early/late; reschedule if early.
    scheduleBreakReminderAlarms(reminderExpectedEndTime);
    updateBadgeWithTimerDisplay();
    return;
  }

  console.log('🌸 Break time reached! Ending Deep Work cycle...');

  // End cycle first so popup resets deterministically.
  await updateState({
    isInFlow: false,
    currentTask: '',
    breakReminderEnabled: false
  });

  stopBreakReminder();

  showBreakReminderNotification();
}

/***** NOTIFICATIONS *****/

/**
 * Send break reminder notification (manual test entrypoint).
 * @feature f03 - Break Reminder
 * @returns {void}
 */
export function sendBreakReminder() {
  console.debug('🌸 Break reminder triggered');
  showBreakReminderNotification();
}

/**
 * Show break reminder notification.
 * @returns {void}
 */
function showBreakReminderNotification() {
  const randomMessage = BREAK_REMINDER_MESSAGES[Math.floor(Math.random() * BREAK_REMINDER_MESSAGES.length)];
  console.log('🌸 Selected random message:', randomMessage);

  const options = {
    type: 'basic',
    iconUrl: 'icon.png',
    title: '🌸 Nghỉ xíu nhỉ! ✨',
    message: randomMessage,
    priority: 2
  };

  try {
    chrome.notifications.create('break-reminder-notification', options, () => {
      if (!chrome.runtime.lastError) return;

      console.error('🌸🌸🌸 Error creating notification:', chrome.runtime.lastError);
      chrome.notifications.create('break-reminder-notification-alt', options);
    });

    console.info('🌸 Break reminder sent');
  } catch (error) {
    console.error('🌸🌸🌸 Error in sendBreakReminder:', error);
  }
}

/***** PUBLIC ACTIONS *****/

/**
 * Reset break reminder timer with new task.
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 * @param {Object} data - Payload from popup
 * @param {Function} sendResponse - Chrome response callback
 * @returns {void}
 */
function resetBreakReminder(data, sendResponse) {
  ensureInitialized()
    .then(async () => {
      try {
        const task = typeof data?.task === 'string' ? data.task.trim() : '';
        if (!task) {
          sendResponse?.({ success: false, error: 'Missing task' });
          return;
        }

        console.log('🌸 Resetting break reminder timer');

        stopBreakReminder();

        const interval = BREAK_REMINDER_INTERVAL;
        const reminderStartTime = Date.now();
        const reminderExpectedEndTime = reminderStartTime + interval;

        await updateState({
          currentTask: task,
          isInFlow: true,
          breakReminderEnabled: true,
          reminderStartTime,
          reminderInterval: interval,
          reminderExpectedEndTime
        });

        scheduleBreakReminderAlarms(reminderExpectedEndTime);
        updateBadgeWithTimerDisplay();

        sendResponse?.({ success: true });
      } catch (error) {
        console.error('🌸🌸🌸 Error in resetBreakReminder:', error);
        sendResponse?.({ success: false, error: error?.message || String(error) });
      }
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error ensuring state before resetBreakReminder:', error);
      sendResponse?.({ success: false, error: error?.message || String(error) });
    });
}

/**
 * Get current break reminder state.
 * @param {Function} sendResponse - Chrome response callback
 * @returns {void}
 */
function getBreakReminderState(sendResponse) {
  ensureInitialized()
    .then(async () => {
      const {
        breakReminderEnabled,
        reminderStartTime,
        reminderInterval,
        reminderExpectedEndTime,
        isEnabled,
        isInFlow,
        currentTask
      } = getState();

      const isActive = !!(isEnabled && isInFlow && currentTask && breakReminderEnabled);

      if (!isActive) {
        sendResponse({
          enabled: false,
          startTime: null,
          interval: BREAK_REMINDER_INTERVAL,
          expectedEndTime: null
        });
        return;
      }

      if (!reminderStartTime || !reminderExpectedEndTime) {
        await startBreakReminder(reminderInterval || BREAK_REMINDER_INTERVAL);
        const newState = getState();
        sendResponse({
          enabled: true,
          startTime: newState.reminderStartTime,
          interval: newState.reminderInterval || BREAK_REMINDER_INTERVAL,
          expectedEndTime: newState.reminderExpectedEndTime
        });
        return;
      }

      sendResponse({
        enabled: true,
        startTime: reminderStartTime,
        interval: reminderInterval || BREAK_REMINDER_INTERVAL,
        expectedEndTime: reminderExpectedEndTime
      });
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error ensuring state before getBreakReminderState:', error);
      sendResponse({
        enabled: false,
        startTime: null,
        interval: BREAK_REMINDER_INTERVAL,
        expectedEndTime: null
      });
    });
}
