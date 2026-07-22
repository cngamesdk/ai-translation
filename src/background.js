// === Crypto utilities ===
const SALT = new TextEncoder().encode('ai-translation-ext-v1');

async function getEncryptionKey() {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(chrome.runtime.id),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decrypt(base64Data) {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

// === API utilities ===
async function callApi(text, systemPrompt, config) {
  if (config.apiFormat === 'anthropic') {
    return callAnthropic(text, systemPrompt, config);
  }
  return callOpenAI(text, systemPrompt, config);
}

async function callAnthropic(text, systemPrompt, config) {
  const { apiUrl, apiKey, model } = config;
  const url = apiUrl.replace(/\/$/, '') + '/v1/messages';
  console.log('[AI-Trans] Calling Anthropic API:', url, 'model:', model);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[AI-Trans] Anthropic API error:', response.status, err);
    throw new Error(`API ${response.status}: ${err}`);
  }

  const data = await response.json();
  console.log('[AI-Trans] Anthropic response received');

  // Handle extended thinking: find the first text block
  const textBlock = data.content.find(block => block.type === 'text');
  if (!textBlock) {
    console.error('[AI-Trans] No text content in response:', data.content);
    throw new Error('API returned no text content');
  }

  return textBlock.text.trim();
}

async function callOpenAI(text, systemPrompt, config) {
  const { apiUrl, apiKey, model } = config;
  const url = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
  console.log('[AI-Trans] Calling OpenAI API:', url, 'model:', model);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[AI-Trans] OpenAI API error:', response.status, err);
    throw new Error(`API ${response.status}: ${err}`);
  }

  const data = await response.json();
  console.log('[AI-Trans] OpenAI response received');
  return data.choices[0].message.content.trim();
}

async function translate(text, targetLang, config) {
  const systemPrompt = `You are a professional translator. Translate the following text to ${targetLang}. Only output the translation, no explanations or extra text. Preserve the original formatting.`;
  return callApi(text, systemPrompt, config);
}

async function translateBatch(segments, targetLang, config) {
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const joined = batch.map((s, idx) => `[${idx}] ${s}`).join('\n\n');
    console.log(`[AI-Trans] Batch ${i / batchSize + 1}, segments: ${batch.length}`);

    const systemPrompt = `You are a professional translator. Translate each numbered segment to ${targetLang}. Keep the [number] prefix for each segment. Only output translations, no explanations.`;
    const content = await callApi(joined, systemPrompt, config);
    const parsed = content.split(/\[\d+\]\s*/).filter(Boolean);
    results.push(...parsed);
  }

  return results;
}

// === Extension logic ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '用沐风翻译选中内容',
    contexts: ['selection']
  });
  console.log('[AI-Trans] Context menu created');
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-selection') {
    console.log('[AI-Trans] Context menu clicked, text:', info.selectionText?.substring(0, 50));

    const config = await getConfig();
    if (!config) {
      console.warn('[AI-Trans] No config found, opening settings');
      chrome.windows.create({
        url: chrome.runtime.getURL('popup/popup.html'),
        type: 'popup',
        width: 360,
        height: 480
      });
      return;
    }

    console.log('[AI-Trans] Config loaded, apiUrl:', config.apiUrl);
    const targetLang = await getTargetLanguage();
    console.log('[AI-Trans] Target language:', targetLang);

    try {
      const translated = await translate(info.selectionText, targetLang, config);
      console.log('[AI-Trans] Translation done, sending to tab:', tab.id);
      chrome.tabs.sendMessage(tab.id, {
        action: 'showSelectionTranslation',
        translation: translated
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[AI-Trans] sendMessage failed:', chrome.runtime.lastError.message);
          // Fallback: inject result directly into the page
          injectTranslationDirectly(tab.id, translated);
        } else {
          console.log('[AI-Trans] Message delivered successfully');
        }
      });
    } catch (err) {
      console.error('[AI-Trans] Translation error:', err);
      chrome.tabs.sendMessage(tab.id, {
        action: 'showError',
        error: err.message
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('[AI-Trans] Cannot send error to page:', chrome.runtime.lastError.message);
        }
      });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AI-Trans] Message received:', message.action);

  if (message.action === 'translatePage') {
    handleTranslatePage(sender.tab?.id || message.tabId, message.segments)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[AI-Trans] translatePage error:', err);
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (message.action === 'getConfig') {
    getConfig().then(config => sendResponse(config)).catch(() => sendResponse(null));
    return true;
  }

  if (message.action === 'getTargetLanguage') {
    getTargetLanguage().then(lang => sendResponse(lang));
    return true;
  }
});

async function handleTranslatePage(tabId, segments) {
  const config = await getConfig();
  if (!config) throw new Error('请先配置 API');

  const targetLang = await getTargetLanguage();
  console.log(`[AI-Trans] Translating page, ${segments.length} segments, target: ${targetLang}`);
  const translations = await translateBatch(segments, targetLang, config);

  chrome.tabs.sendMessage(tabId, {
    action: 'applyTranslations',
    translations
  });
}

async function getConfig() {
  const data = await chrome.storage.local.get(['apiUrl', 'apiFormat', 'encryptedKey', 'model']);
  if (!data.apiUrl || !data.encryptedKey || !data.model) {
    console.log('[AI-Trans] Config incomplete:', { hasUrl: !!data.apiUrl, hasKey: !!data.encryptedKey, hasModel: !!data.model });
    return null;
  }

  try {
    const apiKey = await decrypt(data.encryptedKey);
    return { apiUrl: data.apiUrl, apiFormat: data.apiFormat || 'openai', apiKey, model: data.model };
  } catch (err) {
    console.error('[AI-Trans] Decrypt failed:', err);
    return null;
  }
}

async function getTargetLanguage() {
  const data = await chrome.storage.local.get(['targetLang']);
  return data.targetLang || navigator.language || 'zh-CN';
}

function injectTranslationDirectly(tabId, translation) {
  chrome.scripting.insertCSS({
    target: { tabId },
    css: `.ai-trans-injected{position:fixed;bottom:20px;right:20px;z-index:999999;max-width:400px;padding:12px 32px 12px 14px;background:#1a1a2e;color:#eee;border-radius:8px;font-size:14px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.3);}.ai-trans-injected-close{position:absolute;top:4px;right:8px;cursor:pointer;font-size:16px;color:#aaa;}.ai-trans-injected-close:hover{color:#fff;}`
  });
  chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const el = document.createElement('div');
      el.className = 'ai-trans-injected';
      el.textContent = text;
      const btn = document.createElement('span');
      btn.className = 'ai-trans-injected-close';
      btn.textContent = '\u00d7';
      btn.onclick = () => el.remove();
      el.appendChild(btn);
      document.body.appendChild(el);
    },
    args: [translation]
  });
}
