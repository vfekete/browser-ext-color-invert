const globalScope = document.getElementById('globalScope');
const statusText = document.getElementById('status');
let activeTab = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render(state) {
  globalScope.checked = state.isGlobalScope;
  statusText.textContent = state.isGlobalScope
    ? 'Toolbar clicks now toggle the default state for every page.'
    : 'Toolbar clicks now toggle only the current page origin.';
}

async function loadState() {
  activeTab = await getActiveTab();
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE', url: activeTab?.url });
  render(state);
}

globalScope.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({
    type: 'SET_GLOBAL_SCOPE',
    isGlobalScope: globalScope.checked
  });
  await loadState();
});

loadState();
