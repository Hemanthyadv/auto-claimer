(() => {
  'use strict';

  const DEFAULTS = {
    enabled: false,
    pollInterval: 500,
    clickDelay: 250,
    soundEnabled: true,
    notifyEnabled: true,
    autoCloseTabs: false,
    autoSwitchTab: false,
    autoReload: false,
    reloadInterval: 60,
    buttonKeywords: 'Claim, Claim Task, Accept, Reserve, Start Task',
    customSelectors: '',
    availableTabKeywords: 'Available tasks, Open tasks',
    taskCardKeywords: '.task-card, .task-item, .task-row, [data-testid*="task"], [class*="task-card"], [class*="task-item"], [class*="project-card"]'
  };

  let config = { ...DEFAULTS };
  let observer = null;
  let pollTimer = null;
  let reloadTimer = null;
  let scanning = false;
  let claimInProgress = false;
  const clicked = new WeakSet();
  const pending = new WeakSet();
  let lastScanLog = 0;

  init();

  async function init() {
    await loadConfig();
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'STATE_CHANGED' || message?.type === 'SETTINGS_UPDATED') {
        loadConfig();
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.keys(changes).some(key => key in DEFAULTS)) loadConfig();
    });
  }

  async function loadConfig() {
    try {
      const stored = await chrome.storage.local.get(DEFAULTS);
      config = { ...DEFAULTS, ...stored };
      config.enabled = Boolean(config.enabled);
      config.pollInterval = clampNumber(config.pollInterval, 100, 2000, 500);
      config.clickDelay = clampNumber(config.clickDelay, 0, 3000, 250);
      config.reloadInterval = clampNumber(config.reloadInterval, 10, 180, 60);
      stopEngine();
      if (config.enabled) startEngine();
    } catch (error) {
      console.error('[Auto-Claimer] Unable to load settings:', error);
    }
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function startEngine() {
    if (scanning) return;
    scanning = true;
    observer = new MutationObserver(() => scanAndClaim());
    const root = document.documentElement;
    if (root) observer.observe(root, { childList: true, subtree: true });
    pollTimer = setInterval(scanAndClaim, config.pollInterval);
    resetReloadTimer();
    scanAndClaim();
    logActivity('Detection enabled. Review matches before relying on automatic actions.', 'system');
  }

  function stopEngine() {
    scanning = false;
    observer?.disconnect();
    observer = null;
    if (pollTimer) clearInterval(pollTimer);
    if (reloadTimer) clearTimeout(reloadTimer);
    pollTimer = null;
    reloadTimer = null;
  }

  function resetReloadTimer() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
    if (!config.enabled || !config.autoReload || !scanning) return;
    scheduleIdleReload(config.reloadInterval * 1000);
  }

  function scheduleIdleReload(delayMs) {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (!config.enabled || !config.autoReload || !scanning) return;

      const claimAvailable = findClaimButtons().some(button =>
        isVisible(button) && isClearlyClaimAction(button)
      );
      const busyElement = document.querySelector('button[aria-busy="true"], [role="button"][aria-busy="true"]');

      // Avoid refreshing a hidden tab, an available task page, or an in-progress claim.
      if (document.hidden || claimInProgress || claimAvailable || busyElement) {
        logActivity('Auto-refresh postponed because a task or claim may need attention; retrying in 10 seconds.', 'system');
        scheduleIdleReload(10_000);
        return;
      }

      logActivity('Auto-refresh timer reached; refreshing the idle page.', 'system');
      location.reload();
    }, delayMs);
  }

  async function scanAndClaim() {
    if (!config.enabled || !scanning || document.hidden) return;
    const buttons = findClaimButtons();
    if (!buttons.length) {
      if (Date.now() - lastScanLog > 30000) {
        lastScanLog = Date.now();
        logActivity('Scanning page; no clear claim button found.', 'system');
      }
      return;
    }

    for (const button of buttons) {
      if (!config.enabled || clicked.has(button) || pending.has(button)) continue;
      if (!isVisible(button) || !isClearlyClaimAction(button)) continue;

      // Never auto-click ambiguous labels such as "Start", "Open", or "View".
      pending.add(button);
      claimInProgress = true;
      const label = getLabel(button);
      logActivity('Candidate found: "' + label + '". Attempting one normal click.', 'system');

      if (config.clickDelay > 0) await new Promise(resolve => setTimeout(resolve, config.clickDelay));
      if (!config.enabled || !button.isConnected || !isVisible(button) || !isClearlyClaimAction(button)) {
        pending.delete(button);
        continue;
      }

      clicked.add(button);
      try {
        button.click();
        // A click is not proof of success. Do not increment the claimed counter here.
        logActivity('Click sent to "' + label + '". Waiting for the page to confirm the result.', 'system');
        await waitForClaimOutcome(button, label);
      } catch (error) {
        clicked.delete(button);
        logActivity('Click failed: ' + String(error?.message || error), 'error');
      } finally {
        pending.delete(button);
        claimInProgress = false;
      }
      break; // One action per scan; avoid rapid multiple claims.
    }
  }

  function findClaimButtons() {
    const candidates = new Set();
    const selectors = [
      'button', 'a[role="button"]', '[role="button"]',
      'input[type="button"]', 'input[type="submit"]'
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(element => {
        if (isVisible(element) && isClearlyClaimAction(element)) candidates.add(element);
      });
    }

    // Custom selectors are opt-in, but still must pass the same visible/label safety checks.
    for (const selector of String(config.customSelectors || '').split(',').map(s => s.trim()).filter(Boolean)) {
      try {
        document.querySelectorAll(selector).forEach(element => {
          if (isVisible(element) && isClearlyClaimAction(element)) candidates.add(element);
        });
      } catch (error) {
        console.warn('[Auto-Claimer] Ignoring invalid CSS selector:', selector, error);
      }
    }
    return [...candidates];
  }

  function getLabel(element) {
    return String(element.innerText || element.textContent || element.value || element.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function isClearlyClaimAction(element) {
    const label = getLabel(element).toLowerCase();
    if (!label || label.length > 100) return false;
    const blocked = /^(view|open|details|learn more|start|start now|continue|next|submit|cancel|close|back|refresh|search|filter)$/i;
    if (blocked.test(label)) return false;
    const keywords = String(config.buttonKeywords || DEFAULTS.buttonKeywords)
      .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    return keywords.some(keyword => {
      if (!keyword) return false;
      // Match a distinct claim/accept/reserve action, not arbitrary text containing "start".
      if (/^(start|open|view|task)$/.test(keyword)) return false;
      return label === keyword || label.includes(keyword);
    });
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  async function waitForClaimOutcome(button, label) {
    const start = Date.now();
    const initialUrl = location.href;
    const initialLabel = label.toLowerCase();
    while (Date.now() - start < 4000) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const successText = /task claimed|successfully claimed|claim successful|task accepted|you have claimed|already claimed/.test(bodyText);
      const failureText = /unable to claim|failed to claim|claim failed|no longer available|already taken|something went wrong/.test(bodyText);
      const changedToNonClaim = !button.isConnected || !isVisible(button) || !isClearlyClaimAction(button);
      if (failureText) {
        logActivity('The page appears to report a claim failure. Check the task status manually.', 'warn');
        return;
      }
      if (successText || (location.href !== initialUrl && /task|project|work/i.test(location.href))) {
        reportConfirmedClaim(label);
        return;
      }
      if (changedToNonClaim && Date.now() - start > 1000) {
        // A disappearing button alone is not sufficient evidence of success.
        logActivity('Claim button changed or disappeared; success is unconfirmed. Verify on the page.', 'warn');
        return;
      }
    }
    logActivity('No reliable success confirmation detected for "' + initialLabel + '". Check the page manually.', 'warn');
  }

  async function reportConfirmedClaim(label) {
    try {
      await chrome.runtime.sendMessage({
        type: 'TASK_CLAIMED',
        buttonText: label,
        soundEnabled: config.soundEnabled,
        notifyEnabled: config.notifyEnabled
      });
      logActivity('Page success indicator detected for "' + label + '".', 'success');
    } catch (error) {
      console.warn('[Auto-Claimer] Could not notify background worker:', error);
    }
  }

  function logActivity(message, type = 'system') {
    const time = new Date().toLocaleTimeString();
    console.log('[Auto-Claimer ' + time + '] ' + message);
    chrome.storage.local.get({ logs: [] }).then(({ logs }) => {
      const next = [...logs, { time, msg: message, type }].slice(-50);
      return chrome.storage.local.set({ logs: next });
    }).catch(error => console.warn('[Auto-Claimer] Log write failed:', error));
  }
})();