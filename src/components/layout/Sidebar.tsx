import { useState, useEffect } from "react";
import type { View, Portfolio } from "../../types";
import { accountKindStyle } from "../../lib/accountTypes";
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
  PencilLine,
  Landmark,
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
  /** Account-type chip per linked portfolio, keyed by broker_account_id. */
  brokerBadges?: Record<number, { label: string; kind: string }>;
  /** Jump to Settings and open the brokerage connect form. */
  onAddBrokerage?: () => void;
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
  brokerBadges,
  onAddBrokerage,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  // Adding a portfolio now has two routes, so ask which one first rather than
  // silently assuming manual — a brokerage portfolio is created by connecting,
  // not by naming.
  const [choosingKind, setChoosingKind] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [portfoliosOpen, setPortfoliosOpen] = useState<boolean>(() => {
    return localStorage.getItem("stockfolio-portfolios-open") !== "false";
  });

  useEffect(() => {
    localStorage.setItem("stockfolio-portfolios-open", String(portfoliosOpen));
  }, [portfoliosOpen]);

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
          // h-16 is the shared header height, matched in Header.tsx so the
          // three sections line up across the top.
          "flex items-center h-16 border-b border-border shrink-0",
          collapsed ? "justify-center px-0" : "px-4"
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

        {/* Portfolios — styled as a nav row like Dashboard and Watch List,
            but it toggles the list below rather than navigating anywhere. */}
        {!collapsed && (
          <button
            onClick={() => setPortfoliosOpen((o) => !o)}
            aria-expanded={portfoliosOpen}
            className={cn(
              "flex items-center rounded-md text-sm font-medium transition-colors w-full mt-3",
              "gap-3 px-3 py-2 text-left",
              // Deliberately never takes the active highlight: the selected
              // portfolio in the list below already carries it, and two green
              // rows would compete for the same meaning.
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Landmark className="w-4 h-4 shrink-0" />
            <span className="flex-1">Portfolios</span>
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-transform",
                !portfoliosOpen && "-rotate-90",
              )}
            />
          </button>
        )}
        {collapsed && portfolios.length > 0 && (
          <div className="my-1 border-t border-border/50" />
        )}

        {(collapsed || portfoliosOpen) && portfolios.map((p, idx) => (
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
                <Landmark className="w-4 h-4 shrink-0" />
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
                  className="flex-1 text-left px-1 py-2 text-sm font-medium truncate min-w-0 flex items-center gap-1.5"
                >
                  <span className="truncate">{p.name}</span>
                  {/* Account-type chip, so a mirrored brokerage account is
                      never mistaken for one you maintain by hand. */}
                  {p.broker_account_id != null &&
                    brokerBadges?.[p.broker_account_id] && (
                      <span
                        className={cn(
                          "shrink-0 text-[9px] font-semibold px-1 py-px rounded uppercase tracking-wide",
                          accountKindStyle(
                            brokerBadges[p.broker_account_id].kind,
                          ).chip,
                        )}
                      >
                        {brokerBadges[p.broker_account_id].label}
                      </span>
                    )}
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
                  {p.broker_account_id == null && (
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
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* New portfolio button / input — part of the section, so it hides
            with the list rather than floating under a collapsed header. */}
        {!collapsed && portfoliosOpen && (
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
            choosingKind ? (
              <div className="mt-0.5 rounded-md border border-border bg-card p-1.5 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-0.5">
                  New portfolio
                </p>
                <button
                  onClick={() => {
                    setChoosingKind(false);
                    setCreatingNew(true);
                  }}
                  className="flex items-start gap-2 w-full px-2 py-1.5 rounded text-left hover:bg-accent transition-colors"
                >
                  <PencilLine className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">Manual</span>
                    <span className="block text-[10px] text-muted-foreground leading-snug">
                      You enter the purchases yourself
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setChoosingKind(false);
                    onAddBrokerage?.();
                  }}
                  className="flex items-start gap-2 w-full px-2 py-1.5 rounded text-left hover:bg-accent transition-colors"
                >
                  <Landmark className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">Brokerage</span>
                    <span className="block text-[10px] text-muted-foreground leading-snug">
                      Mirror a broker account, read-only
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => setChoosingKind(false)}
                  className="w-full px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors text-left"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setChoosingKind(true)}
                className="flex items-center gap-2 px-3 py-1.5 mt-0.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full"
              >
                <Plus className="w-3.5 h-3.5" />
                New Portfolio
              </button>
            )
          )
        )}
        {collapsed && (
          <button
            onClick={() => { setChoosingKind(true); }}
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

