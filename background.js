// Background Service Worker (Manifest V3)

let lastClaimTimestamp = 0;
let lastClaimTabId = null;
const activeHandshakeTabIds = new Set();
const pendingTabsToClose = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['enabled', 'autoCloseTabs', 'closeTabDelay'], (res) => {
    if (res.enabled === undefined) {
      chrome.storage.local.set({ 
        enabled: false,
        autoCloseTabs: true,
        closeTabDelay: 200
      });
    }
    updateBadge(!!res.enabled);
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    updateBadge(changes.enabled.newValue);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender && sender.tab) {
    activeHandshakeTabIds.add(sender.tab.id);
  }

  if (msg.type === 'PRE_CLAIM') {
    if (sender && sender.tab) {
      lastClaimTabId = sender.tab.id;
    }
    lastClaimTimestamp = Date.now();
  } else if (msg.type === 'TASK_CLAIMED') {
    if (sender && sender.tab) {
      lastClaimTabId = sender.tab.id;
    }
    lastClaimTimestamp = Date.now();
    handleTaskClaimed(msg);
  } else if (msg.type === 'PLAY_ALERT') {
    playAudioAlert();
  }
});

// Remove closed tabs from active Handshake tab tracker
chrome.tabs.onRemoved.addListener((tabId) => {
  activeHandshakeTabIds.delete(tabId);
  pendingTabsToClose.delete(tabId);
});

// 1. Monitor for newly created tabs (opened via target="_blank", window.open, or link clicks)
chrome.tabs.onCreated.addListener(async (newTab) => {
  const settings = await chrome.storage.local.get(['enabled', 'autoCloseTabs', 'closeTabDelay']);
  if (!settings.enabled || settings.autoCloseTabs === false) return;

  const now = Date.now();
  const timeSinceClaim = now - lastClaimTimestamp;
  const isHandshakeOpener = newTab.openerTabId && activeHandshakeTabIds.has(newTab.openerTabId);
  const isRecentClaim = timeSinceClaim < 10000; // Claimed within last 10 seconds

  if (isHandshakeOpener || isRecentClaim) {
    const delayMs = settings.closeTabDelay !== undefined ? settings.closeTabDelay : 200;
    pendingTabsToClose.add(newTab.id);

    logActivity(`Detected newly opened task tab #${newTab.id}. Scheduling auto-close in ${delayMs}ms...`, 'system');
    closeTabSafely(newTab.id, delayMs);
  }
});

// 2. Extra safety net: catch tabs during URL load update
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (pendingTabsToClose.has(tabId)) {
    const settings = await chrome.storage.local.get(['closeTabDelay']);
    const delayMs = settings.closeTabDelay !== undefined ? settings.closeTabDelay : 200;
    closeTabSafely(tabId, delayMs);
  }
});

// 3. Monitor newly created windows (for popup windows)
chrome.windows.onCreated.addListener(async (newWin) => {
  const settings = await chrome.storage.local.get(['enabled', 'autoCloseTabs', 'closeTabDelay']);
  if (!settings.enabled || settings.autoCloseTabs === false) return;

  const now = Date.now();
  const timeSinceClaim = now - lastClaimTimestamp;

  if (timeSinceClaim < 10000) {
    const delayMs = settings.closeTabDelay !== undefined ? settings.closeTabDelay : 200;
    
    logActivity(`Detected newly opened task window #${newWin.id}. Scheduling auto-close in ${delayMs}ms...`, 'system');

    setTimeout(() => {
      chrome.windows.remove(newWin.id, () => {
        logActivity(`Successfully closed task window #${newWin.id}!`, 'success');
      }).catch(() => {});
    }, delayMs);
  }
});

function closeTabSafely(tabId, delayMs) {
  setTimeout(() => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        // Tab might be initializing, retry after short interval
        setTimeout(() => {
          chrome.tabs.remove(tabId, () => {
            pendingTabsToClose.delete(tabId);
          }).catch(() => {});
        }, 150);
      } else {
        pendingTabsToClose.delete(tabId);
        logActivity(`Successfully closed task tab #${tabId}!`, 'success');
      }
    });
  }, delayMs);
}

async function handleTaskClaimed(data) {
  // 1. Update stats
  const res = await chrome.storage.local.get(['claimedCount']);
  const newCount = (res.claimedCount || 0) + 1;
  await chrome.storage.local.set({ claimedCount: newCount });

  // 2. Play Audio Alert if enabled
  if (data.soundEnabled !== false) {
    await playAudioAlert();
  }

  // 3. Desktop Notification if enabled
  if (data.notifyEnabled !== false) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="%2310b981"><path d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V10h2v2z"/></svg>',
      title: '⚡ Task Claimed Successfully!',
      message: `Automatically claimed: "${data.buttonText || 'Handshake Task'}"`,
      priority: 2
    });
  }
}

async function playAudioAlert() {
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: 'PLAY_AUDIO_CHIME' });
}

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play audio notification when task is claimed'
    });
  }
}

function updateBadge(enabled) {
  if (enabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
  }
}

function logActivity(msg, type = 'system') {
  const time = new Date().toLocaleTimeString();
  chrome.storage.local.get('logs', (data) => {
    const logs = data.logs || [];
    logs.push({ time, msg, type });
    if (logs.length > 50) logs.shift();
    chrome.storage.local.set({ logs });
  });
}
