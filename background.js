'use strict';
// The panel is only injected when YOU click the toolbar icon (or press Alt+Shift+U).
// No host permissions, no content scripts that run by themselves, no network calls.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib.js', 'content.js'] });
  } catch (e) {
    // Browser pages (edge://, the web store, PDFs) can't be scripted.
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b00020' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 3000);
  }
});

// The panel's settings button asks us to open the options page (content scripts can't do it themselves).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id === chrome.runtime.id && msg && msg.type === 'options') chrome.runtime.openOptionsPage();
});
