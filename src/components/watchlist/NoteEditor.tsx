import { useEffect, useRef, useState } from "react";
import {
  $getRoot,
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type RangeSelection,
  type TextFormatType,
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HeadingNode, QuoteNode, $createQuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode, $insertList } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import {
  LinkNode,
  AutoLinkNode,
  $toggleLink,
  autoLinkUrlMatcher,
  autoLinkEmailMatcher,
} from "@lexical/link";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { $setBlocksType } from "@lexical/selection";
import {
  Bold,
  Italic,
  Link2,
  List as ListIcon,
  ListOrdered,
  Code as CodeIcon,
  Quote as QuoteIcon,
} from "lucide-react";
import { openUrl } from "../../lib/openUrl";
import type { LinkOpenMode } from "../../types";
import { cn } from "../../lib/utils";

interface NoteEditorProps {
  initialText: string;
  /** Unix seconds, or null if this note has never been saved. */
  updatedAt: number | null;
  onSave: (text: string) => Promise<void>;
  linkOpenMode: LinkOpenMode;
}

const AUTOSAVE_DELAY_MS = 600;

function timeAgo(unixSeconds: number): string {
  const minutes = Math.floor((Date.now() - unixSeconds * 1000) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

// ── Toolbar ──────────────────────────────────────────────────────────────

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: typeof Bold;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      // Toolbar clicks must not steal focus/selection from the editor —
      // mousedown fires before the editor's own selection would collapse.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none",
        active
          ? "text-primary bg-primary/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

/**
 * Clicking a toolbar button moves focus to the button, which blurs the
 * editor. Lexical's own commands (`FORMAT_TEXT_COMMAND` etc.) fall back to
 * whatever selection last existed, and that generally survives a blur — but
 * a few of the format types used here (block-level ones especially) need an
 * *active* selection at the moment they run, which a blurred editor may no
 * longer have. Tracking the last real selection here and explicitly
 * restoring it inside the same `editor.update()` that applies the format —
 * rather than trusting the ambient selection to still be valid — is the
 * pattern Lexical's own toolbar examples use, and removes that whole class
 * of "the first button I clicked worked, the rest silently did nothing"
 * failure.
 */
function useLastSelection() {
  const [editor] = useLexicalComposerContext();
  const ref = useRef<RangeSelection | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          ref.current = selection.clone();
          setHasSelection(!selection.isCollapsed());
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return { ref, hasSelection };
}

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const { ref: lastSelection, hasSelection } = useLastSelection();
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  function withRestoredSelection(fn: () => void) {
    editor.update(() => {
      if (lastSelection.current) {
        $setSelection(lastSelection.current.clone());
      }
      fn();
    });
  }

  function format(kind: TextFormatType) {
    withRestoredSelection(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.formatText(kind);
    });
  }

  function toggleQuote() {
    withRestoredSelection(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => $createQuoteNode());
    });
  }

  function insertList(ordered: boolean) {
    withRestoredSelection(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $insertList(ordered ? "number" : "bullet");
    });
  }

  function confirmLink() {
    const url = linkUrl.trim();
    setLinkPromptOpen(false);
    setLinkUrl("");
    if (!url) return;
    withRestoredSelection(() => {
      $toggleLink(url);
    });
    // Focus was on the URL input, not the editor — bring it back so typing
    // continues naturally instead of leaving focus stranded on a field that
    // just closed.
    editor.focus();
  }

  return (
    <>
      <div className="flex items-center gap-0.5 rounded-t-md border border-b-0 border-border bg-muted/40 px-1.5 py-1">
        <ToolbarButton icon={Bold} label="Bold" onClick={() => format("bold")} />
        <ToolbarButton icon={Italic} label="Italic" onClick={() => format("italic")} />
        <ToolbarButton icon={CodeIcon} label="Code" onClick={() => format("code")} />
        <ToolbarButton
          icon={Link2}
          label={hasSelection ? "Link" : "Select text first to add a link"}
          disabled={!hasSelection}
          active={linkPromptOpen}
          onClick={() => setLinkPromptOpen((v) => !v)}
        />
        <ToolbarButton
          icon={ListIcon}
          label="Bulleted list"
          onClick={() => insertList(false)}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Numbered list"
          onClick={() => insertList(true)}
        />
        <ToolbarButton icon={QuoteIcon} label="Quote" onClick={toggleQuote} />
      </div>

      {linkPromptOpen && (
        <div className="flex items-center gap-1.5 border border-t-0 border-border bg-muted/20 px-2 py-1.5">
          <input
            autoFocus
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmLink();
              }
              if (e.key === "Escape") {
                setLinkPromptOpen(false);
                setLinkUrl("");
              }
            }}
            placeholder="https://…"
            className="flex-1 min-w-0 text-xs rounded border border-border bg-background px-2 py-1 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={confirmLink}
            disabled={!linkUrl.trim()}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40"
          >
            Add link
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setLinkPromptOpen(false);
              setLinkUrl("");
            }}
            className="text-xs px-2 py-1 rounded text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

// ── Change tracking (word count + debounced autosave) ───────────────────

/**
 * Makes rendered links actually clickable. Lexical's `LinkNode` intentionally
 * does not navigate on click by default — it has to be editable text, not a
 * live hyperlink, while you're typing next to it — so this is required, not
 * optional, for "click a link instead of copy-pasting the URL" to work at
 * all. Deliberately not `@lexical/react`'s `ClickableLinkPlugin`: that one
 * navigates the link directly (`window.open`/anchor click), which inside a
 * desktop app's own webview would try to browse *this app's window* to the
 * URL instead of opening it externally. Routing through `openUrl` matches
 * every other link in Stockfolio and respects the user's browser/in-app
 * preference.
 */
function ClickableLinks({ linkOpenMode }: { linkOpenMode: LinkOpenMode }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      void openUrl(href, linkOpenMode);
    }
    return editor.registerRootListener((rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener("click", handleClick);
      rootElement?.addEventListener("click", handleClick);
    });
  }, [editor, linkOpenMode]);

  return null;
}

function ChangeTracker({
  onText,
}: {
  onText: (markdown: string, plainText: string) => void;
}) {
  return (
    <OnChangePlugin
      onChange={(editorState) => {
        editorState.read(() => {
          const markdown = $convertToMarkdownString(TRANSFORMERS);
          const plainText = $getRoot().getTextContent();
          onText(markdown, plainText);
        });
      }}
    />
  );
}

const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  LinkNode,
  AutoLinkNode,
];

/**
 * Inline note editor — expands directly under a watchlist row, the way notes
 * always have here.
 *
 * This is a genuine WYSIWYG editor (Lexical), not a plain textarea: typing
 * `**bold**` or `- ` for a list converts live, the markdown characters never
 * stay visible, and the toolbar buttons format the current selection
 * immediately — matching a normal rich-text editor rather than a raw
 * markdown source box. Notes are still stored as plain markdown text (via
 * `@lexical/markdown`'s converters), so nothing else in the app — export,
 * sync, the DB column — needed to change.
 *
 * The tradeoff, stated once and not re-litigated per note: a rich editor
 * manages its own DOM/selection on every keystroke, which is a known source
 * of friction with OS-level spellcheck and system text-expansion tools
 * (Cotypist and similar) in a way a plain `<textarea>` never has. Lexical is
 * used here specifically because it has the best track record of the
 * available options for keeping native text services working, but "best
 * track record" is not "guaranteed identical to a textarea."
 */
export function NoteEditor({
  initialText,
  updatedAt,
  onSave,
  linkOpenMode,
}: NoteEditorProps) {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(updatedAt);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(initialText.length);
  const savedMarkdownRef = useRef(initialText);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    const words = initialText.trim() ? initialText.trim().split(/\s+/).length : 0;
    setWordCount(words);
  }, [initialText]);

  async function save(markdown: string) {
    setSaving(true);
    try {
      await onSave(markdown);
      savedMarkdownRef.current = markdown;
      pendingRef.current = null;
      setLastSavedAt(Math.floor(Date.now() / 1000));
    } finally {
      setSaving(false);
    }
  }

  // Flush a pending edit if the row collapses before the debounce fires.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current != null && pendingRef.current !== savedMarkdownRef.current) {
        void onSave(pendingRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleText(markdown: string, plainText: string) {
    setWordCount(plainText.trim() ? plainText.trim().split(/\s+/).length : 0);
    setCharCount(plainText.length);
    if (markdown === savedMarkdownRef.current) return;
    pendingRef.current = markdown;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(markdown), AUTOSAVE_DELAY_MS);
  }

  const initialConfig: InitialConfigType = {
    namespace: "stockfolio-watchlist-note",
    nodes: EDITOR_NODES,
    theme: {
      paragraph: "my-1",
      text: {
        bold: "font-semibold",
        italic: "italic",
        code: "bg-muted rounded px-1 py-0.5 text-[0.8125rem] font-mono",
      },
      list: {
        ul: "list-disc pl-5 my-1",
        ol: "list-decimal pl-5 my-1",
        listitem: "my-0.5",
      },
      quote: "border-l-2 border-border pl-3 my-1 text-muted-foreground",
      link: "text-primary underline cursor-pointer",
    },
    onError(error) {
      console.error("[NoteEditor]", error);
    },
    editorState: () =>
      initialText.trim()
        ? $convertFromMarkdownString(initialText, TRANSFORMERS)
        : $getRoot().append($createParagraphNode()),
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end">
        <span className="text-xs text-muted-foreground">
          {lastSavedAt != null ? `Edited ${timeAgo(lastSavedAt)}` : "No note yet"}
        </span>
      </div>

      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar />
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="w-full min-h-[6rem] rounded-b-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary leading-relaxed"
                aria-placeholder="Add your investment thesis, price targets, catalysts to watch…"
                placeholder={
                  <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
                    Add your investment thesis, price targets, catalysts to watch…
                  </div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <AutoLinkPlugin matchers={[autoLinkUrlMatcher, autoLinkEmailMatcher]} />
          <ClickableLinks linkOpenMode={linkOpenMode} />
          <ChangeTracker onText={handleText} />
        </div>
      </LexicalComposer>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {wordCount} word{wordCount === 1 ? "" : "s"} · {charCount} character
          {charCount === 1 ? "" : "s"}
        </span>
        <span>{saving ? "Saving…" : ""}</span>
      </div>
    </div>
  );
}
