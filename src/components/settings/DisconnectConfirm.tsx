import { useState } from "react";

interface DisconnectConfirmProps {
  label: string;
  /** Already disconnected: the only thing left to do is delete it. */
  archived: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

/**
 * Disconnecting keeps history by default. Deleting is a separate, second step
 * because a brokerage may never hand the same history back on reconnect.
 */
export function DisconnectConfirm({
  label,
  archived,
  onArchive,
  onDelete,
  onCancel,
}: DisconnectConfirmProps) {
  const [deleting, setDeleting] = useState(archived);

  if (deleting) {
    return (
      <div className="rounded-md border border-negative/30 bg-negative/10 p-2.5 space-y-2">
        <p className="text-xs text-foreground">
          Permanently delete {label}, its portfolio and every transaction
          synced from it? Your brokerage may not provide this history again.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="px-2.5 py-1 rounded-md bg-negative text-white text-xs font-medium hover:opacity-90"
          >
            Delete permanently
          </button>
          <button
            type="button"
            onClick={archived ? onCancel : () => setDeleting(false)}
            className="btn-secondary text-xs"
          >
            {archived ? "Cancel" : "Back"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-2.5 space-y-2">
      <p className="text-xs text-foreground">
        Disconnect {label}? Its keys are removed from this device and it stops
        syncing. The portfolio and its full history stay, and reconnecting
        picks up where it left off.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onArchive} className="btn-primary text-xs">
          Disconnect, keep history
        </button>
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="btn-secondary text-xs text-negative"
        >
          Delete everything…
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}
