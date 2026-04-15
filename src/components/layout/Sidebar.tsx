import type { View } from "../../types";
import { LayoutDashboard, BarChart2, List, Settings, Eye, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "../../lib/utils";

interface SidebarProps {
  view: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
  onToggle: () => void;
}

const navItems: { id: View; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "analysis", label: "Analysis", Icon: BarChart2 },
  { id: "watchlist", label: "Watch List", Icon: Eye },
  { id: "purchases", label: "Purchases", Icon: List },
  { id: "settings", label: "Settings", Icon: Settings },
];

export function Sidebar({ view, onNavigate, collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-border shrink-0 transition-all duration-200",
        collapsed ? "w-14" : "w-52"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center border-b border-border shrink-0",
          collapsed ? "justify-center px-0 py-5" : "justify-between px-4 py-5"
        )}
      >
        {!collapsed && (
          <span className="text-xl font-bold tracking-tight text-foreground">StockFilo</span>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {collapsed
            ? <PanelLeftOpen className="w-4 h-4" />
            : <PanelLeftClose className="w-4 h-4" />
          }
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 p-2 flex-1">
        {navItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center rounded-md text-sm font-medium transition-colors w-full",
              collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2 text-left",
              view === id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
