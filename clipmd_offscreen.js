/**
 * MaiZone Browser Extension
 * ClipMD Offscreen: HTML -> Markdown conversion worker (Turndown)
 * @feature f06 - ClipMD (Clipboard to Markdown)
 */

/***** TURNDOWN WORKER *****/

const CLIPMD_OFFSCREEN_MESSAGE_TYPE = 'clipmdConvertMarkdown';

/**
 * Convert HTML string to Markdown (pure conversion inside offscreen document).
 * @param {string} html - Raw HTML
 * @returns {{ok: boolean, markdown?: string, error?: string}}
 */
function convertMarkdown(html) {
  try {
    const td = new TurndownService({ codeBlockStyle: 'fenced' });
    const markdown = td.turndown(html || '');
    return { ok: true, markdown };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== CLIPMD_OFFSCREEN_MESSAGE_TYPE) return false;

  const html = typeof message?.html === 'string' ? message.html : '';
  const response = convertMarkdown(html);
  sendResponse(response);

  return true;
});

