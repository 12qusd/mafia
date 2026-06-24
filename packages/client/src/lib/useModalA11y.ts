/**
 * Modal accessibility hook (WCAG 2.1 / ARIA Authoring Practices dialog pattern).
 *
 * Given a ref to the dialog element and an `open` flag, this:
 *   (a) moves focus into the dialog when it opens (first focusable, or the dialog
 *       itself if it has none),
 *   (b) traps Tab / Shift+Tab focus within the dialog while open,
 *   (c) closes on Escape (calls `onClose`),
 *   (d) restores focus to the element that was focused before the dialog opened
 *       (typically the trigger) on close.
 *
 * It is intentionally tiny and dependency-free so every overlay (Glossary,
 * QuickPlay, mobile nav drawer, confirm modals) can share one correct
 * implementation. Pure client UI; no game state.
 */

import { useEffect, type RefObject } from 'react';

/** CSS selector for the natively focusable / tabbable elements in a dialog. */
const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), ' +
  '[contenteditable="true"]';

function isVisible(el: HTMLElement): boolean {
  // Cheap, jsdom-safe visibility check. We avoid relying on `offsetParent`
  // (always null under jsdom, which has no layout) and instead skip elements
  // explicitly removed from flow (the `hidden` attr or display/visibility:none).
  if (el.hidden) return false;
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return true;
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

export interface ModalA11yOptions {
  /** Called when Escape is pressed inside the dialog. */
  onClose: () => void;
  /**
   * Optional element to focus first when the dialog opens (e.g. a search field).
   * When omitted, the first focusable element (or the dialog itself) is used.
   */
  initialFocus?: RefObject<HTMLElement>;
}

/**
 * Wire up focus management for a dialog. Apply `role="dialog"` / `aria-modal` /
 * a label on the same element you pass via `ref` at the call site.
 */
export function useModalA11y(
  ref: RefObject<HTMLElement>,
  open: boolean,
  { onClose, initialFocus }: ModalA11yOptions,
): void {
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;

    // Remember what had focus so we can restore it on close (the trigger).
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog after paint.
    const focusFirst = () => {
      if (initialFocus?.current) {
        initialFocus.current.focus();
        return;
      }
      const focusables = focusableWithin(dialog);
      if (focusables.length > 0) focusables[0]!.focus();
      else {
        // No focusable child — make the dialog itself focusable and focus it so
        // the trap has an anchor and the SR announces the dialog.
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        dialog.focus();
      }
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = focusableWithin(dialog);
      if (focusables.length === 0) {
        // Nothing tabbable: keep focus pinned on the dialog.
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to the trigger if it is still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, ref, onClose, initialFocus]);
}
