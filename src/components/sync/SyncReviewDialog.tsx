import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "../../lib/platform";
import type { SyncPreview, SyncResult } from "../../types";

interface Props {
  review: SyncPreview;
  onClose: () => void;
  onReviewChange: (review: SyncPreview) => void;
  onComplete: (result: SyncResult) => void;
}

/** This UI expresses intent; one-use approvals are enforced again in Rust. */
export function SyncReviewDialog({ review, onClose, onReviewChange, onComplete }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [replaceText, setReplaceText] = useState("");
  const [allowEmpty, setAllowEmpty] = useState(false);
  const phrase = review.local.empty ? "UPLOAD EMPTY DATABASE" : "REPLACE REMOTE";
  const requiresPhrase = review.remote_exists || review.local.empty;

  function cancel() {
    void invoke("cancel_sync_review", { confirmationId: review.confirmation_id }).catch(() => {});
    onClose();
  }
  async function transfer(direction: "upload" | "download") {
    setBusy(true); setError(null);
    try {
      const result = await invoke<SyncResult>("confirm_sync", { confirmationId: review.confirmation_id, direction, allowEmptyUpload: allowEmpty });
      onComplete(result);
    } catch (error) { setError(String(error)); setNeedsRefresh(true); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError(null);
    try {
      const result = review.restore
        ? await invoke<SyncResult>("prepare_restore_backup", { backupId: review.target_id.slice("backup:".length) })
        : await invoke<SyncResult>("sync_now", { targetId: review.target_id });
      if (result.confirmation) onReviewChange(result.confirmation);
      else onComplete(result);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !busy) cancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }} className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background text-foreground p-6 shadow-xl space-y-4">
          <Dialog.Title className="text-lg font-semibold">{review.restore ? "Restore a recovery backup" : review.first_sync ? "Choose your first sync source" : "Review database changes"}</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            {review.target_label}. No database has been replaced. Choose which copy to use; a verified backup is required before replacement.
          </Dialog.Description>
          {review.conflict && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">Both copies changed since the last transfer. Records are not merged automatically. Review both copies before choosing.</p>}
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">Compare records before choosing a sync direction</caption>
            <thead><tr className="border-b border-border"><th className="text-left py-2">Records</th><th>This device</th><th>{review.restore ? "Backup" : "Remote"}</th></tr></thead>
            <tbody>
              {([
                ["Financial records", "financial_records"], ["Portfolios", "portfolios"],
                ["Watchlist items", "watchlist_items"], ["Journal notes", "notes"],
              ] as const).map(([label, key]) => <tr key={key} className="border-b border-border"><td className="py-2">{label}</td><td className="text-center">{review.local[key]}</td><td className="text-center">{review.remote?.[key] ?? "No database"}</td></tr>)}
            </tbody>
          </table>
          {review.local.empty && <p className="text-sm text-amber-700 dark:text-amber-400">This device has no financial records, notes, or watchlist items. Loading your remote database is recommended when it contains your records.</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {needsRefresh ? <button disabled={busy} onClick={() => void refresh()} className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50">Refresh review</button> : <>
            {review.remote_exists && <div className="space-y-2 rounded-lg border border-primary/40 p-3">
              <p className="text-sm">Loading this copy replaces this device’s records. A local recovery backup will be saved first.</p>
              <button disabled={busy} onClick={() => void transfer("download")} className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50">{busy ? "Working…" : review.restore ? "Restore this backup" : "Load remote database"}</button>
            </div>}
            {!review.restore && <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm">{review.remote_exists ? "Uploading replaces the existing remote database. A recovery copy will be saved before replacement." : "No remote database exists. Uploading creates one from this device’s records."}</p>
              {review.upload_blocked_reason && <p className="text-sm text-amber-700 dark:text-amber-400">{review.upload_blocked_reason}</p>}
              {review.upload_allowed && <>
                {requiresPhrase && <label className="block text-sm">Type <strong>{phrase}</strong> to approve this upload.
                  <input aria-label="Upload confirmation" value={replaceText} onChange={event => setReplaceText(event.target.value)} disabled={busy} autoComplete="off" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
                </label>}
                {review.local.empty && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowEmpty} onChange={event => setAllowEmpty(event.target.checked)} disabled={busy} className="mt-1" />I explicitly approve uploading this empty database.</label>}
                <button disabled={busy || (requiresPhrase && replaceText !== phrase) || (review.local.empty && !allowEmpty)} onClick={() => void transfer("upload")} className="px-4 py-2 rounded-md border border-red-400 text-red-600 disabled:opacity-40">Upload this device</button>
              </>}
            </div>}
          </>}
          <p className="text-xs text-muted-foreground">Approval expires after 10 minutes and cannot be reused. Background checks never replace either database.</p>
          <button disabled={busy} onClick={cancel} className="px-4 py-2 rounded-md border border-border disabled:opacity-40">Cancel</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
