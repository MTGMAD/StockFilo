import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

/** Ask where to save and write the journal CSV. False if cancelled. */
export async function saveJournalCsv(csv: string): Promise<boolean> {
  const path = await save({
    title: "Export Journal",
    defaultPath: "stockfolio-journal.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  await writeTextFile(path, csv);
  return true;
}
