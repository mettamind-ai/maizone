/**
 * MaiZone Browser Extension
 * Options Page Script
 */

document.addEventListener('DOMContentLoaded', initOptions);

/**
 * Khởi tạo trang cài đặt
 */
async function initOptions() {
  console.info('🌸 Options page loaded');
  loadInteractionLevel();
  loadSiteLists();

  // Event listeners
  document.getElementById('add-site-btn').addEventListener('click', () => handleAddSite('distractingSites'));
  document.getElementById('add-deepwork-site-btn').addEventListener('click', () => handleAddSite('deepWorkBlockedSites'));
  
  // Listen for state updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'stateUpdated') {
      handleStateUpdate(message.state);
    }
  });
}

/**
 * Handle state updates from background
 */
function handleStateUpdate(updates) {
  if ('interactionLevel' in updates) {
    document.getElementById('interaction-level-select').value = updates.interactionLevel;
  }
  
  if ('distractingSites' in updates) {
    renderSiteList('distractingSites', updates.distractingSites);
  }
  
  if ('deepWorkBlockedSites' in updates) {
    renderSiteList('deepWorkBlockedSites', updates.deepWorkBlockedSites);
  }
  
}

/**
 * Load saved site lists
 */
function loadSiteLists() {
  chrome.runtime.sendMessage({ 
    action: 'getState', 
    keys: ['distractingSites', 'deepWorkBlockedSites'] 
  })
  .then(state => {
    renderSiteList('distractingSites', state.distractingSites || []);
    renderSiteList('deepWorkBlockedSites', state.deepWorkBlockedSites || []);
  });
}

/**
 * Render site list in UI
 */
function renderSiteList(listType, sites) {
  const listContainerId = listType === 'distractingSites' ? 'site-list' : 'deepwork-site-list';
  const listContainer = document.getElementById(listContainerId);
  listContainer.innerHTML = ''; // Clear existing items

  sites.forEach((site) => {
    const li = document.createElement('li');
    li.textContent = site;
    li.style.cursor = 'pointer';
    li.title = 'Click để xóa';
    li.addEventListener('click', () => removeSite(listType, site));
    listContainer.appendChild(li);
  });
}

/**
 * Remove site from list
 */
function removeSite(listType, site) {
  chrome.runtime.sendMessage({ action: 'getState', key: listType })
    .then(response => {
      const sites = response[listType] || [];
      const updated = sites.filter(s => s !== site);
      
      chrome.runtime.sendMessage({
        action: 'updateState',
        payload: { [listType]: updated }
      })
      .then(() => {
        renderSiteList(listType, updated);
      });
    });
}

/**
 * Add site to list
 */
function handleAddSite(listType) {
  const inputId = listType === 'distractingSites' ? 'new-site-input' : 'new-deepwork-site-input';
  const input = document.getElementById(inputId);
  const newSite = (input.value || '').trim();
  
  if (!newSite) return;

  chrome.runtime.sendMessage({ action: 'getState', key: listType })
    .then(response => {
      const sites = response[listType] || [];
      
      if (!sites.includes(newSite)) {
        const updated = [...sites, newSite];
        
        chrome.runtime.sendMessage({
          action: 'updateState',
          payload: { [listType]: updated }
        })
        .then(() => {
          input.value = '';
          renderSiteList(listType, updated);
        });
      }
    });
}

/**
 * Load and save interaction level
 */
function loadInteractionLevel() {
  const selectEl = document.getElementById('interaction-level-select');
  
  chrome.runtime.sendMessage({ action: 'getState', key: 'interactionLevel' })
    .then(response => {
      selectEl.value = response.interactionLevel || 'balanced';
    });

  selectEl.addEventListener('change', () => {
    const newLevel = selectEl.value;
    
    chrome.runtime.sendMessage({
      action: 'updateState',
      payload: { interactionLevel: newLevel }
    })
    .then(() => {
      console.info('🌸 interactionLevel updated to', newLevel);
    });
  });
}
