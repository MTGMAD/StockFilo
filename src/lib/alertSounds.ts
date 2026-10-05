/**
 * Price-alert sounds, synthesized with the Web Audio API rather than bundled
 * audio files — no assets to source/license, and they play instantly.
 */

export type AlertSoundId = "chime" | "bell" | "ping";

export const ALERT_SOUNDS: { id: AlertSoundId; label: string }[] = [
  { id: "chime", label: "Chime" },
  { id: "bell", label: "Bell" },
  { id: "ping", label: "Ping" },
];

let sharedCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === "closed") sharedCtx = new Ctor();
  return sharedCtx;
}

/** One sine-wave tone, `startAt` seconds from now, fading out by `duration`. */
function tone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  peakGain: number,
  type: OscillatorType = "sine",
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  const t0 = ctx.currentTime + startAt;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

const PLAYERS: Record<AlertSoundId, (ctx: AudioContext, volume: number) => void> = {
  chime: (ctx, v) => {
    tone(ctx, 880, 0, 0.35, 0.3 * v);
    tone(ctx, 1318.5, 0.12, 0.4, 0.28 * v);
  },
  bell: (ctx, v) => {
    tone(ctx, 1046.5, 0, 0.6, 0.32 * v);
    tone(ctx, 2093, 0, 0.5, 0.12 * v);
  },
  ping: (ctx, v) => {
    tone(ctx, 1500, 0, 0.12, 0.3 * v, "triangle");
    tone(ctx, 1500, 0.16, 0.12, 0.3 * v, "triangle");
  },
};

export function playAlertSound(id: AlertSoundId, volume = 1) {
  const ctx = getContext();
  if (!ctx) return;
  // A fresh AudioContext (or one created before the first user gesture)
  // starts "suspended" in most browsers/webviews — resume is a no-op once
  // already running.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  try {
    PLAYERS[id](ctx, Math.min(1, Math.max(0, volume)));
  } catch {
    // Audio is best-effort — a failure here should never break alert delivery.
  }
}
