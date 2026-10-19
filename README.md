# Handshake AI Task Auto-Claimer

A Manifest V3 Chrome extension that scans the current Handshake task page, can switch to the Available Tasks tab, and clicks a clearly labelled claim action when its text matches the configured keywords.

## Features

- DOM mutation monitoring with a configurable polling fallback (100–2000 ms).
- Available Tasks tab switching using configurable visible tab labels.
- Claim action matching that avoids common status labels such as “Claimed” and “Unavailable”.
- Optional sound and desktop notification alerts.
- Scan and confirmed-claim counters in the popup.
- Optional idle-page auto-refresh; refresh is postponed while a claim action is visible or an action is in progress.
- Configurable button keywords and CSS selectors.

## Install in Chrome

1. Download the ZIP from the repository branch or pull request and extract it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted extension folder (the folder containing `manifest.json`).
5. Open your Handshake task dashboard in a supported domain, then refresh that page so Chrome loads the content script.
6. Open the extension popup. Turn on **Auto-Claimer Engine** and ensure **Auto-Switch to “Available Tasks”** is enabled.
7. Use **Test Sound** to check the alert path, then watch Activity Log for detection messages.

## Important limitations and safe use

- **Live verification is required.** Handshake page markup and button labels can change. The default selectors are heuristics and have not been validated against every live Handshake layout.
- The extension only increments the claimed counter when it detects a new success phrase in the page text. If Handshake uses different wording, a real claim may not be counted; check the task page and Activity Log.
- A click is not proof that a task was claimed. If the UI changes without a new success phrase, the extension logs a warning instead of counting a success.
- Auto-refresh is **off by default**. If enabled, it refreshes only when no claim action is detected and no action is in progress.
- Auto-close tabs is disabled for safety so a task page is not closed before you verify its status.
- The extension is not a guarantee of winning a task race. Keep the dashboard visible and verify claim status yourself. Follow Handshake’s terms and project instructions.

## Settings

- **Check Speed:** polling interval in milliseconds; mutation monitoring may detect changes sooner.
- **Click Delay:** optional wait before clicking a detected claim action.
- **Button Keywords:** comma-separated labels such as `Claim, Claim Task, Accept, Reserve`. Use only labels that genuinely initiate the claim action.
- **Custom CSS Selectors:** optional comma-separated selectors for claim controls.
- **Available Tasks Tab Keywords:** visible text used to find the target tab.
- **Task Card/Row Selectors:** selectors for a task card that must be opened before its claim control appears. Use only selectors verified for the actual Handshake page.
- **Auto-Reload:** optional idle-page refresh timer; use cautiously.

## Project files

- `manifest.json` — extension permissions and content-script matches.
- `popup.html`, `popup.css`, `popup.js` — settings popup and counters.
- `content.js` — page scanning, tab switching, task interaction and confirmation checks.
- `background.js` — notification handling, sound handoff and badge.
- `offscreen.html`, `offscreen.js` — offscreen Web Audio player.
- `icon.svg` — extension notification icon.
- `test_bench.html` — local test page for basic behavior checks.
