import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import type { NewsArticle } from "../../types";
import { fetchNews } from "../../lib/db";
import { Newspaper, ExternalLink, Loader2 } from "lucide-react";

interface TickerNewsProps {
  ticker: string;
}

export function TickerNews({ ticker }: TickerNewsProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchNews(ticker, 4)
      .then((a) => {
        if (!cancelled) setArticles(a);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  async function openArticle(url: string) {
    await open(url);
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <Newspaper className="w-4 h-4" />
        Recent News
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading news…
        </div>
      ) : error ? (
        <p className="text-sm text-muted-foreground py-2">Unable to load news.</p>
      ) : articles.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No recent news found for {ticker}.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {articles.map((article, i) => (
            <button
              key={i}
              onClick={() => openArticle(article.url)}
              className="flex gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/50 transition-colors text-left group"
            >
              {/* Thumbnail */}
              <div className="w-20 h-20 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                {article.image_url ? (
                  <img
                    src={article.image_url}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                    }}
                  />
                ) : null}
                <Newspaper
                  className={`w-6 h-6 text-muted-foreground ${article.image_url ? "hidden" : ""}`}
                />
              </div>

              {/* Text */}
              <div className="flex flex-col min-w-0 flex-1 gap-1">
                <span className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                  {article.title}
                </span>
                <div className="flex items-center gap-1.5 mt-auto">
                  {article.publisher && (
                    <span className="text-xs text-muted-foreground truncate">
                      {article.publisher}
                    </span>
                  )}
                  <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
