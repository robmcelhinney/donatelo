import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer as createViteServer } from "vite";
import { causes } from "./src/data.js";
import {
  applyAction,
  createFreshSession,
  normalizeSession,
} from "./src/session.js";
import { createSessionStore } from "./src/sessionStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const storeDir = path.join(root, ".donatelo");
const storePath = path.join(storeDir, "sessions.json");
const distDir = path.join(root, "dist");

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

let sessionStore = null;

function getSession(id) {
  const raw = sessionStore?.getRawSession(id);
  if (!raw) {
    return null;
  }
  return normalizeSession(raw);
}

async function saveSession(session) {
  await sessionStore.saveSession(session);
}

async function deleteSession(id) {
  return sessionStore.deleteSession(id);
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/causes") {
    sendJson(res, 200, { causes });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/sessions") {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body." });
      return true;
    }

    const session = createFreshSession({
      start: Boolean(body.start),
      excludedCauseIds: Array.isArray(body.excludedCauseIds) ? body.excludedCauseIds : [],
      customCauses: Array.isArray(body.customCauses) ? body.customCauses : [],
      allocationStyle: body.allocationStyle,
    });
    await saveSession(session);
    sendJson(res, 200, session);
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/actions)?$/);
  if (!sessionMatch) {
    return false;
  }

  const sessionId = decodeURIComponent(sessionMatch[1]);
  const session = getSession(sessionId);

  if (!session) {
    sendJson(res, 404, { error: "Session not found." });
    return true;
  }

  if (req.method === "GET" && pathname === `/api/sessions/${encodeURIComponent(sessionId)}`) {
    sendJson(res, 200, session);
    return true;
  }

  if (req.method === "POST" && pathname === `/api/sessions/${encodeURIComponent(sessionId)}/actions`) {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body." });
      return true;
    }

    const nextSession = applyAction(session, body);
    await saveSession(nextSession);
    sendJson(res, 200, nextSession);
    return true;
  }

  if (req.method === "DELETE" && pathname === `/api/sessions/${encodeURIComponent(sessionId)}`) {
    const deleted = await deleteSession(sessionId);
    if (!deleted) {
      sendJson(res, 404, { error: "Session not found." });
      return true;
    }

    res.writeHead(204, {
      "Cache-Control": "no-store",
    });
    res.end();
    return true;
  }

  sendJson(res, 405, { error: "Method not allowed." });
  return true;
}

function serveStaticFile(req, res, pathname) {
  const resolvedPath = pathname === "/" ? path.join(distDir, "index.html") : path.join(distDir, pathname);
  const safePath = path.normalize(resolvedPath);
  if (!safePath.startsWith(distDir)) {
    return false;
  }

  if (!existsSync(safePath)) {
    return false;
  }

  const extension = path.extname(safePath).toLowerCase();
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  };
  const contentType = contentTypes[extension] || "application/octet-stream";

  readFile(safePath)
    .then((data) => {
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": safePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      });
      res.end(data);
    })
    .catch(() => {
      res.writeHead(404);
      res.end("Not found");
    });
  return true;
}

async function main() {
  sessionStore = await createSessionStore(storePath);

  if (isProduction) {
    const server = http.createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }

      const url = new URL(req.url, `http://${host}:${port}`);
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, pathname);
        if (handled) {
          return;
        }
      }

      if (serveStaticFile(req, res, pathname)) {
        return;
      }

      const indexPath = path.join(distDir, "index.html");
      const html = await readFile(indexPath, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(html);
    });

    server.listen(port, host, () => {
      console.log(`Donatelo running at http://${host}:${port}`);
    });
    return;
  }

  const vite = await createViteServer({
    server: {
      middlewareMode: true,
    },
    appType: "custom",
  });

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const url = new URL(req.url, `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, pathname);
      if (handled) {
        return;
      }
    }

    vite.middlewares(req, res, async () => {
      const html = await vite.transformIndexHtml(pathname, await readFile(path.join(root, "index.html"), "utf8"));
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(html);
    });
  });

  server.listen(port, host, () => {
    console.log(`Donatelo running at http://${host}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
