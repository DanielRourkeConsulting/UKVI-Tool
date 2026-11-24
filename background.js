'use strict';
// The panel is only injected when YOU click the toolbar icon (or press Alt+Shift+U).
// No host permissions, no content scripts that run by themselves, no network calls.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  chrome.action.setBadgeText({ tabId: tab.id, text: '' });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib.js', 'content.js'] });
  } catch (e) {
    // Browser pages (chrome://, edge://, the web store, PDFs, new tab) can't be scripted. Show why.
    const why = String((e && e.message) || e);
    console.error('UKVI Form Helper could not open on this page:', why);
    chrome.action.setTitle({ tabId: tab.id, title: 'UKVI Form Helper could not open here: ' + why });
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b00020' });
    chrome.storage.local.set({ lastError: { when: Date.now(), url: tab.url || '', why } });
  }
});

// The panel's settings button asks us to open the options page (content scripts can't do it themselves).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id === chrome.runtime.id && msg && msg.type === 'options') chrome.runtime.openOptionsPage();
});
