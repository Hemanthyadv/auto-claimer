const DEFAULT_SETTINGS = {
  enabled: false,
  pollInterval: 300,
  clickDelay: 0,
  soundEnabled: true,
  notifyEnabled: true,
  autoCloseTabs: true,
  closeTabDelay: 200,
  autoSwitchTab: true,
  availableTabKeywords: 'Available tasks, Available, Open tasks, All tasks',
  taskCardKeywords: '.task-card, .task-item, .task-row, [class*="task-card"], [class*="task-item"], [class*="project-card"], View, Open, Task',
  autoReload: false,
  reloadInterval: 30,
  buttonKeywords: 'Claim, Claim Task, Start, Start Task, Accept, Reserve, Take Task, Claim Now',
  customSelectors: '.claim-btn, button[data-action="claim"], button[data-testid*="claim"]',
  claimedCount: 0,
  scansCount: 0,
  logs: []
};

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();

  // Elements
  const enableToggle = document.getElementById('enableToggle');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const switchDesc = document.getElementById('switchDesc');
  
  const pollInterval = document.getElementById('pollInterval');
  const pollVal = document.getElementById('pollVal');
  const clickDelay = document.getElementById('clickDelay');
  const delayVal = document.getElementById('delayVal');

  const soundToggle = document.getElementById('soundToggle');
  const notifyToggle = document.getElementById('notifyToggle');
  const autoCloseTabsToggle = document.getElementById('autoCloseTabsToggle');
  const closeTabDelayGroup = document.getElementById('closeTabDelayGroup');
  const closeTabDelay = document.getElementById('closeTabDelay');
  const closeTabVal = document.getElementById('closeTabVal');

  const autoSwitchTabToggle = document.getElementById('autoSwitchTabToggle');
  const availableTabKeywords = document.getElementById('availableTabKeywords');
  const taskCardKeywords = document.getElementById('taskCardKeywords');

  const autoReloadToggle = document.getElementById('autoReloadToggle');
  const reloadSecGroup = document.getElementById('reloadSecGroup');
  const reloadInterval = document.getElementById('reloadInterval');
  const reloadVal = document.getElementById('reloadVal');

  const buttonKeywords = document.getElementById('buttonKeywords');
  const customSelectors = document.getElementById('customSelectors');
  const resetSelectorsBtn = document.getElementById('resetSelectorsBtn');

  const statClaimed = document.getElementById('statClaimed');
  const statScans = document.getElementById('statScans');
  const logsContainer = document.getElementById('logsContainer');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  const testAudioBtn = document.getElementById('testAudioBtn');
  const resetStatsBtn = document.getElementById('resetStatsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

  // Initialize UI State
  updateUI(settings);

  // Event Listeners - Master Toggle
  enableToggle.addEventListener('change', async () => {
    const isEnabled = enableToggle.checked;
    await chrome.storage.local.set({ enabled: isEnabled });
    updateStatusBadge(isEnabled);
    addLog(isEnabled ? 'Engine Started. Monitoring page...' : 'Engine Stopped.', isEnabled ? 'system' : 'warn');
    notifyContentScripts({ type: 'STATE_CHANGED', enabled: isEnabled });
  });

  // Range inputs
  pollInterval.addEventListener('input', () => {
    pollVal.textContent = `${pollInterval.value} ms`;
  });
  pollInterval.addEventListener('change', async () => {
    await saveSetting('pollInterval', parseInt(pollInterval.value));
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  clickDelay.addEventListener('input', () => {
    delayVal.textContent = `${clickDelay.value} ms`;
  });
  clickDelay.addEventListener('change', async () => {
    await saveSetting('clickDelay', parseInt(clickDelay.value));
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  closeTabDelay.addEventListener('input', () => {
    closeTabVal.textContent = `${closeTabDelay.value} ms`;
  });
  closeTabDelay.addEventListener('change', async () => {
    await saveSetting('closeTabDelay', parseInt(closeTabDelay.value));
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  reloadInterval.addEventListener('input', () => {
    reloadVal.textContent = `${reloadInterval.value} sec`;
  });
  reloadInterval.addEventListener('change', async () => {
    await saveSetting('reloadInterval', parseInt(reloadInterval.value));
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  // Toggles
  soundToggle.addEventListener('change', () => saveSetting('soundEnabled', soundToggle.checked));
  notifyToggle.addEventListener('change', () => saveSetting('notifyEnabled', notifyToggle.checked));
  autoCloseTabsToggle.addEventListener('change', () => {
    const checked = autoCloseTabsToggle.checked;
    closeTabDelayGroup.classList.toggle('hidden', !checked);
    saveSetting('autoCloseTabs', checked);
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  autoSwitchTabToggle.addEventListener('change', () => {
    saveSetting('autoSwitchTab', autoSwitchTabToggle.checked);
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  // Keywords & Selectors
  buttonKeywords.addEventListener('change', async () => {
    await saveSetting('buttonKeywords', buttonKeywords.value);
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  availableTabKeywords.addEventListener('change', async () => {
    await saveSetting('availableTabKeywords', availableTabKeywords.value);
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  taskCardKeywords.addEventListener('change', async () => {
    await saveSetting('taskCardKeywords', taskCardKeywords.value);
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  customSelectors.addEventListener('change', async () => {
    await saveSetting('customSelectors', customSelectors.value);
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  resetSelectorsBtn.addEventListener('click', async () => {
    buttonKeywords.value = DEFAULT_SETTINGS.buttonKeywords;
    availableTabKeywords.value = DEFAULT_SETTINGS.availableTabKeywords;
    taskCardKeywords.value = DEFAULT_SETTINGS.taskCardKeywords;
    customSelectors.value = DEFAULT_SETTINGS.customSelectors;
    await saveSetting('buttonKeywords', DEFAULT_SETTINGS.buttonKeywords);
    await saveSetting('availableTabKeywords', DEFAULT_SETTINGS.availableTabKeywords);
    await saveSetting('taskCardKeywords', DEFAULT_SETTINGS.taskCardKeywords);
    await saveSetting('customSelectors', DEFAULT_SETTINGS.customSelectors);
    addLog('Reset selectors to default.', 'system');
    notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  // Tabs
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Actions
  testAudioBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PLAY_ALERT' });
    addLog('Played test audio alert.', 'system');
  });

  resetStatsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ claimedCount: 0, scansCount: 0 });
    statClaimed.textContent = '0';
    statScans.textContent = '0';
    addLog('Statistics reset.', 'system');
  });

  clearLogsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ logs: [] });
    logsContainer.innerHTML = '<div class="log-entry system">Logs cleared.</div>';
  });

  // Storage listener for live updates
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.claimedCount) statClaimed.textContent = changes.claimedCount.newValue || 0;
    if (changes.scansCount) statScans.textContent = changes.scansCount.newValue || 0;
    if (changes.logs && changes.logs.newValue) renderLogs(changes.logs.newValue);
  });

  // Functions
  async function loadSettings() {
    const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
    return data;
  }

  async function saveSetting(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  function updateUI(s) {
    enableToggle.checked = s.enabled;
    updateStatusBadge(s.enabled);

    pollInterval.value = s.pollInterval;
    pollVal.textContent = `${s.pollInterval} ms`;

    clickDelay.value = s.clickDelay;
    delayVal.textContent = `${s.clickDelay} ms`;

    soundToggle.checked = s.soundEnabled;
    notifyToggle.checked = s.notifyEnabled;

    autoCloseTabsToggle.checked = s.autoCloseTabs;
    closeTabDelayGroup.classList.toggle('hidden', !s.autoCloseTabs);
    closeTabDelay.value = s.closeTabDelay;
    closeTabVal.textContent = `${s.closeTabDelay} ms`;

    autoSwitchTabToggle.checked = s.autoSwitchTab !== false;

    autoReloadToggle.checked = s.autoReload;
    reloadSecGroup.classList.toggle('hidden', !s.autoReload);
    reloadInterval.value = s.reloadInterval;
    reloadVal.textContent = `${s.reloadInterval} sec`;

    buttonKeywords.value = s.buttonKeywords;
    availableTabKeywords.value = s.availableTabKeywords || DEFAULT_SETTINGS.availableTabKeywords;
    taskCardKeywords.value = s.taskCardKeywords || DEFAULT_SETTINGS.taskCardKeywords;
    customSelectors.value = s.customSelectors;

    statClaimed.textContent = s.claimedCount || 0;
    statScans.textContent = s.scansCount || 0;

    renderLogs(s.logs || []);
  }

  function updateStatusBadge(enabled) {
    if (enabled) {
      statusBadge.classList.add('active');
      statusText.textContent = 'RUNNING';
      switchDesc.textContent = 'Scanning for tasks...';
    } else {
      statusBadge.classList.remove('active');
      statusText.textContent = 'STOPPED';
      switchDesc.textContent = 'Activate real-time task detection';
    }
  }

  function renderLogs(logs) {
    if (!logs || logs.length === 0) return;
    logsContainer.innerHTML = logs.map(l => `<div class="log-entry ${l.type}">[${l.time}] ${l.msg}</div>`).join('');
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  async function addLog(msg, type = 'system') {
    const data = await chrome.storage.local.get('logs');
    const logs = data.logs || [];
    const time = new Date().toLocaleTimeString();
    logs.push({ time, msg, type });
    if (logs.length > 50) logs.shift(); // Keep last 50
    await chrome.storage.local.set({ logs });
  }

  async function notifyContentScripts(msg) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  }
});
