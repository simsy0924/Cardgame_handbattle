import { createHttpServer } from "./http-server.mjs";
import { MatchStore } from "./game-store.mjs";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const store = new MatchStore();
const server = createHttpServer({ store });

server.listen(port, host, () => {
  console.log("Hand Battle AI duel server listening on " + host + ":" + port);
});

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", close);
process.on("SIGINT", close);
