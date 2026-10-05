import { useState, useCallback } from "react";
import type { AlertSoundId } from "../lib/alertSounds";
import { ALERT_SOUNDS } from "../lib/alertSounds";

const SOUND_KEY = "stockfolio-alert-sound";
const ENABLED_KEY = "stockfolio-alert-sound-enabled";

function isValidSoundId(v: string | null): v is AlertSoundId {
  return !!v && ALERT_SOUNDS.some((s) => s.id === v);
}

export function useAlertSettings() {
  const [soundId, setSoundIdState] = useState<AlertSoundId>(() => {
    const stored = localStorage.getItem(SOUND_KEY);
    return isValidSoundId(stored) ? stored : ALERT_SOUNDS[0].id;
  });
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(
    () => localStorage.getItem(ENABLED_KEY) !== "false",
  );

  const setSoundId = useCallback((id: AlertSoundId) => {
    localStorage.setItem(SOUND_KEY, id);
    setSoundIdState(id);
  }, []);

  const setSoundEnabled = useCallback((v: boolean) => {
    localStorage.setItem(ENABLED_KEY, String(v));
    setSoundEnabledState(v);
  }, []);

  return { soundId, setSoundId, soundEnabled, setSoundEnabled };
}
