/**
 * MaiZone Browser Extension
 * Message Actions: Centralized action names for runtime messaging
 * @feature f05 - State Management
 * @feature f08 - Mindfulness Reminders
 */

/***** ACTION NAMES *****/

export const messageActions = Object.freeze({
  checkCurrentUrl: 'checkCurrentUrl',
  youtubeNavigation: 'youtubeNavigation',
  closeTab: 'closeTab',
  distractingWebsite: 'distractingWebsite',
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
