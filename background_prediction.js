/**
 * MaiZone Browser Extension
 * Prediction Module: Manages text prediction features
 * @feature f02 - AI Text Prediction
 */

import { getState, updateState } from './background_state.js';
import { TEXT_PREDICTION_CONFIG, GEMINI_CONFIG } from './constants.js';

// Store last API call time for rate limiting
let lastApiCallTime = 0;

/**
 * Initialize text prediction module
 */
export function initPrediction() {
  setupMessageListeners();
}

/**
 * Setup message listeners for prediction-related commands
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'requestTextPrediction') {
      onRequestTextPrediction(message.data, sender.tab, sendResponse);
      return true;
    }
    else if (message.action === 'suggestionAccepted') {
      onSuggestionAccepted(message.data);
      sendResponse({ received: true });
      return true;
    }
    else if (message.action === 'toggleTextPrediction') {
      onToggleTextPrediction(message.data, sendResponse);
      return true;
    }
    else if (message.action === 'getApiKey') {
      getApiKey(message.data?.provider).then(sendResponse);
      return true;
    }
    return false;
  });
}

/**
 * Check if API can be called (rate limiting)
 */
function canCallApi() {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  
  if (timeSinceLastCall < TEXT_PREDICTION_CONFIG.MIN_TIME_BETWEEN_CALLS) {
    return false;
  }
  
  // Update last call time
  lastApiCallTime = now;
  return true;
}

/**
 * Create prompt for text prediction
 */
function createPredictionPrompt(context) {
  const prompt = `Dựa vào ngữ cảnh sau, dự đoán người dùng sẽ nhập gì vào trường nhập liệu:
  
  Ngữ cảnh trang web: ${context.pageTitle || 'Không có tiêu đề'}
  Loại trường nhập liệu: ${context.inputType || 'text'}
  Placeholder: ${context.placeholder || 'Không có placeholder'}
  URL trang web: ${context.url || 'Không có URL'}
  Nội dung hiện tại: ${context.currentContent || ''}
  
  Hãy đưa ra một gợi ý ngắn gọn, dí dỏm và nhẹ nhàng về nội dung người dùng có thể nhập tiếp theo.
  Trả lời CHÍNH XÁC những gì bạn nghĩ người dùng sẽ nhập tiếp theo, không thêm bất kỳ giải thích nào.
  Chỉ trả về phần tiếp theo của nội dung, không lặp lại phần đã có.`;
  
  console.log('🌸 Prompt for LLM:', prompt);
  return prompt;
}

/**
 * Format prediction result for display
 */
function formatPrediction(prediction) {
  if (!prediction) return '';
  
  // Remove quotes if present
  let formatted = prediction.replace(/^["']|["']$/g, '');
  
  // Limit length
  if (formatted.length > TEXT_PREDICTION_CONFIG.MAX_SUGGESTION_LENGTH) {
    formatted = formatted.substring(0, TEXT_PREDICTION_CONFIG.MAX_SUGGESTION_LENGTH) + '...';
  }
  
  return formatted;
}

/**
 * Predict user input based on context
 * @feature f02 - AI Text Prediction
 */
export async function predictUserInput(context, apiKey) {
  try {
    // Create prompt
    const prompt = createPredictionPrompt(context);

    // Call API directly with fetch
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.MODEL_NAME}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              // text: `${GEMINI_CONFIG.SYSTEM_PROMPT}\n\n${prompt}`
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7, topK: 40, topP: 0.95,
            maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_CONFIG.LOW } // Use NONE for fastest response
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`API call failed with status: ${response.status}`);
    }

    const result = await response.json();
    console.log('🌸 Raw API response:', result);

    // Extract text from the response
    const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      throw new Error('No text generated from API response');
    }

    console.log('🌸 Generated text:', generatedText);
    return formatPrediction(generatedText);
  } catch (error) {
    console.error('🌸 Error calling Gemini API:', error);
    return null;
  }
}

/**
 * Handle text prediction request
 */
export async function onRequestTextPrediction(data, tab, sendResponse) {
  if (!data || !tab?.id) {
    sendResponse({ success: false, error: 'Invalid data or tab' });
    return;
  }

  console.log('🌸 Received text prediction request:', data);

  try {
    // Check if feature is enabled
    const { isEnabled, textPredictionEnabled, notifyTextAnalysis } = getState();

    // Check both text prediction enabled and text analysis enabled
    if (!isEnabled || !textPredictionEnabled || !notifyTextAnalysis) {
      console.log('🌸 Text prediction is disabled:', { 
        isEnabled, 
        textPredictionEnabled, 
        notifyTextAnalysis 
      });
      sendResponse({ success: false, error: 'Text prediction is disabled' });
      return;
    }

    // Check rate limiting
    if (!canCallApi()) {
      sendResponse({ success: false, error: 'Rate limited' });
      return;
    }

    // Get API key
    const apiKey = await getApiKey('gemini');
    if (!apiKey) {
      sendResponse({ success: false, error: 'No API key available' });
      return;
    }

    // Call API for prediction
    console.log('🌸 Calling predictUserInput with context:', JSON.stringify(data));
    const suggestion = await predictUserInput(data, apiKey);
    if (!suggestion) {
      console.error('🌸 Failed to get prediction');
      sendResponse({ success: false, error: 'Failed to get prediction' });
      return;
    }
    console.log('🌸 Got suggestion from API:', suggestion);

    // Send result to content script
    await sendMessageToTabSafely(tab.id, {
      action: 'textPredictionResult',
      data: { suggestion }
    });

    sendResponse({ success: true });
  } catch (error) {
    console.error('🌸 Error in text prediction:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle suggestion accepted
 */
export function onSuggestionAccepted(data) {
  if (!data?.suggestion) return;
  
  console.debug('🌸 User accepted suggestion:', data.suggestion);
  // Could add analytics or storage for improving suggestions in the future
}

/**
 * Toggle text prediction feature
 * @feature f02 - AI Text Prediction
 */
export function onToggleTextPrediction(data, sendResponse) {
  if (typeof data?.enabled !== 'boolean') {
    sendResponse({ success: false, error: 'Invalid data' });
    return;
  }
  
  // If enabling text prediction, check if text analysis is enabled
  if (data.enabled) {
    const { notifyTextAnalysis } = getState();
    if (!notifyTextAnalysis) {
      console.info('🌸 Cannot enable text prediction while text analysis is disabled');
      sendResponse({ success: false, error: 'Text analysis is disabled' });
      return;
    }
  }
  
  updateState({ textPredictionEnabled: data.enabled })
    .then(() => {
      console.info(`🌸 Text prediction ${data.enabled ? 'enabled' : 'disabled'}`);
      sendResponse({ success: true });
    })
    .catch(error => {
      console.error('🌸 Error toggling text prediction:', error);
      sendResponse({ success: false, error: error.message });
    });
}

/**
 * Get API key for specified provider
 */
export async function getApiKey(provider) {
  if (!provider || provider !== 'gemini') {
    console.warn('🌸🌸🌸 Only Gemini API is supported');
    return null;
  }

  try {
    const { geminiKey } = getState();

    if (!geminiKey) {
      console.warn('🌸🌸🌸 No Gemini API key found');
      return null;
    }

    // Stored as plain text
    return geminiKey;
  } catch (error) {
    console.error('🌸 Error getting Gemini API key:', error);
    return null;
  }
}

/**
 * Helper function for safe message sending to tabs
 */
async function sendMessageToTabSafely(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      // Expected during page unload or extension update
      return null;
    }
    console.warn('🌸🌸🌸 Failed to send message to tab:', error);
    return null;
  }
}
