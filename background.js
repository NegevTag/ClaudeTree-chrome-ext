// Service worker: toggle the tree panel when the toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || !tab.url.startsWith("https://claude.ai/")) {
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
});
