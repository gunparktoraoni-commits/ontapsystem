/**
 * Shared visibility signal so layout FABs can hide while any messenger panel is open.
 * Uses a reference count because multiple ConnectionMessengerPanel instances can mount.
 */

export const MESSENGER_VISIBILITY_EVENT = "ontap:messenger-visibility";

let openMessengerPanels = 0;

function publishMessengerVisibility(): void {
  if (typeof window === "undefined") return;
  const open = openMessengerPanels > 0;
  window.dispatchEvent(
    new CustomEvent(MESSENGER_VISIBILITY_EVENT, {
      detail: { open },
    }),
  );
  if (open) {
    document.body.dataset.ontapMessengerOpen = "1";
  } else {
    delete document.body.dataset.ontapMessengerOpen;
  }
}

/** Call when a messenger panel opens or closes. Returns an optional cleanup for unmount. */
export function setMessengerPanelOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  openMessengerPanels = Math.max(0, openMessengerPanels + (open ? 1 : -1));
  publishMessengerVisibility();
}

export function isMessengerPanelOpen(): boolean {
  return openMessengerPanels > 0;
}
