(function() {
  'use strict';
  console.log('[AI-Trans] Content script loaded on:', location.href);

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT',
    'NOSCRIPT', 'SVG', 'MATH', 'IFRAME'
  ]);

  const TRANSLATED_CLASS = 'ai-translation-result';
  const WRAPPER_CLASS = 'ai-translation-wrapper';

  // Save selection anchor on mouseup/contextmenu so we have it after the menu closes
  let lastSelectionAnchor = null;

  document.addEventListener('mouseup', saveSelectionAnchor);
  document.addEventListener('contextmenu', saveSelectionAnchor);

  function saveSelectionAnchor() {
    const selection = window.getSelection();
    if (selection.rangeCount && selection.toString().trim()) {
      const range = selection.getRangeAt(0);
      let node = range.endContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
      }
      lastSelectionAnchor = node;
      console.log('[AI-Trans] Selection anchor saved:', node.tagName);
    }
  }

  function getPageLanguage() {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) return htmlLang.split('-')[0];
    const metaLang = document.querySelector('meta[http-equiv="content-language"]');
    if (metaLang) return metaLang.content.split('-')[0];
    return null;
  }

  function getTranslatableBlocks() {
    const blocks = [];
    const blockTags = new Set([
      'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION',
      'DT', 'DD', 'CAPTION'
    ]);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.classList.contains(TRANSLATED_CLASS)) return NodeFilter.FILTER_REJECT;
          if (node.classList.contains(WRAPPER_CLASS)) return NodeFilter.FILTER_REJECT;
          if (blockTags.has(node.tagName)) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.innerText?.trim();
      if (text && text.length > 1) {
        blocks.push({ element: node, text });
      }
    }
    return blocks;
  }

  function injectTranslation(element, translation) {
    const existing = element.nextElementSibling;
    if (existing && existing.classList.contains(TRANSLATED_CLASS)) {
      existing.querySelector('.ai-translation-text').textContent = translation;
      return;
    }
    const translatedEl = document.createElement('div');
    translatedEl.className = TRANSLATED_CLASS;

    const textSpan = document.createElement('span');
    textSpan.className = 'ai-translation-text';
    textSpan.textContent = translation;

    const closeBtn = document.createElement('span');
    closeBtn.className = 'ai-translation-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = '删除译文';
    closeBtn.addEventListener('click', () => translatedEl.remove());

    translatedEl.appendChild(textSpan);
    translatedEl.appendChild(closeBtn);
    element.after(translatedEl);
  }

  function showSelectionTranslation(translation) {
    const anchor = lastSelectionAnchor;
    if (!anchor) {
      console.warn('[AI-Trans] No saved selection anchor');
      // Fallback: append to body
      const fallback = document.createElement('div');
      fallback.className = 'ai-translation-tooltip ai-translation-tooltip-visible';
      fallback.style.position = 'fixed';
      fallback.style.bottom = '20px';
      fallback.style.right = '20px';
      fallback.style.zIndex = '999999';

      const textSpan = document.createElement('span');
      textSpan.textContent = translation;
      const closeBtn = document.createElement('span');
      closeBtn.className = 'ai-translation-close';
      closeBtn.textContent = '\u00d7';
      closeBtn.title = '删除译文';
      closeBtn.addEventListener('click', () => fallback.remove());

      fallback.appendChild(textSpan);
      fallback.appendChild(closeBtn);
      document.body.appendChild(fallback);
      console.log('[AI-Trans] Fallback tooltip shown');
      return;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'ai-translation-tooltip';

    const textSpan = document.createElement('span');
    textSpan.textContent = translation;

    const closeBtn = document.createElement('span');
    closeBtn.className = 'ai-translation-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = '删除译文';
    closeBtn.addEventListener('click', () => tooltip.remove());

    tooltip.appendChild(textSpan);
    tooltip.appendChild(closeBtn);

    // Insert after the anchor element
    if (anchor.parentNode) {
      anchor.parentNode.insertBefore(tooltip, anchor.nextSibling);
    } else {
      document.body.appendChild(tooltip);
    }

    setTimeout(() => {
      tooltip.classList.add('ai-translation-tooltip-visible');
    }, 10);

    console.log('[AI-Trans] Selection translation shown after:', anchor.tagName);
    lastSelectionAnchor = null;
  }

  function showError(message) {
    console.error('[AI-Trans] Error displayed to user:', message);
    const toast = document.createElement('div');
    toast.className = 'ai-translation-toast ai-translation-toast-error';
    toast.textContent = `翻译失败: ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('ai-translation-toast-visible');
    }, 10);
    setTimeout(() => {
      toast.remove();
    }, 5000);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[AI-Trans] Content received message:', message.action);

    if (message.action === 'showSelectionTranslation') {
      showSelectionTranslation(message.translation);
      sendResponse({ success: true });
    }

    if (message.action === 'showError') {
      showError(message.error);
      sendResponse({ success: true });
    }

    if (message.action === 'getPageSegments') {
      const blocks = getTranslatableBlocks();
      const segments = blocks.map(b => b.text);
      console.log('[AI-Trans] Page segments:', segments.length);
      sendResponse({ segments, pageLang: getPageLanguage() });
    }

    if (message.action === 'applyTranslations') {
      const blocks = getTranslatableBlocks();
      console.log('[AI-Trans] Applying translations:', message.translations.length, 'to', blocks.length, 'blocks');
      message.translations.forEach((t, i) => {
        if (blocks[i]) {
          injectTranslation(blocks[i].element, t);
        }
      });
      sendResponse({ success: true });
    }

    if (message.action === 'clearTranslations') {
      document.querySelectorAll('.ai-translation-result, .ai-translation-tooltip').forEach(el => el.remove());
      console.log('[AI-Trans] All translations cleared');
      sendResponse({ success: true });
    }

    return true;
  });
})();
