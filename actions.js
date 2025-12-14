/**
 * MaiZone Browser Extension
 * Message Actions: Centralized action names for runtime messaging
 * @feature f05 - State Management
 */

/***** ACTION NAMES *****/

export const messageActions = Object.freeze({
  checkCurrentUrl: 'checkCurrentUrl',
  youtubeNavigation: 'youtubeNavigation',
  closeTab: 'closeTab',
  distractingWebsite: 'distractingWebsite',
  clipmdStart: 'clipmdStart',
  clipmdConvertMarkdown: 'clipmdConvertMarkdown',
  resetBreakReminder: 'resetBreakReminder',
  getBreakReminderState: 'getBreakReminderState',
  getState: 'getState',
  updateState: 'updateState',
  stateUpdated: 'stateUpdated'
});
