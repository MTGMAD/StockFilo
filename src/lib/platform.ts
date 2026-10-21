/** Native IPC on desktop; the local Rust backend when opened in a browser. */
import { invoke as nativeInvoke, isTauri } from "@tauri-apps/api/core";
import { open as nativeOpen, save as nativeSave } from "@tauri-apps/plugin-dialog";
import * as nativeFs from "@tauri-apps/plugin-fs";
import { open as nativeOpenExternal } from "@tauri-apps/plugin-shell";
import * as nativeNotifications from "@tauri-apps/plugin-notification";

export const isDesktop = () => isTauri();

export async function invoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isDesktop()) return nativeInvoke<T>(command, args);
  let response: Response;
  try {
    response = await fetch(`/api/command/${encodeURIComponent(command)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Stockfolio-Client": "browser" },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error("Cannot reach Stockfolio. Start the local Stockfolio app and reconnect.");
  }
  const text = await response.text();
  let payload: { result?: T; error?: string };
  try { payload = JSON.parse(text); }
  catch { throw new Error("The Stockfolio backend is unavailable. Start the local app and reload this page."); }
  if (!response.ok || payload.error) throw new Error(payload.error ?? `Stockfolio request failed (${response.status})`);
  return payload.result as T;
}

type DialogOptions = { title?: string; directory?: boolean; multiple?: boolean; filters?: { name: string; extensions: string[] }[] };
const uploads = new Map<string, File>();
const downloads = new Map<string, string>();
let fileId = 0;

export async function openDialog(options: DialogOptions = {}): Promise<string | string[] | null> {
  if (isDesktop()) return nativeOpen(options);
  if (options.directory) return invoke<string | null>("choose_directory", { title: options.title });
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple ?? false;
    input.accept = options.filters?.flatMap(f => f.extensions.map(ext => `.${ext}`)).join(",") ?? "";
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const paths = Array.from(input.files ?? []).map(file => {
        const id = `upload:${++fileId}`;
        uploads.set(id, file);
        return id;
      });
      resolve(options.multiple ? paths : paths[0] ?? null);
    };
    input.click();
  });
}

export async function save(options: Parameters<typeof nativeSave>[0] = {}): Promise<string | null> {
  if (isDesktop()) return nativeSave(options);
  const id = `download:${++fileId}`;
  downloads.set(id, options?.defaultPath?.split(/[/\\]/).pop() ?? "stockfolio-export");
  return id;
}

export async function readFile(path: string): Promise<Uint8Array> {
  if (isDesktop()) return nativeFs.readFile(path);
  const file = uploads.get(path);
  if (!file) throw new Error("Please select the file again.");
  uploads.delete(path);
  return new Uint8Array(await file.arrayBuffer());
}
export async function readTextFile(path: string): Promise<string> {
  if (isDesktop()) return nativeFs.readTextFile(path);
  return new TextDecoder().decode(await readFile(path));
}
export async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  if (isDesktop()) return nativeFs.writeFile(path, bytes);
  const name = downloads.get(path);
  if (!name) throw new Error("Please export the file again.");
  downloads.delete(path);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function writeTextFile(path: string, text: string): Promise<void> {
  if (isDesktop()) return nativeFs.writeTextFile(path, text);
  return writeFile(path, new TextEncoder().encode(text));
}
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) return nativeOpenExternal(url);
  const parsed = new URL(url);
  if (!["http:", "https:", "mailto:", "webcal:"].includes(parsed.protocol)) throw new Error("Unsupported link type");
  window.open(url, "_blank", "noopener,noreferrer");
}
export async function isPermissionGranted(): Promise<boolean> {
  if (isDesktop()) return nativeNotifications.isPermissionGranted();
  return "Notification" in window && Notification.permission === "granted";
}
export async function requestPermission() {
  if (isDesktop()) return nativeNotifications.requestPermission();
  return "Notification" in window ? Notification.requestPermission() : "denied" as const;
}
export function sendNotification(options: Parameters<typeof nativeNotifications.sendNotification>[0]): void {
  if (isDesktop()) { nativeNotifications.sendNotification(options); return; }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (typeof options === "string") new Notification(options);
  else new Notification(options.title ?? "Stockfolio", { body: options.body });
}
