/**
 * MaiZone Browser Extension
 * Options Page Script
 * @feature f01 - Distraction Blocking
 * @feature f04 - Deep Work Mode
 * @feature f05 - State Management
 */

import { getStateSafely, updateStateSafely } from './state_helpers.js';
import { messageActions } from './actions.js';

/***** INITIALIZATION *****/

document.addEventListener('DOMContentLoaded', initOptions);

/**
 * Khởi tạo trang cài đặt.
 * @returns {Promise<void>}
 */
async function initOptions() {
  console.info('🌸 Options page loaded');

  loadSiteLists();

  const addSiteBtn = document.getElementById('add-site-btn');
  const addDeepWorkSiteBtn = document.getElementById('add-deepwork-site-btn');

  addSiteBtn?.addEventListener('click', () => handleAddSite('distractingSites'));
  addDeepWorkSiteBtn?.addEventListener('click', () => handleAddSite('deepWorkBlockedSites'));

  // Listen for state updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === messageActions.stateUpdated) {
      handleStateUpdate(message.delta || message.state);
    }
  });
}

/***** RENDERING *****/

/**
 * Handle state updates from background.
 * @param {Object} updates - Partial state
 * @returns {void}
 */
function handleStateUpdate(updates) {
  if (!updates || typeof updates !== 'object') return;

  if ('distractingSites' in updates) {
    renderSiteList('distractingSites', updates.distractingSites);
  }

  if ('deepWorkBlockedSites' in updates) {
    renderSiteList('deepWorkBlockedSites', updates.deepWorkBlockedSites);
  }
}

/**
 * Load saved site lists.
 * @returns {void}
 */
function loadSiteLists() {
  getStateSafely(['distractingSites', 'deepWorkBlockedSites'])
    .then((state) => {
      renderSiteList('distractingSites', state.distractingSites || []);
      renderSiteList('deepWorkBlockedSites', state.deepWorkBlockedSites || []);
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error loading site lists:', error);
    });
}

/**
 * Render site list in UI.
 * @param {'distractingSites'|'deepWorkBlockedSites'} listType - Which list
 * @param {Array<string>} sites - List of hostnames
 * @returns {void}
 */
function renderSiteList(listType, sites) {
  const listContainerId = listType === 'distractingSites' ? 'site-list' : 'deepwork-site-list';
  const listContainer = document.getElementById(listContainerId);
  if (!listContainer) return;

  listContainer.innerHTML = '';

  (sites || []).forEach((site) => {
    const li = document.createElement('li');
    li.textContent = site;
    li.style.cursor = 'pointer';
    li.title = 'Click để xóa';
    li.addEventListener('click', () => removeSite(listType, site));
    listContainer.appendChild(li);
  });
}

/***** LIST MUTATIONS *****/

/**
 * Remove site from list.
 * @param {'distractingSites'|'deepWorkBlockedSites'} listType - Which list
 * @param {string} site - Hostname
 * @returns {void}
 */
function removeSite(listType, site) {
  getStateSafely(listType)
    .then((response) => {
      const sites = response[listType] || [];
      const updated = sites.filter((s) => s !== site);

      return updateStateSafely({ [listType]: updated }).then(() => {
        renderSiteList(listType, updated);
      });
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error removing site:', error);
    });
}

/**
 * Add site to list.
 * @param {'distractingSites'|'deepWorkBlockedSites'} listType - Which list
 * @returns {void}
 */
function handleAddSite(listType) {
  const inputId = listType === 'distractingSites' ? 'new-site-input' : 'new-deepwork-site-input';
  const input = document.getElementById(inputId);
  if (!input) return;

  const newSite = normalizeHostnameInput(input.value);
  if (!newSite) {
    alert('Vui lòng nhập domain hợp lệ (vd: facebook.com)');
    return;
  }

  getStateSafely(listType)
    .then((response) => {
      const sites = response[listType] || [];

      if (!sites.includes(newSite)) {
        const updated = [...sites, newSite];
        return updateStateSafely({ [listType]: updated }).then(() => {
          input.value = '';
          renderSiteList(listType, updated);
        });
      }
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error adding site:', error);
    });
}

/***** INPUT SANITIZATION *****/

/**
 * Chuẩn hoá domain do người dùng nhập (loại bỏ protocol/path và kiểm tra ký tự hợp lệ).
 * @param {string} input - Raw user input
 * @returns {string|null} Normalized hostname (vd: facebook.com) hoặc null nếu không hợp lệ
 */
function normalizeHostnameInput(input) {
  const raw = (input || '').trim().toLowerCase();
  if (!raw) return null;

  const withoutProtocol = raw.replace(/^https?:\/\//, '');
  const hostname = withoutProtocol
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/^www\./, '');

  if (!hostname || /\s/.test(hostname)) return null;
  if (!hostname.includes('.')) return null;
  if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
  if (hostname.startsWith('.') || hostname.endsWith('.')) return null;
  if (hostname.includes('..')) return null;

  return hostname;
}
