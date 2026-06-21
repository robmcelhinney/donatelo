import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { createFreshSession } from "../src/session.js";
import { createSessionStore } from "../src/sessionStore.js";

test("session store deletes saved sessions and persists the removal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "donatelo-store-"));
  const storePath = path.join(tempDir, "sessions.json");

  try {
    const store = await createSessionStore(storePath);
    const session = createFreshSession({ start: false });

    await store.saveSession(session);
    assert.ok(store.getRawSession(session.id));

    const deleted = await store.deleteSession(session.id);
    assert.equal(deleted, true);
    assert.equal(store.getRawSession(session.id), null);

    const persisted = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(persisted.sessions[session.id], undefined);

    const reloadedStore = await createSessionStore(storePath);
    assert.equal(reloadedStore.getRawSession(session.id), null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("deleting a missing session returns false", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "donatelo-store-empty-"));
  const storePath = path.join(tempDir, "sessions.json");

  try {
    const store = await createSessionStore(storePath);
    assert.equal(store.getRawSession("missing"), null);
    assert.equal(await store.deleteSession("missing"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
