/**
 * Dev launcher — starts Next.js, the worker API, and the worker process
 * in parallel from a single `node server/dev.js` command.
 *
 * Features:
 *   - Colored, prefixed output per process
 *   - Ctrl+C kills all three cleanly
 *   - No external dependencies (Node.js built-ins only)
 */

import { spawn } from "child_process";

const RESET  = "\x1b[0m";
const COLORS = {
  next:   "\x1b[36m", // cyan
  api:    "\x1b[33m", // yellow
  worker: "\x1b[32m", // green
};

const processes = [
  { name: "next",   cmd: "node", args: ["node_modules/.bin/next", "dev"] },
  { name: "api",    cmd: "node", args: ["server/api.js"] },
  { name: "worker", cmd: "node", args: ["server/worker.js"] },
];

const children = [];

function prefix(name) {
  const color = COLORS[name] ?? RESET;
  const label = `[${name}]`.padEnd(10);
  return `${color}${label}${RESET} `;
}

function pipe(name, stream) {
  stream.setEncoding("utf8");
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop(); // keep incomplete line in buffer
    for (const line of lines) {
      process.stdout.write(prefix(name) + line + "\n");
    }
  });
  stream.on("end", () => {
    if (buf) process.stdout.write(prefix(name) + buf + "\n");
  });
}

for (const { name, cmd, args } of processes) {
  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  pipe(name, child.stdout);
  pipe(name, child.stderr);

  child.on("exit", (code, signal) => {
    if (signal !== "SIGTERM" && signal !== "SIGINT") {
      process.stdout.write(
        prefix(name) + `exited with code ${code ?? signal}\n`
      );
    }
  });

  children.push(child);
}

function shutdown() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
