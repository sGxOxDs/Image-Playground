import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import httpServer from "http-server";
import { frameAncestors } from "../app/lib/plugin-origins.server.ts";

const root = new URL("../build-static/client/", import.meta.url);
await access(new URL("index.html", root));

function port(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("Invalid local port.");
  return parsed;
}

const frontendPort = port(process.env.IMAGE_STUDIO_STATIC_PORT ?? "8080");
const hosts = [`127.0.0.1:${frontendPort}`, `localhost:${frontendPort}`];
const server = httpServer.createServer({
  root: fileURLToPath(root),
  cache: -1,
  showDir: "false",
  headers: { "Content-Security-Policy": frameAncestors() },
  before: [(request, response) => {
    if (hosts.includes(request.headers.host)) {
      if ((request.method === "GET" || request.method === "HEAD") && request.url === "/") {
        response.writeHead(302, { Location: "/Image-Playground/" });
        response.end();
        return;
      }
      if (request.url === "/Image-Playground" || request.url.startsWith("/Image-Playground/")) {
        request.url = request.url.slice("/Image-Playground".length) || "/";
      }
      if ((request.method === "GET" || request.method === "HEAD") && request.url === "/api/plugin-manifest") {
        request.url = "/workspace/plugin-manifest.json";
      }
      response.emit("next");
      return;
    }
    response.statusCode = 403;
    response.end("Forbidden");
  }],
});

server.listen(frontendPort, "127.0.0.1", () => {
  console.log(`Image Studio: http://127.0.0.1:${frontendPort}`);
});
