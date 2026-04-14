import type { View } from "../../types";
import { BarChart2, List, Settings } from "lucide-react";
import { cn } from "../../lib/utils";

interface SidebarProps {
  view: View;
  onNavigate: (v: View) => void;
}

const navItems: { id: View; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "purchases", label: "Purchases", Icon: List },
  { id: "analysis", label: "Analysis", Icon: BarChart2 },
  { id: "settings", label: "Settings", Icon: Settings },
];

export function Sidebar({ view, onNavigate }: SidebarProps) {
  return (
    <aside className="flex flex-col w-52 min-h-screen bg-sidebar border-r border-border shrink-0">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-border">
        <span className="text-xl font-bold tracking-tight text-foreground">StockFilo</span>
      </div>
      <nav className="flex flex-col gap-1 p-3 flex-1">
        {navItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors w-full text-left",
              view === id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
