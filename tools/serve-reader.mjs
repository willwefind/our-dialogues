import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
// The port stays fixed on purpose: the IndexedDB text library is scoped to
// origin (host + port), so hopping to a free port would open an empty library.
const port = Number(process.env.OUR_DIALOGUES_PORT || 4173);
const url = `http://${host}:${port}/`;
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

function localPath(requestURL) {
  const pathname = decodeURIComponent(new URL(requestURL || "/", url).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

const server = createServer(async (request, response) => {
  const filename = localPath(request.url);
  if (!filename) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const details = await stat(filename);
    if (!details.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": types.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(filename).pipe(response);
  } catch (_) {
    response.writeHead(404).end("Not found");
  }
});

function openBrowser() {
  if (!process.argv.includes("--open") || process.platform !== "win32") return;
  const child = spawn("cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    // Node's default quoting turns the inner quotes into \" which cmd.exe
    // cannot parse, so start never runs; the line must arrive verbatim.
    windowsVerbatimArguments: true
  });
  child.unref();
}

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.log(`Port ${port} is already in use — most likely the Reader is already running at ${url}; opening it.`);
    console.log("If the page that opens is not Our Dialogues, close the other program or set OUR_DIALOGUES_PORT to another port.");
    openBrowser();
    return;
  }
  console.error(`Our Dialogues could not start: ${error?.message || error}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Our Dialogues Reader is running at ${url}`);
  console.log("Keep this window open while reading. Press Ctrl+C to stop.");
  openBrowser();
});
