/**
 * Notification Sound — Web Audio API synthesized chimes
 * Done: ascending major arpeggio G4→C5→E5→G5 ("ta-da!" fanfare)
 * Permission: three urgent descending knocks ("hey! help me!")
 */

/* global AudioContext */

var notificationSound = (function () {
  var audioCtx = null;
  var soundEnabled = true;

  function getCtx() {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
  }

  function playNote(ctx, freq, startOffset, duration, volume, type) {
    var t = ctx.currentTime + startOffset;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  function resume(ctx) {
    if (ctx.state === 'suspended') return ctx.resume();
    return Promise.resolve();
  }

  // "It's done!" — ascending G4→C5→E5→G5 major arpeggio, bright triangle wave
  function playDoneSound() {
    if (!soundEnabled) return;
    try {
      var ctx = getCtx();
      resume(ctx).then(function () {
        playNote(ctx, 392.00, 0.00, 0.12, 0.13, 'triangle'); // G4
        playNote(ctx, 523.25, 0.09, 0.12, 0.14, 'triangle'); // C5
        playNote(ctx, 659.25, 0.18, 0.14, 0.15, 'triangle'); // E5
        playNote(ctx, 783.99, 0.27, 0.30, 0.16, 'triangle'); // G5 (held)
      });
    } catch (e) { /* audio unavailable */ }
  }

  // "Hey! Help me!" — three sharp urgent beeps, high pitch, square wave punch
  function playPermissionSound() {
    if (!soundEnabled) return;
    try {
      var ctx = getCtx();
      resume(ctx).then(function () {
        playNote(ctx, 1174.66, 0.00, 0.08, 0.20, 'square'); // D6
        playNote(ctx, 1174.66, 0.12, 0.08, 0.22, 'square'); // D6
        playNote(ctx, 1396.91, 0.24, 0.18, 0.25, 'square'); // F6 (higher, urgent)
      });
    } catch (e) { /* audio unavailable */ }
  }

  function unlockAudio() {
    try { resume(getCtx()); } catch (e) { /* ignore */ }
  }

  function setSoundEnabled(val) { soundEnabled = val; }
  function isSoundEnabled() { return soundEnabled; }

  return { playDoneSound, playPermissionSound, unlockAudio, setSoundEnabled, isSoundEnabled };
})();
