const DEFAULT_SETTINGS = {
  enabled: false,
  pollInterval: 500,
  clickDelay: 250,
  soundEnabled: true,
  notifyEnabled: true,
  autoCloseTabs: false,
  closeTabDelay: 1000,
  autoSwitchTab: false,
  availableTabKeywords: 'Available tasks, Open tasks',
  taskCardKeywords: '.task-card, .task-item, .task-row, [data-testid*="task"], [class*="task-card"], [class*="task-item"], [class*="project-card"]',
  autoReload: false,
  reloadInterval: 60,
  buttonKeywords: 'Claim, Claim Task, Accept, Reserve',
  customSelectors: '',
  claimedCount: 0,
  scansCount: 0,
  logs: []
};

document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const ids = [
    'enableToggle','statusBadge','statusText','switchDesc','pollInterval','pollVal',
    'clickDelay','delayVal','soundToggle','notifyToggle','autoCloseTabsToggle',
    'closeTabDelayGroup','closeTabDelay','closeTabVal','autoSwitchTabToggle',
    'availableTabKeywords','taskCardKeywords','autoReloadToggle','reloadSecGroup',
    'reloadInterval','reloadVal','buttonKeywords','customSelectors','resetSelectorsBtn',
    'statClaimed','statScans','logsContainer','testAudioBtn','resetStatsBtn','clearLogsBtn'
  ];
  const el = Object.fromEntries(ids.map(id => [id, $(id)]));
  const tabBtns = [...document.querySelectorAll('.tab-btn')];
  const tabContents = [...document.querySelectorAll('.tab-content')];

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  updateUI({ ...DEFAULT_SETTINGS, ...settings });

  el.enableToggle.addEventListener('change', async () => {
    const enabled = el.enableToggle.checked;
    await saveSetting('enabled', enabled);
    updateStatusBadge(enabled);
    await addLog(enabled ? 'Detection enabled.' : 'Detection disabled.', enabled ? 'system' : 'warn');
    await notifyContentScripts({ type: 'STATE_CHANGED', enabled });
  });

  bindRange('pollInterval', 'pollVal', 'pollInterval', ' ms', true);
  bindRange('clickDelay', 'delayVal', 'clickDelay', ' ms', true);
  bindRange('closeTabDelay', 'closeTabVal', 'closeTabDelay', ' ms', true);
  bindRange('reloadInterval', 'reloadVal', 'reloadInterval', ' sec', true);

  bindToggle('soundToggle', 'soundEnabled');
  bindToggle('notifyToggle', 'notifyEnabled');
  bindToggle('autoSwitchTabToggle', 'autoSwitchTab');
  bindToggle('autoReloadToggle', 'autoReload', () => {
    el.reloadSecGroup.classList.toggle('hidden', !el.autoReloadToggle.checked);
  });
  bindToggle('autoCloseTabsToggle', 'autoCloseTabs', () => {
    el.closeTabDelayGroup.classList.toggle('hidden', !el.autoCloseTabsToggle.checked);
  });

  bindText('buttonKeywords', 'buttonKeywords');
  bindText('customSelectors', 'customSelectors');
  bindText('availableTabKeywords', 'availableTabKeywords');
  bindText('taskCardKeywords', 'taskCardKeywords');

  el.resetSelectorsBtn.addEventListener('click', async () => {
    for (const key of ['buttonKeywords','customSelectors','availableTabKeywords','taskCardKeywords']) {
      const value = DEFAULT_SETTINGS[key];
      const inputId = key;
      el[inputId].value = value;
      await saveSetting(key, value);
    }
    await addLog('Reset selectors to safe defaults.', 'system');
    await notifyContentScripts({ type: 'SETTINGS_UPDATED' });
  });

  tabBtns.forEach(btn => btn.addEventListener('click', () => {
    tabBtns.forEach(item => item.classList.toggle('active', item === btn));
    tabContents.forEach(item => item.classList.toggle('active', item.id === 'tab-' + btn.dataset.tab));
  }));

  el.testAudioBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PLAY_ALERT' }).catch(() => {});
    addLog('Requested test audio alert.', 'system');
  });
  el.resetStatsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ claimedCount: 0, scansCount: 0 });
    el.statClaimed.textContent = '0';
    el.statScans.textContent = '0';
    await addLog('Statistics reset.', 'system');
  });
  el.clearLogsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ logs: [] });
    renderLogs([]);
  });

  chrome.storage.onChanged.addListener(changes => {
    if (changes.claimedCount) el.statClaimed.textContent = changes.claimedCount.newValue || 0;
    if (changes.scansCount) el.statScans.textContent = changes.scansCount.newValue || 0;
    if (changes.logs) renderLogs(changes.logs.newValue || []);
    if (changes.enabled) {
      el.enableToggle.checked = Boolean(changes.enabled.newValue);
      updateStatusBadge(Boolean(changes.enabled.newValue));
    }
  });

  function bindRange(id, valueId, key, suffix, notify) {
    const input = el[id];
    input.addEventListener('input', () => { el[valueId].textContent = input.value + suffix; });
    input.addEventListener('change', async () => {
      await saveSetting(key, Number(input.value));
      if (notify) await notifyContentScripts({ type: 'SETTINGS_UPDATED' });
    });
  }
  function bindToggle(id, key, afterChange) {
    el[id].addEventListener('change', async () => {
      await saveSetting(key, el[id].checked);
      afterChange?.();
      await notifyContentScripts({ type: 'SETTINGS_UPDATED' });
    });
  }
  function bindText(id, key) {
    el[id].addEventListener('change', async () => {
      await saveSetting(key, el[id].value.trim());
      await notifyContentScripts({ type: 'SETTINGS_UPDATED' });
    });
  }
  async function saveSetting(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }
  async function notifyContentScripts(message) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await Promise.all(tabs.filter(tab => tab.id && /^https?:/.test(tab.url || '')).map(tab =>
        chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      ));
    } catch (error) {
      console.warn('Could not notify active tab:', error);
    }
  }
  function updateUI(s) {
    el.enableToggle.checked = Boolean(s.enabled);
    updateStatusBadge(Boolean(s.enabled));
    for (const [id, key, suffix] of [
      ['pollInterval','pollInterval',' ms'], ['clickDelay','clickDelay',' ms'],
      ['closeTabDelay','closeTabDelay',' ms'], ['reloadInterval','reloadInterval',' sec']
    ]) {
      el[id].value = s[key];
      el[id.replace(/Interval|Delay/, '') + 'Val'] && (el[id.replace(/Interval|Delay/, '') + 'Val'].textContent = s[key] + suffix);
    }
    el.pollVal.textContent = s.pollInterval + ' ms';
    el.delayVal.textContent = s.clickDelay + ' ms';
    el.closeTabVal.textContent = s.closeTabDelay + ' ms';
    el.reloadVal.textContent = s.reloadInterval + ' sec';
    el.soundToggle.checked = s.soundEnabled !== false;
    el.notifyToggle.checked = s.notifyEnabled !== false;
    el.autoCloseTabsToggle.checked = Boolean(s.autoCloseTabs);
    el.closeTabDelayGroup.classList.toggle('hidden', !s.autoCloseTabs);
    el.autoSwitchTabToggle.checked = Boolean(s.autoSwitchTab);
    el.autoReloadToggle.checked = Boolean(s.autoReload);
    el.reloadSecGroup.classList.toggle('hidden', !s.autoReload);
    el.buttonKeywords.value = s.buttonKeywords || DEFAULT_SETTINGS.buttonKeywords;
    el.customSelectors.value = s.customSelectors || '';
    el.availableTabKeywords.value = s.availableTabKeywords || DEFAULT_SETTINGS.availableTabKeywords;
    el.taskCardKeywords.value = s.taskCardKeywords || DEFAULT_SETTINGS.taskCardKeywords;
    el.statClaimed.textContent = s.claimedCount || 0;
    el.statScans.textContent = s.scansCount || 0;
    renderLogs(s.logs || []);
  }
  function updateStatusBadge(enabled) {
    el.statusBadge.classList.toggle('active', enabled);
    el.statusText.textContent = enabled ? 'RUNNING' : 'STOPPED';
    el.switchDesc.textContent = enabled ? 'Monitoring the current page' : 'Detection is off';
  }
  function renderLogs(logs) {
    el.logsContainer.replaceChildren();
    for (const item of logs) {
      const row = document.createElement('div');
      row.className = 'log-entry ' + String(item.type || 'system').replace(/[^a-z-]/gi, '');
      row.textContent = '[' + String(item.time || '') + '] ' + String(item.msg || '');
      el.logsContainer.appendChild(row);
    }
    el.logsContainer.scrollTop = el.logsContainer.scrollHeight;
  }
  async function addLog(msg, type = 'system') {
    const { logs = [] } = await chrome.storage.local.get({ logs: [] });
    logs.push({ time: new Date().toLocaleTimeString(), msg, type });
    await chrome.storage.local.set({ logs: logs.slice(-50) });
  }
});