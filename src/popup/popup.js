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

async function encrypt(plaintext) {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(base64Data) {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = `status ${type}`;
  if (type === 'success') {
    setTimeout(() => { el.className = 'status'; }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const apiUrlEl = document.getElementById('apiUrl');
  const apiFormatEl = document.getElementById('apiFormat');
  const apiKeyEl = document.getElementById('apiKey');
  const modelEl = document.getElementById('model');
  const targetLangEl = document.getElementById('targetLang');
  const toggleKeyEl = document.getElementById('toggleKey');
  const saveBtnEl = document.getElementById('saveBtn');
  const translateBtnEl = document.getElementById('translatePageBtn');
  const clearBtnEl = document.getElementById('clearBtn');

  // Load saved settings
  const data = await chrome.storage.local.get(['apiUrl', 'apiFormat', 'encryptedKey', 'model', 'targetLang']);
  if (data.apiUrl) apiUrlEl.value = data.apiUrl;
  if (data.apiFormat) apiFormatEl.value = data.apiFormat;
  if (data.model) modelEl.value = data.model;
  if (data.targetLang) targetLangEl.value = data.targetLang;
  if (data.encryptedKey) {
    try {
      const decrypted = await decrypt(data.encryptedKey);
      apiKeyEl.value = decrypted;
    } catch {
      apiKeyEl.value = '';
    }
  }

  // Toggle key visibility
  toggleKeyEl.addEventListener('click', () => {
    apiKeyEl.type = apiKeyEl.type === 'password' ? 'text' : 'password';
  });

  // Save settings
  saveBtnEl.addEventListener('click', async () => {
    const apiUrl = apiUrlEl.value.trim();
    const apiFormat = apiFormatEl.value;
    const apiKey = apiKeyEl.value.trim();
    const model = modelEl.value.trim();
    const targetLang = targetLangEl.value;

    if (!apiUrl || !apiKey || !model) {
      showStatus('请填写所有必填项', 'error');
      return;
    }

    try {
      const encryptedKey = await encrypt(apiKey);
      await chrome.storage.local.set({ apiUrl, apiFormat, encryptedKey, model, targetLang });
      showStatus('设置已保存', 'success');
    } catch (err) {
      showStatus(`保存失败: ${err.message}`, 'error');
    }
  });

  // Translate page
  translateBtnEl.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    showStatus('正在翻译...', 'info');

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageSegments' });
      if (!response || !response.segments.length) {
        showStatus('未找到可翻译内容', 'error');
        return;
      }

      await chrome.runtime.sendMessage({
        action: 'translatePage',
        segments: response.segments,
        tabId: tab.id
      });
      showStatus('翻译完成', 'success');
    } catch (err) {
      showStatus(`翻译失败: ${err.message}`, 'error');
    }
  });

  // Clear all translations
  clearBtnEl.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'clearTranslations' });
      showStatus('已清除所有译文', 'success');
    } catch (err) {
      showStatus(`清除失败: ${err.message}`, 'error');
    }
  });
});
