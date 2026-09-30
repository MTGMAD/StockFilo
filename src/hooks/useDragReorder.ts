import { useRef, useState } from "react";

/** Movement before a press becomes a drag, so a plain click still selects
 *  the row — same threshold Sidebar's portfolio drag-reorder uses. */
const DRAG_THRESHOLD_PX = 4;

/**
 * Pointer-based drag-to-reorder for a list of string ids, generalized from
 * Sidebar.tsx's portfolio drag-reorder so the positions list's several
 * sections (favorites, stocks, funds, bonds) can each get their own
 * independent instance. Pointer events rather than HTML5 drag-and-drop:
 * Tauri's webview can claim native drag events for its own file-drop
 * handling.
 */
export function useDragReorder(ids: string[], onDrop: (newIds: string[]) => void) {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const suppressClickRef = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  function insertionIndex(clientY: number): number {
    for (let i = 0; i < ids.length; i++) {
      const el = rowRefs.current.get(ids[i]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return ids.length;
  }

  /** Dropping a row directly above or below itself changes nothing. */
  function isNoopDrop(id: string, target: number): boolean {
    const from = ids.indexOf(id);
    return target === from || target === from + 1;
  }

  function startRowPress(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    const startY = e.clientY;
    let active = false;
    let target: number | null = null;

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
        active = true;
        setDragId(id);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      target = insertionIndex(ev.clientY);
      setDropIndex(target);
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (active) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (commit && target != null && !isNoopDrop(id, target)) {
          const from = ids.indexOf(id);
          const next = [...ids];
          next.splice(from, 1);
          next.splice(target > from ? target - 1 : target, 0, id);
          onDrop(next);
        }
      }
      setDragId(null);
      setDropIndex(null);
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  const showDropLine = (idx: number) =>
    dragId != null && dropIndex === idx && !isNoopDrop(dragId, idx);

  return {
    rowRefs,
    dragId,
    startRowPress,
    showDropLine,
    suppressClickRef,
  };
}
