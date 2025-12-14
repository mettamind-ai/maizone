/**
 * MaiZone Browser Extension
 * Message Actions (Classic): Global action names for classic scripts (content scripts)
 * @feature f05 - State Management
 */

/***** ACTION NAMES (GLOBAL) *****/

// Keep this list aligned with `actions.js` (ESM) to avoid string drift across contexts.
globalThis.MAIZONE_ACTIONS = Object.freeze({
  checkCurrentUrl: 'checkCurrentUrl',
  youtubeNavigation: 'youtubeNavigation',
  closeTab: 'closeTab',
  distractingWebsite: 'distractingWebsite',
  clipmdStart: 'clipmdStart',
  clipmdConvertMarkdown: 'clipmdConvertMarkdown',
  resetBreakReminder: 'resetBreakReminder',
  getBreakReminderState: 'getBreakReminderState',
  breakReminderBadgeTick: 'breakReminderBadgeTick',
  getState: 'getState',
  updateState: 'updateState',
  stateUpdated: 'stateUpdated'
});
