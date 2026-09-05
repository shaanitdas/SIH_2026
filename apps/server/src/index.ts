import process from "node:process";
import { createApp } from "./app.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 8080);
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const app = createApp({ logging: LOG_LEVEL === "info" });

const server = app.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      type: "startup",
      service: "sih-privacy-planner-v3",
      host: HOST,
      port: PORT,
      logging: LOG_LEVEL,
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        type: "shutdown",
        signal,
      }),
    );
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3500).unref();
  });
}