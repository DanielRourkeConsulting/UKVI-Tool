'use strict';
// Opens the helper in the browser's side panel when you click the toolbar icon (or press Alt+Shift+U).
// Where a browser has no side panel API, falls back to a small pinned window.
// No content scripts run by themselves, and nothing here touches the network.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} else {
  let winId = null;
  chrome.action.onClicked.addListener(async () => {
    if (winId !== null) { try { await chrome.windows.update(winId, { focused: true }); return; } catch (e) { winId = null; } }
    const w = await chrome.windows.create({ url: 'sidepanel.html', type: 'popup', width: 420, height: 760 });
    winId = w.id;
  });
  chrome.windows.onRemoved.addListener((id) => { if (id === winId) winId = null; });
}
