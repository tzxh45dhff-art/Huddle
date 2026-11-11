/** Optional isolated two-browser QA. Synthetic accounts; credentials stay in process memory. */
import { createServer } from "node:http";
import { startServer, makeUser, makeRoom } from "../../server/test/harness.js";
const api = await startServer();
const alex = await makeUser(api.base, "DemoAlex"),
  sam = await makeUser(api.base, "DemoSam");
const room = await makeRoom(api.base, alex, sam);
const server = createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin !== "http://127.0.0.1:5182") {
    res.writeHead(403);
    res.end();
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  const user = req.url === "/alex" ? alex : req.url === "/sam" ? sam : null;
  if (!user) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.end(
    JSON.stringify({
      base: api.base.replace("127.0.0.1", "localhost"),
      user,
      roomId: room.id,
    }),
  );
});
server.listen(5190, "127.0.0.1", () =>
  console.log("Synthetic two-browser QA ready on localhost:5190"),
);
const stop = () => {
  server.close();
  void api.stop().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
