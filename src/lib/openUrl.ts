import { openExternal as open, invoke, isDesktop } from "./platform";
import type { LinkOpenMode } from "../types";

export async function openUrl(url: string, mode: LinkOpenMode, title?: string) {
  if (isDesktop() && mode === "inapp") {
    await invoke("open_browser_window", { url, title: title ?? "Stockfolio Browser" });
  } else {
    await open(url);
  }
}
