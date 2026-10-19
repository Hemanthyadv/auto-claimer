'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'PLAY_AUDIO_CHIME') return;
  playSuccessChime()
    .then(() => sendResponse({ ok: true }))
    .catch(error => {
      console.error('[Auto-Claimer] Audio play error:', error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
  return true;
});

async function playSuccessChime() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio API is unavailable.');

  const context = new AudioContextClass();
  try {
    if (context.state === 'suspended') await context.resume();

    const notes = [523.25, 659.25, 783.99, 1046.50];
    const startTime = context.currentTime + 0.03;
    const endTime = startTime + 0.08 * (notes.length - 1) + 0.32;

    notes.forEach((frequency, index) => {
      const start = startTime + index * 0.08;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.30);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.31);
    });

    await new Promise(resolve => setTimeout(resolve, Math.max(0, (endTime - context.currentTime) * 1000)));
  } finally {
    await context.close().catch(() => {});
  }
}
