import { hasOpenModal, popupOwnsEscape } from './modalDialog';
import { isEditingField } from './shortcuts';

/**
 * Keys for a view shown over the plan (wall elevation, section): Escape closes it. Registered
 * in the capture phase so the plan canvas's own window-level Escape handling does not also
 * fire. `onHistoryKey` runs on Ctrl/Cmd+Z or +Y before the plan's bubbling history handler
 * (text fields keep their own native Undo/Redo). Returns the cleanup.
 */
export function listenSideViewKeys(close: () => void, onHistoryKey?: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (hasOpenModal()) return;
    if (onHistoryKey && !isEditingField(e.target) && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) onHistoryKey();
    if (e.key === 'Escape') {
      // A focused field or an open menu or panel takes Escape first (see keepFromPlan).
      if (isEditingField(e.target) || popupOwnsEscape(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  };
  // Escape left to a field, menu or panel still stops short of the plan canvas:
  // document bubbling runs before its window-level handler.
  const keepFromPlan = (e: KeyboardEvent) => { if (e.key === 'Escape' && !hasOpenModal()) e.stopPropagation(); };
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('keydown', keepFromPlan);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keydown', keepFromPlan);
  };
}
