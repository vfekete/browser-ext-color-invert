const GLOBAL_SCOPE_KEY = '__dark_mode_global_scope__';
const GLOBAL_DARK_KEY = '__dark_mode_global__';
const tabModes = new Map();
const action = chrome.browserAction;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function tabsQuery(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
}

function tabsGet(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const err = chrome.runtime.lastError;
      err ? reject(err) : resolve(tab);
    });
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      err ? reject(err) : resolve(response);
    });
  });
}

function tabsExecuteScript(tabId, details) {
  return new Promise((resolve, reject) => {
    chrome.tabs.executeScript(tabId, details, (result) => {
      const err = chrome.runtime.lastError;
      err ? reject(err) : resolve(result);
    });
  });
}

function setActionIcon(tabId, isDark) {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  ctx.clearRect(0, 0, size, size);

  if (isDark) {
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8d5a3';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(cx + 5, cy - 3, r - 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#e0e0e0';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI * 2) / 8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * 10, cy + Math.sin(angle) * 10);
      ctx.lineTo(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14);
      ctx.stroke();
    }
  }

  const iconOpts = { imageData: ctx.getImageData(0, 0, size, size) };
  if (tabId !== undefined) iconOpts.tabId = tabId;
  action.setIcon(iconOpts);
}

function setIcon(tabId, isDark) {
  const title = isDark
    ? 'Dark Mode ON - click to disable'
    : 'Dark Mode OFF - click to enable';
  if (tabId !== undefined) {
    setActionIcon(tabId, isDark);
    action.setTitle({ tabId, title });
  } else {
    setActionIcon(undefined, isDark);
    action.setTitle({ title });
  }
}

function pageKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

async function getStateForUrl(url) {
  const key = pageKey(url);
  const keys = key ? [GLOBAL_SCOPE_KEY, GLOBAL_DARK_KEY, key] : [GLOBAL_SCOPE_KEY, GLOBAL_DARK_KEY];
  const stored = await storageGet(keys);
  const isGlobalScope = !!stored[GLOBAL_SCOPE_KEY];
  const isGlobalDark = !!stored[GLOBAL_DARK_KEY];
  const isPageDark = key ? !!stored[key] : false;

  return {
    key,
    isGlobalScope,
    isGlobalDark,
    isPageDark,
    isDark: isGlobalScope ? isGlobalDark : isPageDark
  };
}

async function sendModeToTab(tabId, isDark) {
  try {
    await tabsSendMessage(tabId, { type: 'SET_MODE', isDark });
  } catch {
    try {
      await tabsExecuteScript(tabId, { file: 'content.js' });
      await tabsSendMessage(tabId, { type: 'SET_MODE', isDark });
    } catch {
      // Pages such as about: URLs cannot receive content scripts.
    }
  }
}

async function updateIconForTab(tab) {
  if (!tab?.id || !tab.url || !pageKey(tab.url)) return;

  const state = await getStateForUrl(tab.url);
  tabModes.set(tab.id, state.isDark);
  setIcon(tab.id, state.isDark);
}

async function applyStateToTab(tab) {
  if (!tab?.id || !tab.url || !pageKey(tab.url)) return;

  const state = await getStateForUrl(tab.url);
  tabModes.set(tab.id, state.isDark);
  setIcon(tab.id, state.isDark);
  await sendModeToTab(tab.id, state.isDark);
}

async function applyStateToAllTabs() {
  const tabs = await tabsQuery({});
  await Promise.all(tabs.map(applyStateToTab));
}

async function setGlobalScope(isGlobalScope) {
  await storageSet({ [GLOBAL_SCOPE_KEY]: isGlobalScope });
  await applyStateToAllTabs();
}

async function toggleForTab(tab) {
  if (!tab?.id || !tab.url) return;

  const state = await getStateForUrl(tab.url);
  if (state.isGlobalScope) {
    await storageSet({ [GLOBAL_DARK_KEY]: !state.isGlobalDark });
    await applyStateToAllTabs();
    return;
  }

  if (!state.key) return;
  await storageSet({ [state.key]: !state.isPageDark });
  await applyStateToTab(tab);
}

setIcon(undefined, false);
action.onClicked.addListener(toggleForTab);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    getStateForUrl(msg.url).then(sendResponse);
    return true;
  }

  if (msg.type === 'SET_GLOBAL_SCOPE') {
    setGlobalScope(!!msg.isGlobalScope).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'PAGE_MODE' && sender.tab?.id !== undefined) {
    tabModes.set(sender.tab.id, msg.isDark);
    setIcon(sender.tab.id, msg.isDark);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await tabsGet(tabId);
    await updateIconForTab(tab);
  } catch {
    const isDark = tabModes.get(tabId);
    setIcon(tabId, isDark !== undefined ? isDark : false);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    applyStateToTab(tab);
  } else if (changeInfo.url) {
    updateIconForTab({ ...tab, id: tabId, url: changeInfo.url });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabModes.delete(tabId);
});
