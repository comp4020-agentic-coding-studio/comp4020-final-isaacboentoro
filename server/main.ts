import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { WebSocketServer } from "ws";
import { createPlayer, playerBySecret, renamePlayer, type Player } from "./db.ts";
import { readmePage, roomPage } from "./pages.ts";
import { boardFor, release, room, type Conn } from "./race.ts";

const PORT = Number(process.env.PORT ?? 8080);
const COOKIE = "racer";
const ROOM = /^[a-z0-9-]{1,24}$/;

// A person is a browser: a random secret in a long-lived cookie, with a name
// they can change. No accounts, no email.
function cookiePlayer(req: IncomingMessage): Player | undefined {
  const m = req.headers.cookie?.match(/(?:^|;\s*)racer=([A-Za-z0-9_-]{43})(?:;|$)/);
  return m ? playerBySecret(m[1]) : undefined;
}

const ADJ = ["quick", "lazy", "brisk", "nimble", "steady", "sly", "bold", "calm", "eager", "swift"];
const NOUN = ["fox", "otter", "wombat", "heron", "magpie", "gecko", "quokka", "lynx", "ibis", "emu"];
const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];

function identify(req: IncomingMessage, res: ServerResponse): Player {
  const known = cookiePlayer(req);
  if (known) return known;
  const { player, secret } = createPlayer(`${pick(ADJ)}-${pick(NOUN)}`);
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${secret}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
  );
  return player;
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\p{C}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20);
  return name.length > 0 ? name : null;
}

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// Static files are read, hashed and gzipped once per version and kept
// (keyed on mtime, so editing under `pnpm dev` still shows up). `no-cache`
// has the browser ask each time, so a deploy shows up at once, but an
// unchanged file costs a 304 rather than the whole thing again.
const cache = new Map<string, { mtime: number; etag: string; raw: Buffer; gz: Buffer }>();

async function serveFile(req: IncomingMessage, res: ServerResponse, root: string, rel: string): Promise<void> {
  const path = normalize(join(root, rel));
  if (!path.startsWith(root + "/") || !TYPES[extname(path)]) return notFound(res);
  let file = cache.get(path);
  try {
    const mtime = (await stat(path)).mtimeMs;
    if (file?.mtime !== mtime) {
      const raw = await readFile(path);
      const etag = `"${createHash("sha1").update(raw).digest("base64url").slice(0, 16)}"`;
      file = { mtime, etag, raw, gz: gzipSync(raw) };
      cache.set(path, file);
    }
  } catch {
    return notFound(res);
  }
  const headers = { "Content-Type": TYPES[extname(path)], "Cache-Control": "no-cache", ETag: file.etag, Vary: "Accept-Encoding" };
  if (req.headers["if-none-match"] === file.etag) {
    res.writeHead(304, headers);
    return void res.end();
  }
  send(req, res, 200, headers, file.raw, file.gz);
}

// Sends a body gzipped when the browser takes it and it's worth the bother.
function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  raw: Buffer,
  gz?: Buffer,
): void {
  const zip = raw.length > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  const body = zip ? (gz ?? gzipSync(raw)) : raw;
  res.writeHead(status, { ...headers, ...(zip ? { "Content-Encoding": "gzip" } : {}), "Content-Length": String(body.length) });
  res.end(req.method === "HEAD" ? undefined : body);
}

function html(res: ServerResponse, body: string, status = 200): void {
  send(res.req, res, status, { "Content-Type": "text/html; charset=utf-8", Vary: "Accept-Encoding" }, Buffer.from(body));
}

function notFound(res: ServerResponse): void {
  html(res, "<!doctype html><title>Not found</title><p>Not found. <a href='/'>Back to the track</a>", 404);
}

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(303, { Location: to });
  res.end();
}

async function body(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 4096) break;
  }
  return data;
}

const publicDir = join(process.cwd(), "public");
const docsDir = join(process.cwd(), "docs");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "POST" && path === "/name") {
      // The no-JavaScript path for renaming; the page itself uses the socket.
      const player = identify(req, res);
      const name = cleanName(new URLSearchParams(await body(req)).get("name"));
      if (name) renamePlayer(player.id, name);
      return redirect(res, req.headers.referer ? new URL(req.headers.referer).pathname : "/");
    }
    if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);

    if (path === "/") {
      const player = identify(req, res);
      return html(res, roomPage("main", player, boardFor(player.id)));
    }
    if (path === "/r") {
      const code = (url.searchParams.get("code") ?? "").toLowerCase().trim();
      return redirect(res, ROOM.test(code) ? `/r/${code}` : "/");
    }
    const r = path.match(/^\/r\/([^/]+)\/?$/);
    if (r) {
      if (!ROOM.test(r[1]) || r[1] === "main") return redirect(res, "/");
      const player = identify(req, res);
      return html(res, roomPage(r[1], player, boardFor(player.id)));
    }
    if (path === "/readme") return redirect(res, "/readme/");
    if (path === "/readme/") return html(res, readmePage());
    // README images are linked relative to the repo root (docs/…), which
    // from /readme/ resolves to /readme/docs/…
    if (path.startsWith("/readme/docs/")) return serveFile(req, res, docsDir, path.slice(13));
    if (path.startsWith("/static/")) return serveFile(req, res, publicDir, path.slice(8));
    if (path === "/api/board") {
      const player = cookiePlayer(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(boardFor(player?.id ?? "")));
    }
    notFound(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) html(res, "<!doctype html><title>Error</title><p>Something broke.", 500);
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const player = cookiePlayer(req);
  const roomId = url.searchParams.get("room") ?? "main";
  if (url.pathname !== "/ws" || !player || !ROOM.test(roomId)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const conn: Conn = { ws, player };
    const r = room(roomId);
    r.add(conn);

    ws.on("message", (data) => {
      let msg: { t?: string; n?: number; c?: unknown; errors?: number; miss?: unknown; name?: string; mode?: unknown };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      // the page times the round trip to line its clock up with ours
      if (msg.t === "ping" && typeof msg.c === "number") ws.send(JSON.stringify({ t: "pong", c: msg.c, s: Date.now() }));
      else if (msg.t === "join") r.join(conn.player);
      else if (msg.t === "leave") r.leave(conn.player);
      else if (msg.t === "ready") r.ready(conn.player);
      else if (msg.t === "mode") r.setMode(msg.mode);
      else if (msg.t === "progress")
        r.progress(conn.player, msg.n as number, msg.errors as number, msg.miss);
      else if (msg.t === "name") {
        const name = cleanName(msg.name);
        if (!name) return;
        renamePlayer(conn.player.id, name);
        conn.player.name = name;
        r.rename(conn.player);
      }
    });

    // A dropped connection can sit half-open for minutes; ping it so the room
    // stops waiting on someone who's gone.
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 15_000);

    ws.on("close", (code) => {
      clearInterval(ping);
      // 1006: no close frame, the connection just dropped (wifi, a sleeping
      // laptop, a pong that never came). Anything else, the page meant to go.
      r.remove(conn, code === 1006);
      release(r);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`keyrace listening on :${PORT}`));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
