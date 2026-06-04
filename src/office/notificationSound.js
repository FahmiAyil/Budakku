/**
 * Notification Sound — Web Audio API synthesized chimes
 * Done: ascending two-note chime (E5 → E6)
 * Permission: descending two-note tap (A5 → E5)
 */

/* global AudioContext */

var notificationSound = (function () {
  var audioCtx = null;
  var soundEnabled = true;

  function getCtx() {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
  }

  function playNote(ctx, freq, startOffset, duration, volume) {
    var t = ctx.currentTime + startOffset;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
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

  function playDoneSound() {
    if (!soundEnabled) return;
    try {
      var ctx = getCtx();
      resume(ctx).then(function () {
        playNote(ctx, 659.25, 0,    0.18, 0.14); // E5
        playNote(ctx, 1318.51, 0.1, 0.18, 0.14); // E6
      });
    } catch (e) { /* audio unavailable */ }
  }

  function playPermissionSound() {
    if (!soundEnabled) return;
    try {
      var ctx = getCtx();
      resume(ctx).then(function () {
        playNote(ctx, 880,    0,    0.15, 0.12); // A5
        playNote(ctx, 659.25, 0.12, 0.15, 0.12); // E5
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
