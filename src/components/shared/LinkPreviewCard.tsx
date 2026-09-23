import { useContext, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, Play } from "lucide-react";
import { openUrl } from "../../lib/openUrl";
import { LinkOpenModeContext } from "../../lib/linkOpenModeContext";
import type { LinkPreview } from "../../types";

// Module-level so every card for the same URL (and re-mounts as a note
// collapses/expands) shares one fetch, the same pattern TickerLogo uses for
// ticker logos.
const cache = new Map<string, LinkPreview>();
const inFlight = new Map<string, Promise<LinkPreview>>();

function loadPreview(url: string): Promise<LinkPreview> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  let promise = inFlight.get(url);
  if (!promise) {
    promise = invoke<LinkPreview>("fetch_link_preview", { url })
      .then((preview) => {
        cache.set(url, preview);
        return preview;
      })
      .finally(() => inFlight.delete(url));
    inFlight.set(url, promise);
  }
  return promise;
}

function PlainLink({ url }: { url: string }) {
  const linkOpenMode = useContext(LinkOpenModeContext);
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(url, linkOpenMode);
      }}
      className="text-primary underline cursor-pointer break-all"
      contentEditable={false}
      suppressContentEditableWarning
    >
      {url}
    </a>
  );
}

/** Rich card shown in place of a bare URL that occupies its own line in a note. */
export function LinkPreviewCard({ url }: { url: string }) {
  const linkOpenMode = useContext(LinkOpenModeContext);
  const [preview, setPreview] = useState<LinkPreview | null>(cache.get(url) ?? null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
    if (cache.get(url)) {
      setPreview(cache.get(url) ?? null);
      return;
    }
    setPreview(null);
    let cancelled = false;
    loadPreview(url)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(emptyPreview(url));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Nothing back yet (still loading) or nothing usable was found — fall back
  // to a plain hyperlink rather than a card with no content.
  if (!preview || (!preview.title && !preview.thumbnail_data_uri)) {
    return <PlainLink url={url} />;
  }

  if (playing && preview.embed_url) {
    return (
      <div
        className="relative my-1 aspect-video w-full max-w-md overflow-hidden rounded-lg border border-border bg-black"
        contentEditable={false}
        suppressContentEditableWarning
      >
        <iframe
          src={`${preview.embed_url}?autoplay=1`}
          title={preview.title ?? url}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      contentEditable={false}
      suppressContentEditableWarning
      onClick={() => {
        if (preview.embed_url) {
          setPlaying(true);
        } else {
          void openUrl(url, linkOpenMode);
        }
      }}
      className="group my-1 block w-full max-w-md overflow-hidden rounded-lg border border-border bg-background text-left transition-colors hover:border-primary/40"
    >
      {preview.thumbnail_data_uri ? (
        <div className="relative w-full bg-black">
          <img src={preview.thumbnail_data_uri} alt="" className="block h-auto w-full" />
          {preview.embed_url && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
              <Play className="h-10 w-10 fill-white text-white" />
            </div>
          )}
        </div>
      ) : (
        preview.embed_url && (
          <div className="flex aspect-video w-full items-center justify-center bg-muted">
            <Play className="h-10 w-10 text-muted-foreground" />
          </div>
        )
      )}
      <div className="min-w-0 px-3 py-2">
        <div className="truncate text-sm font-medium text-foreground">
          {preview.title ?? url}
        </div>
        {preview.site_name && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {preview.site_name}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{url}</span>
        </div>
      </div>
    </button>
  );
}

function emptyPreview(url: string): LinkPreview {
  return {
    url,
    title: null,
    site_name: null,
    description: null,
    thumbnail_data_uri: null,
    embed_url: null,
  };
}
