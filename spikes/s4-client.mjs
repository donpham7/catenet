// S4 thin hook client: stdin JSON -> daemon over unix socket -> stdout. Plain JS, node:net only, no deps.
// Fails open: any error or a 250 ms timeout prints nothing and exits 0.
import { connect } from "node:net";

const SOCK = process.argv[2] ?? "data/s4.sock";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  input += c;
});
process.stdin.on("end", () => {
  const timer = setTimeout(() => process.exit(0), 250);
  const sock = connect(SOCK);
  let raw = "";
  sock.setEncoding("utf8");
  sock.on("connect", () => {
    sock.end(
      `POST /hook HTTP/1.1\r\nHost: catenet\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(input)}\r\nConnection: close\r\n\r\n${input}`,
    );
  });
  sock.on("data", (c) => {
    raw += c;
  });
  sock.on("end", () => {
    clearTimeout(timer);
    const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
    if (body && body !== "{}") process.stdout.write(body);
    process.exit(0);
  });
  sock.on("error", () => process.exit(0));
});
