import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { ensurePlayer, getPlayer, renamePlayer, type Player } from "./db.ts";
import { readmePage, roomPage } from "./pages.ts";
import { boardFor, release, room, type Conn } from "./race.ts";

const PORT = Number(process.env.PORT ?? 8080);
const COOKIE = "racer";
const ROOM = /^[a-z0-9-]{1,24}$/;

// A person is a browser: an anonymous id in a long-lived cookie, with a name
// they can change. No accounts, no email.
function cookieId(req: IncomingMessage): string | undefined {
  const m = req.headers.cookie?.match(/(?:^|;\s*)racer=([0-9a-f-]{36})/);
  return m?.[1];
}

const ADJ = ["quick", "lazy", "brisk", "nimble", "steady", "sly", "bold", "calm", "eager", "swift"];
const NOUN = ["fox", "otter", "wombat", "heron", "magpie", "gecko", "quokka", "lynx", "ibis", "emu"];
const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];

function identify(req: IncomingMessage, res: ServerResponse): Player {
  const existing = cookieId(req);
  const player = existing && getPlayer(existing);
  if (player) return player;
  const id = existing ?? randomUUID();
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
  );
  return ensurePlayer(id, `${pick(ADJ)}-${pick(NOUN)}`);
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

async function serveFile(res: ServerResponse, root: string, rel: string): Promise<void> {
  const path = normalize(join(root, rel));
  if (!path.startsWith(root + "/") || !TYPES[extname(path)]) return notFound(res);
  try {
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": TYPES[extname(path)], "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    notFound(res);
  }
}

function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
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
    if (path.startsWith("/readme/docs/")) return serveFile(res, docsDir, path.slice(13));
    if (path.startsWith("/static/")) return serveFile(res, publicDir, path.slice(8));
    if (path === "/api/board") {
      const id = cookieId(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(boardFor(id ?? "")));
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
  const id = cookieId(req);
  const player = id && getPlayer(id);
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
      let msg: { t?: string; n?: number; errors?: number; name?: string };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.t === "join") r.join(conn.player);
      else if (msg.t === "leave") r.leave(conn.player);
      else if (msg.t === "progress") r.progress(conn.player, msg.n as number, msg.errors as number);
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

    ws.on("close", () => {
      clearInterval(ping);
      r.remove(conn);
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
