// Subtle tactile + audio feedback for navigation taps.
// No special permission needed: navigator.vibrate is a no-op where unsupported
// (e.g. iOS Safari) and a short WebAudio blip only needs the tap gesture that
// triggers it. A user setting can turn both off.

const KEY = "monthend-haptics";

export function hapticsEnabled(): boolean {
  return localStorage.getItem(KEY) !== "off"; // default on
}
export function setHaptics(on: boolean) {
  localStorage.setItem(KEY, on ? "on" : "off");
}

let ctx: AudioContext | null = null;
function tick() {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch { /* audio unavailable — ignore */ }
}

/** Light feedback for a navigation / tap action. */
export function tapFeedback() {
  if (!hapticsEnabled()) return;
  try { navigator.vibrate?.(10); } catch { /* unsupported — ignore */ }
  tick();
}
