'use strict';

chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    enabled: false,
    autoCloseTabs: false,
    closeTabDelay: 1000,
    pollInterval: 500,
    clickDelay: 250,
    soundEnabled: true,
    notifyEnabled: true
  };
  const existing = await chrome.storage.local.get(defaults);
  await chrome.storage.local.set({ ...defaults, ...existing, enabled: false, autoCloseTabs: false });
  updateBadge(false);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) updateBadge(Boolean(changes.enabled.newValue));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'TASK_CLAIMED') {
    handleTaskClaimed(message).then(() => sendResponse({ ok: true }))
      .catch(error => {
        console.error('[Auto-Claimer] Claim notification failed:', error);
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
    return true;
  }
  if (message.type === 'PLAY_ALERT') {
    playAudioAlert().then(() => sendResponse({ ok: true }))
      .catch(error => {
        console.warn('[Auto-Claimer] Audio alert unavailable:', error);
        sendResponse({ ok: false });
      });
    return true;
  }
});

async function handleTaskClaimed(data) {
  // This message is sent only after the content script detects a page success indicator.
  const { claimedCount = 0 } = await chrome.storage.local.get({ claimedCount: 0 });
  await chrome.storage.local.set({ claimedCount: claimedCount + 1 });
  if (data.soundEnabled !== false) await playAudioAlert();
  if (data.notifyEnabled !== false) {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.svg'),
      title: 'Possible task claim confirmation',
      message: 'The page showed a success indicator for: ' + String(data.buttonText || 'Handshake task').slice(0, 100),
      priority: 1
    }).catch(error => console.warn('[Auto-Claimer] Notification unavailable:', error));
  }
}

async function playAudioAlert() {
  const url = chrome.runtime.getURL('offscreen.html');
  const hasDocument = await chrome.offscreen.hasDocument().catch(() => false);
  if (!hasDocument) {
    await chrome.offscreen.createDocument({
      url,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play an optional notification sound after a task status change.'
    });
  }
  const response = await chrome.runtime.sendMessage({ type: 'PLAY_AUDIO_CHIME' });
  if (!response?.ok) throw new Error('Offscreen audio player did not confirm playback.');
}

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : 'OFF' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#10b981' : '#64748b' }).catch(() => {});
}