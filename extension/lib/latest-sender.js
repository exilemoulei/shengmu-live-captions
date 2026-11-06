/**
 * Sends state to one receiver that may be slow or stuck, one message at a time.
 *
 * chrome.tabs.sendMessage settles only when the receiving page has run its
 * listener, so a page whose main thread is busy holds the caller for as long as
 * it stays busy, and one that never recovers holds it for good. Caption state is
 * a snapshot: while a send is out, only the newest request is worth keeping.
 *
 * `send` reads the state itself when it runs, so a request that waited still
 * delivers the current state and a delta sequence stays contiguous.
 *
 * Pure: timers are injected.
 */

/** How long a caller waits for the receiver before it moves on. */
export const SENDER_WAIT_MS = 1500;
/** A receiver silent for this long gets a fresh start once it answers again. */
export const SENDER_ABANDON_MS = 15000;

/**
 * @template T
 * @param {{
 *   send: (args: T) => unknown,
 *   onAbandon?: () => void,
 *   waitMs?: number,
 *   abandonMs?: number,
 *   setTimeout?: (callback: () => void, ms: number) => any,
 *   clearTimeout?: (handle: any) => void
 * }} options `onAbandon` runs when a send is given up on, before the next one:
 *   the receiver may have missed it, so the next message has to stand alone.
 */
export function createLatestSender({
  send,
  onAbandon = () => {},
  waitMs = SENDER_WAIT_MS,
  abandonMs = SENDER_ABANDON_MS,
  setTimeout: setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimeout: clearTimer = globalThis.clearTimeout.bind(globalThis)
}) {
  /** @type {object | null} identifies the send that is out */
  let inFlight = null;
  /** @type {{ args: T } | null} */
  let queued = null;

  function drain() {
    if (!queued) return;
    const { args } = queued;
    queued = null;
    void start(args);
  }

  /**
   * @param {T} args
   * @returns {Promise<void>} settles when the receiver answered or was given up on.
   */
  function start(args) {
    const token = {};
    inFlight = token;
    return new Promise((resolve) => {
      const abandonTimer = setTimer(() => {
        if (inFlight !== token) return;
        inFlight = null;
        onAbandon();
        resolve();
        drain();
      }, abandonMs);
      const settled = () => {
        clearTimer(abandonTimer);
        // An answer after the give-up belongs to a send nobody waits for.
        if (inFlight !== token) return;
        inFlight = null;
        resolve();
        drain();
      };
      let result;
      try {
        result = send(args);
      } catch {
        settled();
        return;
      }
      Promise.resolve(result).then(settled, settled);
    });
  }

  return {
    /**
     * Sends now, or replaces whatever waits for the send that is out.
     * @param {T} args
     * @returns {Promise<void>} never rejects, and settles within `waitMs`.
     */
    request(args) {
      if (inFlight) {
        queued = { args };
        return Promise.resolve();
      }
      const finished = start(args);
      return new Promise((resolve) => {
        const waitTimer = setTimer(resolve, waitMs);
        void finished.then(() => {
          clearTimer(waitTimer);
          resolve();
        });
      });
    },

    /** The receiver was replaced: the send that is out no longer matters. */
    forget() {
      inFlight = null;
      queued = null;
    }
  };
}
