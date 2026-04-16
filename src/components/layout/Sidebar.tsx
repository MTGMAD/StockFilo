import type { View } from "../../types";
import { LayoutDashboard, BarChart2, List, Settings, Eye, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "../../lib/utils";
import { AppLogoMark } from "../shared/AppLogoMark";

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
          collapsed ? "justify-center px-0 py-4" : "px-4 py-4"
        )}
      >
        {collapsed ? (
          <AppLogoMark className="h-8 w-8 shrink-0" />
        ) : (
          <div className="flex items-center gap-3 min-w-0">
            <AppLogoMark className="h-7 w-7 shrink-0" />
            <span className="text-lg font-bold tracking-tight text-foreground">StockFilo</span>
          </div>
        )}
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

      <div className="border-t border-border p-2 shrink-0">
        <button
          onClick={() => onNavigate("settings")}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center rounded-md text-sm font-medium transition-colors w-full",
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2 text-left",
            view === "settings"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          {!collapsed && "Settings"}
        </button>
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mt-1 flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="mx-auto h-4 w-4 shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4 shrink-0" />
              <span className="ml-3">Collapse sidebar</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
