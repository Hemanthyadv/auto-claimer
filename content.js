(() => {
  'use strict';

  const DEFAULTS = {
    enabled: false, pollInterval: 500, clickDelay: 250,
    soundEnabled: true, notifyEnabled: true, autoCloseTabs: false,
    autoSwitchTab: true, autoReload: false, reloadInterval: 60,
    buttonKeywords: 'Claim, Claim Task, Accept, Reserve',
    customSelectors: '',
    availableTabKeywords: 'Available tasks, Open tasks',
    taskCardKeywords: '.task-card, .task-item, .task-row, [data-testid*="task"], [class*="task-card"], [class*="task-item"], [class*="project-card"]'
  };

  let config = { ...DEFAULTS };
  let observer = null, pollTimer = null, reloadTimer = null, statsTimer = null;
  let scanning = false, claimInProgress = false, actionInProgress = false;
  let lastScanLog = 0, lastSwitchAttempt = 0, pendingScans = 0;
  const clicked = new WeakSet(), pending = new WeakSet();

  init();

  async function init() {
    await loadConfig();
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'STATE_CHANGED' || message?.type === 'SETTINGS_UPDATED') loadConfig();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.keys(changes).some(key => key in DEFAULTS)) loadConfig();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && config.enabled) {
        scanAndClaim();
        resetReloadTimer();
      }
    });
  }

  async function loadConfig() {
    try {
      config = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
      config.enabled = Boolean(config.enabled);
      config.autoSwitchTab = config.autoSwitchTab !== false;
      config.pollInterval = clamp(config.pollInterval, 100, 2000, 500);
      config.clickDelay = clamp(config.clickDelay, 0, 3000, 250);
      config.reloadInterval = clamp(config.reloadInterval, 10, 180, 60);
      stopEngine();
      if (config.enabled) startEngine();
    } catch (error) {
      console.error('[Auto-Claimer] Settings load failed:', error);
    }
  }

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function startEngine() {
    if (scanning) return;
    scanning = true;
    observer = new MutationObserver(() => {
      tryAutoSwitchTab();
      scanAndClaim();
    });
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'class', 'hidden'] });
    pollTimer = setInterval(() => {
      recordScan();
      tryAutoSwitchTab();
      scanAndClaim();
    }, config.pollInterval);
    resetReloadTimer();
    tryAutoSwitchTab();
    recordScan();
    scanAndClaim();
    logActivity('Detection enabled on this page.', 'system');
  }

  function stopEngine() {
    scanning = false;
    observer?.disconnect();
    observer = null;
    if (pollTimer) clearInterval(pollTimer);
    if (reloadTimer) clearTimeout(reloadTimer);
    if (statsTimer) clearTimeout(statsTimer);
    flushScanCount();
    pollTimer = reloadTimer = statsTimer = null;
  }

  function recordScan() {
    pendingScans += 1;
    if (statsTimer) return;
    statsTimer = setTimeout(flushScanCount, 5000);
  }

  async function flushScanCount() {
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = null;
    const count = pendingScans;
    pendingScans = 0;
    if (!count) return;
    try {
      const { scansCount = 0 } = await chrome.storage.local.get({ scansCount: 0 });
      await chrome.storage.local.set({ scansCount: scansCount + count });
    } catch (error) {
      pendingScans += count;
      console.warn('[Auto-Claimer] Scan counter update failed:', error);
    }
  }

  function words(value) {
    return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
  }

  function tryAutoSwitchTab() {
    if (!config.enabled || !config.autoSwitchTab || document.hidden || actionInProgress) return;
    if (Date.now() - lastSwitchAttempt < 3000) return;
    const keywords = words(config.availableTabKeywords || DEFAULTS.availableTabKeywords).map(v => v.toLowerCase());
    if (!keywords.length) return;
    const candidates = [...document.querySelectorAll('button, a, [role="tab"], [role="button"], [role="link"]')];
    const target = candidates.find(el => {
      if (!isVisible(el)) return false;
      const label = labelOf(el).toLowerCase();
      return keywords.some(k => label === k || label.includes(k));
    });
    if (!target) return;
    const active = target.getAttribute('aria-selected') === 'true' ||
      target.getAttribute('aria-current') === 'page' ||
      target.getAttribute('aria-pressed') === 'true' ||
      target.getAttribute('data-state') === 'active' ||
      target.getAttribute('data-active') === 'true' ||
      target.classList.contains('active') ||
      target.classList.contains('selected') ||
      target.classList.contains('is-active');
    if (active) return;
    lastSwitchAttempt = Date.now();
    actionInProgress = true;
    try {
      target.click();
      logActivity('Selected the Available Tasks tab.', 'system');
    } catch (error) {
      logActivity('Could not select Available Tasks tab: ' + String(error?.message || error), 'warn');
    } finally {
      setTimeout(() => { actionInProgress = false; }, 500);
    }
  }

  function resetReloadTimer() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
    if (!config.enabled || !config.autoReload || !scanning) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (!config.enabled || !config.autoReload || !scanning) return;
      const claimAvailable = findClaimButtons().some(el => isVisible(el) && isClearlyClaimAction(el));
      if (document.hidden || claimInProgress || actionInProgress || claimAvailable) {
        logActivity('Auto-refresh postponed while a task or action may need attention; retrying in 10 seconds.', 'system');
        reloadTimer = setTimeout(resetReloadTimer, 10_000);
        return;
      }
      logActivity('Auto-refresh timer reached; refreshing idle page.', 'system');
      location.reload();
    }, config.reloadInterval * 1000);
  }

  async function scanAndClaim() {
    if (!config.enabled || !scanning || document.hidden || actionInProgress || claimInProgress) return;
    const buttons = findClaimButtons();
    const candidate = buttons.find(button => !clicked.has(button) && !pending.has(button) && isVisible(button) && isClearlyClaimAction(button));
    if (candidate) {
      await clickClaim(candidate);
      return;
    }
    // Some Handshake task feeds require opening a task card before its Claim button exists.
    // Only click a visible configured card when no clear claim button is currently available.
    tryOpenTaskCard();
    if (Date.now() - lastScanLog > 30000) {
      lastScanLog = Date.now();
      logActivity(buttons.length ? 'Scanning: no new claim action found.' : 'Scanning page; no clear claim button found.', 'system');
    }
  }

  async function clickClaim(button) {
    pending.add(button);
    claimInProgress = true;
    actionInProgress = true;
    const label = labelOf(button);
    logActivity('Claim action found: "' + label + '". Clicking once and waiting for page confirmation.', 'system');
    try {
      if (config.clickDelay > 0) await new Promise(resolve => setTimeout(resolve, config.clickDelay));
      if (!config.enabled || !button.isConnected || !isVisible(button) || !isClearlyClaimAction(button)) return;
      clicked.add(button);
      button.click();
      await waitForClaimOutcome(button, label);
    } catch (error) {
      clicked.delete(button);
      logActivity('Claim click failed: ' + String(error?.message || error), 'error');
    } finally {
      pending.delete(button);
      claimInProgress = false;
      actionInProgress = false;
      resetReloadTimer();
    }
  }

  function findClaimButtons() {
    const candidates = new Set();
    for (const selector of ['button', 'a[role="button"]', '[role="button"]', 'input[type="button"]', 'input[type="submit"]']) {
      document.querySelectorAll(selector).forEach(el => {
        if (isVisible(el) && isClearlyClaimAction(el)) candidates.add(el);
      });
    }
    for (const selector of words(config.customSelectors)) {
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (isVisible(el) && isClearlyClaimAction(el)) candidates.add(el);
        });
      } catch (error) {
        console.warn('[Auto-Claimer] Invalid custom selector ignored:', selector, error);
      }
    }
    return [...candidates];
  }

  function tryOpenTaskCard() {
    if (actionInProgress || claimInProgress) return;

    // Always include the built-in selectors even when an older installation has
    // saved legacy values such as "View, Open, Task" in storage.
    const configured = words(config.taskCardKeywords);
    const defaults = words(DEFAULTS.taskCardKeywords);
    const selectors = [...new Set([...defaults, ...configured])]
      .filter(value => /^(\.|#|\[)/.test(value));

    for (const selector of selectors) {
      let cards;
      try { cards = document.querySelectorAll(selector); } catch { continue; }
      for (const card of cards) {
        if (!isVisible(card) || clicked.has(card) || pending.has(card)) continue;
        if (card.matches('body, html, main, nav, header, footer, button, a, [role="button"], [role="tab"]')) continue;

        const text = String(card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 700) continue;
        // Do not open a card if it already contains a clear claim action;
        // the main scanner should click that control instead.
        const controls = [...card.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')];
        if (controls.some(control => isVisible(control) && isClearlyClaimAction(control))) continue;

        pending.add(card);
        actionInProgress = true;
        try {
          card.scrollIntoView({ block: 'center', behavior: 'auto' });
          card.click();
          clicked.add(card);
          logActivity('Clicked a task card/row to reveal its details.', 'system');
        } catch (error) {
          logActivity('Could not click task card: ' + String(error?.message || error), 'warn');
        } finally {
          pending.delete(card);
          setTimeout(() => {
            actionInProgress = false;
            // Scan again after the card's detail panel has had time to render.
            if (config.enabled && scanning) scanAndClaim();
          }, 450);
        }
        return;
      }
    }

    // Legacy configurations sometimes used the words "View" or "Open" rather
    // than CSS selectors. Only click a visible, exact-label detail control
    // inside a task-like card, never a page-wide generic action.
    const detailControls = [...document.querySelectorAll('button, a, [role="button"]')].filter(control => {
      if (!isVisible(control) || clicked.has(control)) return false;
      const label = labelOf(control).toLowerCase();
      if (!/^(view|view task|view details|view task details|open|open task|open details|details)$/.test(label)) return false;
      return Boolean(control.closest('.task-card, .task-item, .task-row, [data-testid*="task"], [class*="task-card"], [class*="task-item"], [class*="project-card"]'));
    });
    const detailControl = detailControls[0];
    if (detailControl) {
      clicked.add(detailControl);
      actionInProgress = true;
      try {
        detailControl.click();
        logActivity('Clicked the task details control inside a task card.', 'system');
      } finally {
        setTimeout(() => {
          actionInProgress = false;
          if (config.enabled && scanning) scanAndClaim();
        }, 450);
      }
    }
  }

  function labelOf(element) {
    return String(element?.innerText || element?.textContent || element?.value || element?.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function isClearlyClaimAction(element) {
    const label = labelOf(element).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!label || label.length > 100) return false;
    // Avoid status labels and unrelated workflow actions.
    if (/\b(claimed|claiming|unavailable|already taken|in progress|assigned|completed|expired)\b/.test(label)) return false;
    if (/^(view|open|details|learn more|start|start now|continue|next|submit|cancel|close|back|refresh|search|filter|available tasks|my tasks)$/i.test(label)) return false;
    const keywords = words(config.buttonKeywords || DEFAULTS.buttonKeywords)
      .map(v => v.toLowerCase().replace(/\s+/g, ' ').trim())
      .filter(keyword => keyword && !/^(start|open|view|task|claimed|claiming)$/i.test(keyword));
    return keywords.some(keyword =>
      label === keyword || label.startsWith(keyword + ' ') ||
      label.startsWith(keyword + ':') || label.startsWith(keyword + '—') ||
      label.startsWith(keyword + '-')
    );
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  async function waitForClaimOutcome(button, label) {
    const start = Date.now();
    const initialText = (document.body?.innerText || '').toLowerCase().slice(0, 50000);
    const successPhrases = [
      'task claimed', 'successfully claimed', 'claim successful',
      'task accepted', 'you have claimed', 'added to your tasks'
    ];
    const failurePhrases = [
      'unable to claim', 'failed to claim', 'claim failed',
      'no longer available', 'already taken', 'something went wrong'
    ];
    while (Date.now() - start < 8000) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const bodyText = (document.body?.innerText || '').toLowerCase().slice(0, 50000);
      const newSuccess = successPhrases.some(phrase =>
        bodyText.includes(phrase) && !initialText.includes(phrase)
      );
      const newFailure = failurePhrases.some(phrase =>
        bodyText.includes(phrase) && !initialText.includes(phrase)
      );
      if (newFailure) {
        logActivity('The page reported a possible claim failure or unavailable task. Verify task status manually.', 'warn');
        return;
      }
      // An old success banner or a route change is not proof of a new claim.
      if (newSuccess) {
        await reportConfirmedClaim(label);
        return;
      }
      if ((!button.isConnected || !isVisible(button) || !isClearlyClaimAction(button)) && Date.now() - start > 1500) {
        logActivity('Claim button changed/disappeared but no new success message was found. Check the page manually.', 'warn');
        return;
      }
    }
    logActivity('No new reliable success confirmation detected for "' + label + '". Check the page manually.', 'warn');
  }

  async function reportConfirmedClaim(label) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'TASK_CLAIMED', buttonText: label,
        soundEnabled: config.soundEnabled, notifyEnabled: config.notifyEnabled
      });
      if (!result?.ok) throw new Error(result?.error || 'Background did not confirm the claim alert.');
      logActivity('Claim confirmation detected for "' + label + '".', 'success');
    } catch (error) {
      logActivity('Claim detected but counter/alert update failed: ' + String(error?.message || error), 'error');
    }
  }

  function logActivity(message, type = 'system') {
    const time = new Date().toLocaleTimeString();
    console.log('[Auto-Claimer ' + time + '] ' + message);
    chrome.storage.local.get({ logs: [] }).then(({ logs }) =>
      chrome.storage.local.set({ logs: [...logs, { time, msg: message, type }].slice(-50) })
    ).catch(error => console.warn('[Auto-Claimer] Log write failed:', error));
  }
})();
