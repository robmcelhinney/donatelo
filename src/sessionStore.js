import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createSessionStore(storePath) {
  const state = {
    sessions: {},
  };

  async function load() {
    try {
      const raw = await readFile(storePath, "utf8");
      const parsed = JSON.parse(raw);
      state.sessions = parsed.sessions || {};
    } catch {
      state.sessions = {};
    }
  }

  async function persist() {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify({ sessions: state.sessions }, null, 2)}\n`, "utf8");
  }

  function getRawSession(id) {
    return state.sessions[id] || null;
  }

  async function saveSession(session) {
    state.sessions[session.id] = session;
    await persist();
  }

  async function deleteSession(id) {
    if (!state.sessions[id]) {
      return false;
    }

    delete state.sessions[id];
    await persist();
    return true;
  }

  await load();

  return {
    getRawSession,
    saveSession,
    deleteSession,
  };
}
