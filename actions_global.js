/**
 * MaiZone Browser Extension
 * Message Actions (Classic): Global action names for classic scripts (content scripts)
 * @feature f05 - State Management
 * @feature f08 - Mindfulness Reminders
 * @feature f10 - Context Menu Quick Actions
 */

/***** ACTION NAMES (GLOBAL) *****/

// Keep this list aligned with `actions.js` (ESM) to avoid string drift across contexts.
globalThis.MAIZONE_ACTIONS = Object.freeze({
  maiToast: 'maiToast',
  mindfulnessToast: 'mindfulnessToast',
  clipmdStart: 'clipmdStart',
  clipmdConvertMarkdown: 'clipmdConvertMarkdown',
  resetBreakReminder: 'resetBreakReminder',
  getBreakReminderState: 'getBreakReminderState',
  breakReminderBadgeTick: 'breakReminderBadgeTick',
  intentGateAllowAccess: 'intentGateAllowAccess',
  intentGateGetReasonLog: 'intentGateGetReasonLog',
  getState: 'getState',
  updateState: 'updateState',
  stateUpdated: 'stateUpdated'
});
