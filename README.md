# ⚡ Handshake AI Task Auto-Claimer Chrome Extension

High-performance browser extension (Manifest V3) built to automatically detect and claim available tasks on Handshake AI as soon as they appear.

---

## 🚀 Key Features

- **Sub-Millisecond Detection**: Uses high-speed `MutationObserver` + fallback adaptive polling interval (100ms - 300ms) to detect dynamic task drops instantly.
- **Sleek Control Popup**: Modern glassmorphism UI with master ON/OFF toggle, real-time counters, speed controls, and activity logs.
- **Customizable Button Keywords & Selectors**: Supports matching common keywords (`Claim`, `Claim Task`, `Start`, `Accept`, `Reserve`) and custom CSS selectors.
- **Audio & Desktop Notifications**: Plays Web Audio triumph sound alerts and native browser popups when tasks are claimed.
- **Human-like Timing Control**: Optional click delay (0ms - 1500ms) to avoid triggering aggressive bot detection algorithms.
- **Auto-Reload Guard**: Option to automatically reload the page if no tasks appear for X seconds.

---

## 🛠️ Step-by-Step Installation Guide

### 1. Load Unpacked Extension in Chrome / Edge / Brave
1. Open your Chromium browser (Chrome, Edge, Brave, Opera, etc.).
2. In the address bar, navigate to:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
3. Enable **Developer mode** using the toggle switch in the upper-right corner.
4. Click the **Load unpacked** button in the top left.
5. Select the project directory:
   `C:\Users\handshake-auto-claimer`
6. Pin the extension icon ⚡ to your browser toolbar for easy access.

---

## 🧪 Testing the Extension (Instant Test Bench)

To test the extension without waiting for real Handshake AI task drops:

1. Open Chrome and navigate to the local test bench file:
   `file:///C:/Users/handshake-auto-claimer/test_bench.html`
2. Click the extension icon ⚡ in your browser toolbar.
3. Turn **ON** the **Auto-Claimer Engine** master switch.
4. On the test bench page, click **➕ Drop 1 Fast Task** or **⚡ Start Random Task Drop Stream**.
5. Watch the extension immediately detect and claim the task, play an audio chime, and increment your stats!

---

## ⚙️ How to Use on Handshake AI

1. Open your Handshake AI task dashboard (`handshake.com`, `handshake.ai`, etc.).
2. Click the extension popup icon ⚡.
3. Toggle the engine to **ON**.
4. (Optional) Adjust **Check Speed** to `200 ms` for maximum speed during high-traffic drops.
5. Keep your Handshake AI tab open while working. When a task drops, the extension will claim it instantly and alert you with sound!

---

## 🔧 Customizing Button Selectors

If Handshake AI updates their UI or uses unique button labels:
1. Open the extension popup.
2. Click the **Selectors** tab.
3. Add your specific button keywords (e.g. `Claim Task, Grab Task, Start Now`) or CSS selectors (e.g. `.claim-btn, button[data-testid="claim"]`).
4. Changes save automatically and take effect instantly.

---

## 📂 Project Directory Structure

```
handshake-auto-claimer/
├── manifest.json         # Extension Manifest V3 configuration
├── popup.html            # Control dashboard UI
├── popup.css             # Dark-theme glassmorphism styling
├── popup.js              # Popup state & control script
├── content.js            # Core DOM scanner & auto-click engine
├── background.js         # Service worker for badges & notifications
├── offscreen.html        # Web Audio background player host
├── offscreen.js          # Web Audio synthesizer chime generator
├── test_bench.html       # Interactive local testing page
└── README.md             # Setup & usage guide
```
