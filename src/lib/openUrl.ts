import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import type { LinkOpenMode } from "../types";

export async function openUrl(url: string, mode: LinkOpenMode, title?: string) {
  if (mode === "inapp") {
    await invoke("open_browser_window", { url, title: title ?? "Stockfolio Browser" });
  } else {
    await open(url);
  }
}
