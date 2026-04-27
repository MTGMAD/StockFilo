import { useState, useEffect } from "react";
import type { View, Portfolio } from "../../types";
import {
  LayoutDashboard,
  Settings,
  Eye,
  PanelLeftClose,
  PanelLeftOpen,
  Star,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  Briefcase,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { AppLogoMark } from "../shared/AppLogoMark";

interface SidebarProps {
  view: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
  onToggle: () => void;
  portfolios: Portfolio[];
  activePortfolioId: number | null;
  onSelectPortfolio: (id: number) => void;
  onCreatePortfolio: (name: string) => Promise<number>;
  onRenamePortfolio: (id: number, name: string) => Promise<void>;
  onDeletePortfolio: (id: number) => Promise<void>;
  onStarPortfolio: (id: number) => Promise<void>;
  onReorderPortfolios: (ids: number[]) => Promise<void>;
  newPortfolioTrigger?: number;
}

export function Sidebar({
  view,
  onNavigate,
  collapsed,
  onToggle,
  portfolios,
  activePortfolioId,
  onSelectPortfolio,
  onCreatePortfolio,
  onRenamePortfolio,
  onDeletePortfolio,
  onStarPortfolio,
  onReorderPortfolios,
  newPortfolioTrigger,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (newPortfolioTrigger && newPortfolioTrigger > 0) {
      setCreatingNew(true);
    }
  }, [newPortfolioTrigger]);

  function startEdit(p: Portfolio) {
    setEditingId(p.id);
    setEditName(p.name);
  }

  async function commitEdit() {
    if (editingId == null) return;
    const trimmed = editName.trim();
    if (trimmed) await onRenamePortfolio(editingId, trimmed);
    setEditingId(null);
    setEditName("");
  }

  async function commitNew() {
    const trimmed = newName.trim();
    if (trimmed) {
      const id = await onCreatePortfolio(trimmed);
      onSelectPortfolio(id);
      onNavigate("portfolio");
    }
    setCreatingNew(false);
    setNewName("");
  }

  function cancelNew() {
    setCreatingNew(false);
    setNewName("");
  }

  async function handleDelete(id: number) {
    await onDeletePortfolio(id);
    setConfirmDeleteId(null);
    // If we deleted the active portfolio, navigate to dashboard or first remaining
    if (id === activePortfolioId) {
      onNavigate("dashboard");
    }
  }

  async function movePortfolio(id: number, direction: "up" | "down") {
    const idx = portfolios.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const newOrder = [...portfolios];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    await onReorderPortfolios(newOrder.map((p) => p.id));
  }

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-border shrink-0 transition-all duration-200",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* Logo header */}
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
            <span className="text-lg font-bold tracking-tight text-foreground">Stockfolio</span>
          </div>
        )}
      </div>

      {/* Main nav */}
      <nav className="flex flex-col gap-1 p-2 flex-1 overflow-y-auto min-h-0">
        {/* Dashboard */}
        <button
          onClick={() => onNavigate("dashboard")}
          title={collapsed ? "Dashboard" : undefined}
          className={cn(
            "flex items-center rounded-md text-sm font-medium transition-colors w-full",
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2 text-left",
            view === "dashboard"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          {!collapsed && "Dashboard"}
        </button>

        {/* Portfolios section */}
        {!collapsed && (
          <div className="mt-3 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
            Portfolios
          </div>
        )}
        {collapsed && portfolios.length > 0 && (
          <div className="my-1 border-t border-border/50" />
        )}

        {portfolios.map((p, idx) => (
          <div key={p.id} className="group relative">
            {editingId === p.id ? (
              // Inline rename input
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") { setEditingId(null); setEditName(""); }
                  }}
                  className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                />
                <button onClick={commitEdit} className="text-positive hover:opacity-80 shrink-0" title="Save">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setEditingId(null); setEditName(""); }}
                  className="text-muted-foreground hover:opacity-80 shrink-0"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : confirmDeleteId === p.id ? (
              // Delete confirmation
              <div className="flex flex-col gap-1 px-2 py-1.5 bg-destructive/10 rounded-md">
                <span className="text-xs text-destructive font-medium truncate">
                  Delete "{p.name}"?
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="flex-1 text-xs bg-destructive text-destructive-foreground rounded px-2 py-0.5 hover:opacity-90"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="flex-1 text-xs bg-muted text-muted-foreground rounded px-2 py-0.5 hover:opacity-90"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : collapsed ? (
              // Collapsed: show briefcase icon, highlight if active
              <button
                onClick={() => { onSelectPortfolio(p.id); onNavigate("portfolio"); }}
                title={p.name}
                className={cn(
                  "flex items-center justify-center w-full rounded-md py-2.5 transition-colors",
                  view === "portfolio" && activePortfolioId === p.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Briefcase className="w-4 h-4 shrink-0" />
              </button>
            ) : (
              // Expanded: full portfolio row
              <div
                className={cn(
                  "flex items-center rounded-md transition-colors",
                  view === "portfolio" && activePortfolioId === p.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {/* Star button */}
                <button
                  onClick={(e) => { e.stopPropagation(); onStarPortfolio(p.id); }}
                  title={p.is_starred ? "Default portfolio (starred)" : "Set as default"}
                  className={cn(
                    "pl-2 pr-1 py-2 shrink-0 transition-colors",
                    p.is_starred === 1
                      ? view === "portfolio" && activePortfolioId === p.id
                        ? "text-yellow-200"
                        : "text-yellow-500"
                      : view === "portfolio" && activePortfolioId === p.id
                      ? "text-primary-foreground/40 hover:text-yellow-200"
                      : "opacity-0 group-hover:opacity-100 hover:text-yellow-500"
                  )}
                >
                  <Star className={cn("w-3.5 h-3.5", p.is_starred === 1 && "fill-current")} />
                </button>

                {/* Name button */}
                <button
                  onClick={() => { onSelectPortfolio(p.id); onNavigate("portfolio"); }}
                  className="flex-1 text-left px-1 py-2 text-sm font-medium truncate min-w-0"
                >
                  {p.name}
                </button>

                {/* Action buttons (show on hover) */}
                <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pr-1 gap-0.5">
                  <div className="flex flex-col">
                    <button
                      onClick={(e) => { e.stopPropagation(); movePortfolio(p.id, "up"); }}
                      disabled={idx === 0}
                      className={cn(
                        "p-0.5 rounded transition-colors disabled:opacity-30",
                        view === "portfolio" && activePortfolioId === p.id
                          ? "hover:bg-primary-foreground/20"
                          : "hover:bg-accent"
                      )}
                      title="Move up"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); movePortfolio(p.id, "down"); }}
                      disabled={idx === portfolios.length - 1}
                      className={cn(
                        "p-0.5 rounded transition-colors disabled:opacity-30",
                        view === "portfolio" && activePortfolioId === p.id
                          ? "hover:bg-primary-foreground/20"
                          : "hover:bg-accent"
                      )}
                      title="Move down"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                    className={cn(
                      "p-1 rounded transition-colors",
                      view === "portfolio" && activePortfolioId === p.id
                        ? "hover:bg-primary-foreground/20"
                        : "hover:bg-accent"
                    )}
                    title="Rename"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}
                    className={cn(
                      "p-1 rounded transition-colors",
                      view === "portfolio" && activePortfolioId === p.id
                        ? "hover:bg-primary-foreground/20 text-primary-foreground/70"
                        : "hover:bg-destructive/10 hover:text-destructive"
                    )}
                    title="Delete portfolio"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* New portfolio button / input */}
        {!collapsed && (
          creatingNew ? (
            <div className="flex items-center gap-1 px-2 py-1 mt-0.5">
              <input
                autoFocus
                placeholder="Portfolio name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNew();
                  if (e.key === "Escape") cancelNew();
                }}
                className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
              <button onClick={commitNew} className="text-positive hover:opacity-80 shrink-0" title="Create">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={cancelNew} className="text-muted-foreground hover:opacity-80 shrink-0" title="Cancel">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingNew(true)}
              className="flex items-center gap-2 px-3 py-1.5 mt-0.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full"
            >
              <Plus className="w-3.5 h-3.5" />
              New Portfolio
            </button>
          )
        )}
        {collapsed && (
          <button
            onClick={() => { setCreatingNew(true); }}
            title="New Portfolio"
            className="flex items-center justify-center w-full rounded-md py-2.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Plus className="w-4 h-4 shrink-0" />
          </button>
        )}

        {/* Watch List */}
        {!collapsed && <div className="mt-3 mb-1 border-t border-border/50" />}
        {collapsed && <div className="my-1 border-t border-border/50" />}
        <button
          onClick={() => onNavigate("watchlist")}
          title={collapsed ? "Watch List" : undefined}
          className={cn(
            "flex items-center rounded-md text-sm font-medium transition-colors w-full",
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2 text-left",
            view === "watchlist"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <Eye className="w-4 h-4 shrink-0" />
          {!collapsed && "Watch List"}
        </button>
      </nav>

      {/* Footer: Settings + Collapse */}
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

