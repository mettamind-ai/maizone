/**
 * MaiZone Browser Extension
 * Distraction Module: Manages blocking distracting websites
 * @feature f01 - Distraction Blocking
 * @feature f04 - Deep Work Mode (integration part)
 */

import { getState } from './background_state.js';
import { sendMessageToTabSafely } from './messaging.js';
import { messageActions } from './actions.js';

/**
 * Initialize distraction blocking if enabled
 */
export function initDistraction() {
  setupMessageListeners();
  syncDistractionBlocking();
}

/**
 * Setup message listeners for distraction-related commands
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.checkCurrentUrl) {
      onCheckCurrentUrl(message.data, sender.tab, sendResponse);
      return true;
    }
    else if (message.action === messageActions.youtubeNavigation) {
      onYouTubeNavigation(message.data, sender.tab, sendResponse);
      return true;
    }
    else if (message.action === messageActions.closeTab) {
      const tabId = sender?.tab?.id;
      if (typeof tabId === 'number') {
        chrome.tabs.remove(tabId);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No tab to close' });
      }
      return true;
    }
    else if (message.action === messageActions.stateUpdated) {
      handleStateUpdated(message.state);
      return false;
    }
    return false;
  });
}

/**
 * Ensure webNavigation listeners match current state.
 */
function syncDistractionBlocking() {
  const { isEnabled, blockDistractions } = getState();
  const shouldEnable = !!(isEnabled && blockDistractions);

  if (shouldEnable) {
    enableDistractionsBlocking();
  } else {
    disableDistractionsBlocking();
  }
}

/**
 * Handle state updates broadcasted by background_state.
 * @param {Object} updates - Partial state
 * @returns {void}
 */
function handleStateUpdated(updates) {
  if (!updates || typeof updates !== 'object') return;
  if ('isEnabled' in updates || 'blockDistractions' in updates) {
    syncDistractionBlocking();
  }
}

/**
 * Enable distraction blocking (listeners only)
 */
function enableDistractionsBlocking() {
  console.info('🌸 Distraction blocking enabled');

  // Register listeners for navigation events
  if (!chrome.webNavigation.onCompleted.hasListener(handleWebNavigation)) {
    chrome.webNavigation.onCompleted.addListener(handleWebNavigation);
  }
  if (!chrome.webNavigation.onHistoryStateUpdated.hasListener(handleWebNavigation)) {
    chrome.webNavigation.onHistoryStateUpdated.addListener(handleWebNavigation);
  }

  // Check current tab
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs.length) return;
    const currentTab = tabs[0];
    if (currentTab.url && currentTab.url.startsWith('http')) {
      const isDistracting = await isDistractingWebsite(currentTab.url);
      if (isDistracting) {
        sendWarningToTab(currentTab.id, currentTab.url);
      }
    }
  });
}

/**
 * Disable distraction blocking (listeners only)
 */
function disableDistractionsBlocking() {
  console.info('🌸 Distraction blocking disabled');

  // Remove navigation listeners
  if (chrome.webNavigation.onCompleted.hasListener(handleWebNavigation)) {
    chrome.webNavigation.onCompleted.removeListener(handleWebNavigation);
  }
  if (chrome.webNavigation.onHistoryStateUpdated.hasListener(handleWebNavigation)) {
    chrome.webNavigation.onHistoryStateUpdated.removeListener(handleWebNavigation);
  }
}

/**
 * Check if a URL is a distracting website
 * @feature f01 - Distraction Blocking
 * @feature f04 - Deep Work Mode (for messaging sites blocking)
 */
async function isDistractingWebsite(url) {
  try {
    const { hostname } = new URL(url);
    const normalized = hostname.toLowerCase().replace(/^www\./, '');
    
    const { distractingSites, deepWorkBlockedSites, isInFlow, blockDistractions, isEnabled } = getState();
    
    // If blocking is disabled, return false
    if (!blockDistractions || !isEnabled) return false;

    console.log(`🌸 Checking distraction for ${normalized}. Deep work mode: ${isInFlow}`);

    // Check standard distracting sites
    const isDistracting = distractingSites.some((site) => {
      const s = site.toLowerCase().replace(/^www\./, '');
      return normalized === s || normalized.endsWith('.' + s);
    });

    if (isDistracting) {
      console.log(`🌸 Standard distracting site detected: ${normalized}`);
      return true;
    }

    // If in Deep Work mode, also check deep work blocked sites
    if (isInFlow) {
      console.log(`🌸 In Deep Work mode. Checking if ${normalized} is in the blocked list`);
      
      const isDeepWorkBlocked = deepWorkBlockedSites.some((site) => {
        const s = site.toLowerCase().replace(/^www\./, '');
        return normalized === s || normalized.endsWith('.' + s);
      });
      
      if (isDeepWorkBlocked) {
        console.log(`🌸 Deep Work mode active: Blocking messaging site ${normalized}`);
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('🌸🌸🌸 Error checking URL:', err);
    return false;
  }
}

/**
 * Handle web navigation events
 */
async function handleWebNavigation(details) {
  if (details.frameId !== 0) return;
  if (!details.url || details.url === 'about:blank') return;

  const { isEnabled, blockDistractions } = getState();
  if (!isEnabled || !blockDistractions) {
    return;
  }

  console.log(`🌸 Navigation detected: ${details.url}`);
  const isDistracting = await isDistractingWebsite(details.url);
  if (isDistracting) {
    console.log(`🌸 Navigation to distracting site detected: ${details.url}`);
    sendWarningToTab(details.tabId, details.url);
  }
}

/**
 * Send warning to tab about distracting website
 */
function sendWarningToTab(tabId, url) {
  try {
    const { isInFlow, deepWorkBlockedSites } = getState();
    
    // Check if URL is in deep work blocked sites
    const { hostname } = new URL(url);
    const normalized = hostname.toLowerCase().replace(/^www\./, '');
    
    const isDeepWorkBlocked = deepWorkBlockedSites.some(site => {
      const s = site.toLowerCase().replace(/^www\./, '');
      return normalized === s || normalized.endsWith('.' + s);
    });

    console.log(`🌸 Sending warning for ${url}. Deep work: ${isInFlow}, Is messaging site: ${isDeepWorkBlocked}`);

    // Customize message based on site type
    let message = '';
    if (isDeepWorkBlocked && isInFlow) {
      message = 'Bạn đang trong chế độ Deep Work. Việc kiểm tra tin nhắn có thể làm gián đoạn sự tập trung của bạn. Bạn có chắc chắn muốn tiếp tục?';
    } else {
      message = 'Mai nhận thấy đây là trang web gây sao nhãng. Bạn có thật sự muốn tiếp tục?';
    }

    // Send message to content script
    sendMessageToTabSafely(tabId, {
      action: messageActions.distractingWebsite,
      data: {
        url,
        message,
        isDeepWorkBlocked,
        isInDeepWorkMode: isInFlow
      }
    });
  } catch (error) {
    console.error('🌸🌸🌸 Error in sendWarningToTab:', error);
  }
}

/**
 * Handle check current URL request from content script
 */
async function onCheckCurrentUrl(data, tab, sendResponse) {
  if (!data?.url) {
    sendResponse({ received: false, error: 'No URL' });
    return;
  }
  
  console.log('🌸 Checking URL for distractions:', data.url);
  
  // Check if URL is distracting
  const isDistracting = await isDistractingWebsite(data.url);
  console.log('🌸 URL check result:', isDistracting);
  
  if (isDistracting && tab?.id) {
    console.log('🌸 Sending warning for URL:', data.url);
    sendWarningToTab(tab.id, data.url);
  }
  
  sendResponse({ received: true, isDistracting });
}

/**
 * Handle YouTube SPA navigation
 */
function onYouTubeNavigation(data, tab, sendResponse) {
  if (data?.url && tab?.id) {
    console.debug('🌸 YouTube navigation detected:', data.url);
    const details = { url: data.url, frameId: 0, tabId: tab.id };
    handleWebNavigation(details);
  }
  sendResponse({ received: true });
}
