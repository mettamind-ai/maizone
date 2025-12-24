/**
 * MaiZone Browser Extension
 * Message Actions: Centralized action names for runtime messaging
 * @feature f05 - State Management
 * @feature f08 - Mindfulness Reminders
 * @feature f10 - Context Menu Quick Actions
 */

/***** ACTION NAMES *****/

export const messageActions = Object.freeze({
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
