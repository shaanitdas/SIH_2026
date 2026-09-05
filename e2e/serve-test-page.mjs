import { existsSync, createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageDir = path.join(__dirname, "test-page");
const PORT = Number(process.env.E2E_TEST_PAGE_PORT ?? 3020);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.join(pageDir, pathname);

  if (!filePath.startsWith(pageDir) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": mime[ext] ?? "text/plain" });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e] test page server listening at http://127.0.0.1:${PORT}`);
});