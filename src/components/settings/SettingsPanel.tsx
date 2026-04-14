import type { Theme } from "../../types";
import { cn } from "../../lib/utils";
import { Monitor, Sun, Moon } from "lucide-react";

interface SettingsPanelProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

const themes: { id: Theme; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

export function SettingsPanel({ theme, onThemeChange }: SettingsPanelProps) {
  return (
    <div className="p-6 max-w-md">
      <h2 className="text-base font-semibold text-foreground mb-1">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Choose how StockFilo looks. "System" follows your OS preference.
      </p>
      <div className="flex gap-3">
        {themes.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onThemeChange(id)}
            className={cn(
              "flex flex-col items-center gap-2 px-5 py-4 rounded-lg border text-sm font-medium transition-colors",
              theme === id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            )}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-8 pt-8 border-t border-border">
        <h2 className="text-base font-semibold text-foreground mb-1">About</h2>
        <p className="text-sm text-muted-foreground">StockFilo v0.1.0 — Personal stock portfolio tracker.</p>
      </div>
    </div>
  );
}
