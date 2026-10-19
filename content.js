(function () {
  'use strict';

  let config = {
    enabled: false,
    pollInterval: 300,
    clickDelay: 0,
    soundEnabled: true,
    notifyEnabled: true,
    autoCloseTabs: true,
    closeTabDelay: 200,
    autoSwitchTab: true,
    availableTabKeywords: [],
    taskCardKeywords: [],
    taskCardSelectors: [],
    autoReload: false,
    reloadInterval: 30,
    buttonKeywords: [],
    customSelectors: []
  };

  let isScanning = false;
  let pollTimer = null;
  let autoReloadTimer = null;
  let observer = null;
  let lastActivityTime = Date.now();

  // Load settings and initialize
  init();

  async function init() {
    await updateConfigFromStorage();

    // Listen for state changes from popup
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'STATE_CHANGED' || msg.type === 'SETTINGS_UPDATED') {
        updateConfigFromStorage();
      }
    });

    // Register tab ID with background worker
    chrome.runtime.sendMessage({ type: 'REGISTER_HANDSHAKE_TAB' }).catch(() => {});

    // Handle visibility change (re-sync when tab becomes active)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && config.enabled) {
        resetAutoReloadTimer();
        scanAndClaim();
      }
    });
  }

  async function updateConfigFromStorage() {
    const data = await chrome.storage.local.get([
      'enabled', 'pollInterval', 'clickDelay', 'soundEnabled', 
      'notifyEnabled', 'autoCloseTabs', 'closeTabDelay',
      'autoSwitchTab', 'availableTabKeywords', 'taskCardKeywords',
      'autoReload', 'reloadInterval', 
      'buttonKeywords', 'customSelectors'
    ]);

    config.enabled = !!data.enabled;
    config.pollInterval = data.pollInterval || 300;
    config.clickDelay = data.clickDelay || 0;
    config.soundEnabled = data.soundEnabled !== false;
    config.notifyEnabled = data.notifyEnabled !== false;
    config.autoCloseTabs = data.autoCloseTabs !== false;
    config.closeTabDelay = data.closeTabDelay !== undefined ? data.closeTabDelay : 200;
    config.autoSwitchTab = data.autoSwitchTab !== false;
    config.autoReload = !!data.autoReload;
    config.reloadInterval = data.reloadInterval || 30;

    // Parse button keywords
    const rawKeywords = data.buttonKeywords || 'Claim, Claim Task, Start, Accept, Reserve, Take Task';
    config.buttonKeywords = rawKeywords
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    // Parse tab keywords
    const rawTabKeywords = data.availableTabKeywords || 'Available tasks, Available, Open tasks, All tasks';
    config.availableTabKeywords = rawTabKeywords
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    // Parse task card keywords & selectors
    const defaultCards = '.task-card, .task-item, .task-row, [class*="task-card"], [class*="task-item"], [class*="project-card"], View, Open, Task';
    const rawCardKeywords = data.taskCardKeywords || defaultCards;
    
    config.taskCardSelectors = [];
    config.taskCardKeywords = [];

    rawCardKeywords.split(',').forEach(item => {
      const trimmed = item.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('.') || trimmed.startsWith('#') || trimmed.startsWith('[')) {
        config.taskCardSelectors.push(trimmed);
      } else {
        config.taskCardKeywords.push(trimmed.toLowerCase());
      }
    });

    // Parse custom selectors
    const rawSelectors = data.customSelectors || '';
    config.customSelectors = rawSelectors
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Inject in-page window.open hook for direct JS window popups
    injectWindowOpenHook(config.enabled && config.autoCloseTabs, config.closeTabDelay);

    if (config.enabled) {
      startEngine();
    } else {
      stopEngine();
    }
  }

  function injectWindowOpenHook(autoClose, delayMs) {
    const code = `
      (function() {
        window.__autoCloseEnabled = ${autoClose};
        window.__autoCloseDelay = ${delayMs};
        if (window.__openHookInjected) return;
        window.__openHookInjected = true;
        const origOpen = window.open;
        window.open = function(...args) {
          const win = origOpen.apply(this, args);
          if (window.__autoCloseEnabled && win) {
            setTimeout(() => {
              try { win.close(); } catch(e) {}
            }, window.__autoCloseDelay || 200);
          }
          return win;
        };
      })();
    `;
    const script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function startEngine() {
    if (isScanning) stopEngine();
    isScanning = true;

    // 1. Setup MutationObserver for zero-delay DOM detection
    setupObserver();

    // 2. Setup interval scanner for periodic checks
    pollTimer = setInterval(() => {
      scanAndClaim();
    }, config.pollInterval);

    // 3. Setup Auto-Reload Timer if configured
    resetAutoReloadTimer();

    // Initial immediate scan
    scanAndClaim();
    logActivity('Engine active. Monitoring for available tasks...', 'system');
  }

  function stopEngine() {
    isScanning = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (autoReloadTimer) {
      clearTimeout(autoReloadTimer);
      autoReloadTimer = null;
    }
  }

  function setupObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      if (!config.enabled) return;
      
      // Quick check if any added nodes might contain interactive elements
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }

      if (shouldScan) {
        scanAndClaim();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function resetAutoReloadTimer() {
    if (autoReloadTimer) clearTimeout(autoReloadTimer);
    if (!config.enabled || !config.autoReload) return;

    autoReloadTimer = setTimeout(() => {
      logActivity(`No tasks found for ${config.reloadInterval}s. Reloading page...`, 'warn');
      window.location.reload();
    }, config.reloadInterval * 1000);
  }

  function switchToAvailableTab() {
    if (!config.enabled || !config.autoSwitchTab) return false;

    const tabSelectors = 'button, a, [role="tab"], div[class*="tab"], li[class*="tab"], span[class*="tab"], [class*="nav"]';
    const elements = document.querySelectorAll(tabSelectors);

    for (const el of elements) {
      if (!isElementVisibleAndEnabled(el, true)) continue;

      const text = (el.innerText || el.textContent || '').toLowerCase().trim();
      const isMatch = config.availableTabKeywords.some(kw => text.includes(kw));

      if (isMatch) {
        // Check if tab is already active/selected
        const isActive = el.classList.contains('active') || 
                         el.classList.contains('selected') || 
                         el.classList.contains('current') ||
                         el.getAttribute('aria-selected') === 'true' ||
                         el.getAttribute('data-state') === 'active' ||
                         el.getAttribute('data-selected') === 'true';

        if (!isActive && el.dataset.autoSwitched !== 'true') {
          el.dataset.autoSwitched = 'true';
          logActivity(`Switching page view to "${text}" tab...`, 'system');
          executeHumanClick(el);
          return true;
        } else if (isActive) {
          return false;
        }
      }
    }

    return false;
  }

  async function scanAndClaim() {
    if (!config.enabled) return;

    // Step 0: Ensure we are on "Available tasks" tab
    const switched = switchToAvailableTab();
    if (switched) return;

    // Increment scan counter in storage periodically
    incrementScanCount();

    // Step 1: Check if "Claim Task" button is ALREADY visible in DOM
    const claimableButtons = findClaimButtons();

    if (claimableButtons.length > 0) {
      resetAutoReloadTimer(); // Reset idle reload timer since elements were detected

      for (const button of claimableButtons) {
        if (button.dataset.autoClaimed === 'true') continue;

        // Mark immediately to avoid double-clicking in fast loops
        button.dataset.autoClaimed = 'true';

        const btnText = (button.innerText || button.textContent || 'Task Button').trim();
        logActivity(`STEP 2/2: CLAIM BUTTON FOUND! Executing claim click on "${btnText}"`, 'success');

        // Signal pre-claim to background worker before click opens window
        chrome.runtime.sendMessage({ type: 'PRE_CLAIM' });

        if (config.clickDelay > 0) {
          await delay(config.clickDelay);
        }

        executeHumanClick(button);

        // Send claim success event
        chrome.runtime.sendMessage({
          type: 'TASK_CLAIMED',
          buttonText: btnText,
          url: window.location.href,
          soundEnabled: config.soundEnabled,
          notifyEnabled: config.notifyEnabled
        });
      }
      return;
    }

    // Step 2: If no Claim button is currently visible, click an Available Task Card to open details & reveal Claim button!
    const taskCards = findTaskCards();
    if (taskCards.length > 0) {
      for (const card of taskCards) {
        if (card.dataset.autoCardClicked === 'true') continue;

        card.dataset.autoCardClicked = 'true';
        const cardText = (card.innerText || card.textContent || 'Task Item').trim().substring(0, 35);
        logActivity(`STEP 1/2: TASK CARD DETECTED! Opening details for "${cardText}..."`, 'system');

        executeHumanClick(card);
        resetAutoReloadTimer();
        break; // Open one task card at a time to reveal its Claim button
      }
    }
  }

  function findClaimButtons() {
    const candidates = new Set();

    const availableContainer = document.querySelector('[id*="available"], [class*="available"], [data-tab*="available"], [aria-labelledby*="available"]');
    const searchRoot = availableContainer || document;

    // Strategy 1: Check Custom Selectors if user defined any
    if (config.customSelectors.length > 0) {
      for (const selector of config.customSelectors) {
        try {
          const elements = searchRoot.querySelectorAll(selector);
          elements.forEach(el => {
            if (isElementVisibleAndEnabled(el)) candidates.add(el);
          });
        } catch (e) {
          // Ignore invalid selector syntax
        }
      }
    }

    // Strategy 2: Find interactive elements matching keywords
    const interactiveSelectors = 'button, a, input[type="button"], input[type="submit"], [role="button"], div[class*="btn"], span[class*="btn"], div[class*="claim"], button[class*="claim"]';
    const elements = searchRoot.querySelectorAll(interactiveSelectors);

    elements.forEach(el => {
      if (isElementVisibleAndEnabled(el)) {
        const text = (el.innerText || el.textContent || el.value || '').toLowerCase().trim();
        
        // Match against keywords
        const isMatch = config.buttonKeywords.some(keyword => {
          if (!keyword) return false;
          return text.includes(keyword);
        });

        if (isMatch) {
          candidates.add(el);
        }
      }
    });

    return Array.from(candidates);
  }

  function findTaskCards() {
    const candidates = new Set();

    const availableContainer = document.querySelector('[id*="available"], [class*="available"], [data-tab*="available"], [aria-labelledby*="available"]');
    const searchRoot = availableContainer || document;

    // 1. Match explicitly defined card CSS selectors
    if (config.taskCardSelectors.length > 0) {
      for (const selector of config.taskCardSelectors) {
        try {
          const els = searchRoot.querySelectorAll(selector);
          els.forEach(el => {
            if (isElementVisibleAndEnabled(el)) candidates.add(el);
          });
        } catch (e) {}
      }
    }

    if (candidates.size > 0) return Array.from(candidates);

    // 2. Fallback: Search elements with task-card like class names or keywords
    const cardSelectors = 'div[class*="task-card"], div[class*="task-item"], div[class*="task-row"], div[class*="project-card"], tr[class*="task"], [data-testid*="task"]';
    const elements = searchRoot.querySelectorAll(cardSelectors);

    elements.forEach(el => {
      if (isElementVisibleAndEnabled(el)) {
        candidates.add(el);
      }
    });

    return Array.from(candidates);
  }

  function isElementVisibleAndEnabled(el, isTabCheck = false) {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

    // Strict Guard: Exclude elements inside "My Tasks" or "Claimed" sections (unless checking tab navigation)
    if (!isTabCheck) {
      const myTasksContainer = el.closest('[id*="my-task"], [class*="my-task"], [id*="my_task"], [class*="my_task"], [id*="viewMyTasks"], [data-tab*="my-task"], [aria-labelledby*="my-task"], [id*="claimed-task"], [class*="claimed-task"]');
      if (myTasksContainer) {
        return false;
      }
    }

    // Check style visibility
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

    // Check parent visibility & aria-hidden
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (parent.getAttribute('aria-hidden') === 'true' || parent.hidden) return false;
      const pStyle = window.getComputedStyle(parent);
      if (pStyle.display === 'none' || pStyle.visibility === 'hidden') return false;
      parent = parent.parentElement;
    }

    // Check size
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
  }

  function executeHumanClick(element) {
    // Scroll into view if needed
    element.scrollIntoView({ block: 'center', behavior: 'instant' });

    // Focus element
    element.focus();

    // Check if element is an anchor link with target="_blank"
    const anchor = element.tagName === 'A' ? element : element.closest('a');
    if (anchor && anchor.getAttribute('target') === '_blank' && anchor.href && config.autoCloseTabs) {
      try {
        const win = window.open(anchor.href, '_blank');
        if (win) {
          setTimeout(() => {
            try { win.close(); } catch (e) {}
          }, config.closeTabDelay || 200);
        }
        return;
      } catch (e) {}
    }

    // Dispatch full sequence of pointer/mouse events to bypass synthetic click blocks
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      buttons: 1
    };

    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
      const event = new MouseEvent(eventType, eventOptions);
      element.dispatchEvent(event);
    });

    // Call native click method as fallback
    if (typeof element.click === 'function') {
      element.click();
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function incrementScanCount() {
    // Throttled scan counter update
    const now = Date.now();
    if (now - lastActivityTime > 5000) {
      lastActivityTime = now;
      chrome.storage.local.get('scansCount', (d) => {
        const current = d.scansCount || 0;
        chrome.storage.local.set({ scansCount: current + 10 });
      });
    }
  }

  function logActivity(msg, type = 'system') {
    const time = new Date().toLocaleTimeString();
    console.log(`[Handshake Auto-Claimer ${time}] (${type}): ${msg}`);
    
    chrome.storage.local.get('logs', (data) => {
      const logs = data.logs || [];
      logs.push({ time, msg, type });
      if (logs.length > 50) logs.shift();
      chrome.storage.local.set({ logs });
    });
  }
})();
