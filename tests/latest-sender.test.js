import assert from "node:assert/strict";
import test from "node:test";

import { createLatestSender } from "../extension/lib/latest-sender.js";

function deferred() {
  /** @type {any} */
  const handle = {};
  handle.promise = new Promise((resolve, reject) => {
    handle.resolve = resolve;
    handle.reject = reject;
  });
  return handle;
}

function harness(options = {}) {
  const sends = [];
  const timers = new Map();
  let nextId = 1;
  let abandoned = 0;
  const sender = createLatestSender({
    send: (args) => {
      const reply = deferred();
      sends.push({ args, reply });
      return reply.promise;
    },
    onAbandon: () => {
      abandoned += 1;
    },
    waitMs: 100,
    abandonMs: 1000,
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    ...options
  });
  return {
    sender,
    sends,
    timers,
    get abandoned() {
      return abandoned;
    },
    fire(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms !== ms) continue;
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test("while a send is out only the newest request is kept", async () => {
  const h = harness();
  void h.sender.request("a");
  await h.sender.request("b");
  await h.sender.request("c");
  assert.deepEqual(h.sends.map((send) => send.args), ["a"]);

  h.sends[0].reply.resolve();
  await flush();
  assert.deepEqual(h.sends.map((send) => send.args), ["a", "c"]);
  assert.equal(h.abandoned, 0);
});

test("the caller stops waiting for a stuck receiver", async () => {
  const h = harness();
  let settled = false;
  void h.sender.request("a").then(() => {
    settled = true;
  });
  await flush();
  assert.equal(settled, false);
  h.fire(100);
  await flush();
  assert.equal(settled, true);
});

test("a receiver that never answers is given up on and the newest request goes out", async () => {
  const h = harness();
  void h.sender.request("a");
  void h.sender.request("b");
  h.fire(1000);
  await flush();
  assert.equal(h.abandoned, 1);
  assert.deepEqual(h.sends.map((send) => send.args), ["a", "b"]);

  // The first send answering this late must not release the second one.
  h.sends[0].reply.resolve();
  await flush();
  void h.sender.request("c");
  assert.deepEqual(h.sends.map((send) => send.args), ["a", "b"]);
  h.sends[1].reply.resolve();
  await flush();
  assert.deepEqual(h.sends.map((send) => send.args), ["a", "b", "c"]);
});

test("a rejected or throwing send frees the sender", async () => {
  const h = harness();
  void h.sender.request("a");
  h.sends[0].reply.reject(new Error("no receiver"));
  await flush();
  void h.sender.request("b");
  assert.equal(h.sends.length, 2);

  const throwing = harness({
    send: () => {
      throw new Error("sync");
    }
  });
  await throwing.sender.request("a");
  assert.equal(throwing.timers.size, 0);
});

test("forget drops the send that is out and whatever waited for it", async () => {
  const h = harness();
  void h.sender.request("a");
  void h.sender.request("b");
  h.sender.forget();
  void h.sender.request("c");
  assert.deepEqual(h.sends.map((send) => send.args), ["a", "c"]);
  h.sends[0].reply.resolve();
  await flush();
  assert.equal(h.sends.length, 2);
});

test("settled sends leave no timer behind", async () => {
  const h = harness();
  const done = h.sender.request("a");
  h.sends[0].reply.resolve();
  await done;
  assert.equal(h.timers.size, 0);
});
