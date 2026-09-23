/**
 * Whether this page has the bridge connected - the one thing the service worker asks before it
 * installs an update.
 *
 * The worker (scripts/sw.template.js, `anyPageBusy`) posts `{ type: 'busy?' }` to every open page
 * with a MessagePort, and gives up on the update when any page answers true: nothing is downloaded
 * while a chip is on the other end of the cable, and the browser tries again at its next check.
 * Answered from here rather than pushed from the app, because the worker that asks is a new one the
 * page has never spoken to.
 *
 * useM35080Link sets it on every phase change. A page that never answers (an old build) is treated
 * by the worker as not busy, so this can delay an update but never block updates for good.
 */

let linkBusy = false;

export function setLinkBusy(busy: boolean): void {
  linkBusy = busy;
}

/** Start answering the worker's question. Called once, where the worker is registered. */
export function answerBusyProbes(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'busy?') event.ports[0]?.postMessage(linkBusy);
  });
  // Messages from a worker are held until the page says it is listening.
  navigator.serviceWorker.startMessages();
}
