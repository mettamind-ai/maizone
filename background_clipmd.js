/**
 * MaiZone Browser Extension
 * ClipMD Module: Pick an element -> HTML to Markdown -> copy to clipboard
 * @feature f06 - ClipMD (Clipboard to Markdown)
 */

import { messageActions } from './actions.js';

/***** OFFSCREEN CONVERSION *****/

const CLIPMD_OFFSCREEN_URL = 'clipmd_offscreen.html';
const CLIPMD_OFFSCREEN_MESSAGE_TYPE = 'clipmdConvertMarkdown';

/**
 * Ensure the offscreen document exists for Turndown conversion.
 * @returns {Promise<boolean>} True if offscreen is ready
 */
async function ensureClipmdOffscreen() {
  try {
    if (!chrome?.offscreen?.createDocument) return false;

    const hasDocument = await chrome.offscreen.hasDocument?.();
    if (hasDocument) return true;

    await chrome.offscreen.createDocument({
      url: CLIPMD_OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Convert selected element HTML to Markdown for clipboard copy'
    });
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    if (/existing/i.test(message)) return true;
    console.error('🌸🌸🌸 Error creating ClipMD offscreen document:', error);
    return false;
  }
}

/**
 * Convert HTML -> Markdown using the offscreen document.
 * @param {string} html - Raw outerHTML
 * @returns {Promise<{ok: boolean, markdown?: string, error?: string}>}
 */
async function convertHtmlToMarkdown(html) {
  const ready = await ensureClipmdOffscreen();
  if (!ready) return { ok: false, error: 'Offscreen not available' };

  return await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: CLIPMD_OFFSCREEN_MESSAGE_TYPE, html }, (reply) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({ ok: false, error: lastError.message || String(lastError) });
          return;
        }
        resolve(reply || { ok: false, error: 'No response' });
      });
    } catch (error) {
      resolve({ ok: false, error: error?.message || String(error) });
    }
  });
}

/***** COMMAND ENTRYPOINT *****/

/**
 * Start ClipMD pick mode on the active tab.
 * @returns {Promise<boolean>} True if request was sent
 */
export async function startClipmdMarkdownPicker() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;
    const url = typeof tab?.url === 'string' ? tab.url : '';

    if (typeof tabId !== 'number') return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

    await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: messageActions.clipmdStart, data: { mode: 'markdown' } }, () => {
        resolve();
      });
    });

    return true;
  } catch (error) {
    console.error('🌸🌸🌸 Error starting ClipMD picker:', error);
    return false;
  }
}

/***** MESSAGE HANDLERS *****/

/**
 * Setup background listeners for ClipMD conversion requests.
 * @returns {void}
 */
export function initClipmd() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action !== messageActions.clipmdConvertMarkdown) return false;

    (async () => {
      const rawHtml = typeof message?.data?.html === 'string' ? message.data.html : '';
      if (!rawHtml) return { success: false, error: 'No HTML provided' };

      // Basic safety bounds to prevent huge payloads from freezing the SW.
      const maxChars = 300_000;
      if (rawHtml.length > maxChars) {
        return { success: false, error: 'HTML too large' };
      }

      const result = await convertHtmlToMarkdown(rawHtml);
      if (!result?.ok) return { success: false, error: result?.error || 'Convert failed' };

      const markdown = typeof result.markdown === 'string' ? result.markdown : '';
      if (!markdown) return { success: false, error: 'Empty markdown' };

      return { success: true, markdown };
    })()
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error('🌸🌸🌸 Error converting markdown:', error);
        sendResponse({ success: false, error: 'Internal error' });
      });

    return true;
  });
}

