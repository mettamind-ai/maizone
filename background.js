/**
 * MaiZone Browser Extension
 * Background Script: Central coordinator for all extension features
 */

import { initState, setupStateListeners, getState } from './background_state.js';
import { initDistraction } from './background_distraction.js';
import { initBreakReminder, handleNotificationButtonClick, sendBreakReminder, startBreakReminder } from './background_breakReminder.js';
import { initDeepWork } from './background_deepWork.js';
import { initPrediction } from './background_prediction.js';

/**
 * Initialize background script
 */
async function initBackgroundScript() {
  console.info('🌸 Mai background script initializing...');
  
  try {
    // Initialize state first
    const state = await initState();
    console.info('🌸 State initialized:', state);
    
    setupStateListeners();
    
    // Initialize feature modules
    initDistraction();
    initBreakReminder();
    initDeepWork();
    initPrediction();
    
    // Set up event listeners
    setupEventListeners();
    
    console.info('🌸 Mai background script loaded successfully');
  } catch (error) {
    console.error('🌸🌸🌸 Error initializing background script:', error);
  }
}

/**
 * Set up various event listeners
 */
function setupEventListeners() {
  // Handle extension installation or update
  chrome.runtime.onInstalled.addListener(onInstalledListener);
  
  // Handle notification button clicks
  chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClick);
  
  // Handle keyboard commands
  chrome.commands.onCommand.addListener(handleCommand);
}

/**
 * Handle keyboard commands
 */
function handleCommand(command) {
  console.log('🌸 Command received:', command);
  
  if (command === 'test-break-reminder') {
    // Check if deep work is active first
    const state = getState();    
    if (state.isInFlow && state.breakReminderEnabled) {
      console.log('🌸 Deep work active, setting timer to 10 seconds');      
      startBreakReminder(10 * 1000); // 10 seconds in milliseconds
      chrome.action.setBadgeText({ text: '00:10' });
    } else {
      // Normal behavior - use direct function reference
      sendBreakReminder();
      console.log('🌸 Break reminder sent successfully');
    }
  }
}

/**
 * Handle extension installation or update
 */
async function onInstalledListener(details) {
  console.info('🌸 Mai extension installed or updated:', details.reason);

  if (details.reason === 'install') {
    // Set default settings on first install
    setupDefaultSettings();
  }
}

/**
 * Setup default settings on first install
 */
async function setupDefaultSettings() {
  try {
    const { updateState } = await import('./background_state.js');
    
    await updateState({
      isEnabled: true,
      interactionLevel: 'balanced',
      notifyTextAnalysis: true,
      blockDistractions: true,
      textPredictionEnabled: true,
      breakReminderEnabled: true,
      distractingSites: [
        'youtube.com',
        'facebook.com',
        'twitter.com',
        'instagram.com',
        'reddit.com',
        'tiktok.com',
        'netflix.com',
        'spotify.com',
        'soundcloud.com',
        'vnexpress.net'
      ],
      deepWorkBlockedSites: [
        'discord.com',
        'messenger.com',
        'whatsapp.com'
      ]
    });
    
    console.info('🌸 Default settings initialized on install');
  } catch (error) {
    console.error('🌸 Error setting up default settings:', error);
  }
}

// Start initialization
initBackgroundScript();
