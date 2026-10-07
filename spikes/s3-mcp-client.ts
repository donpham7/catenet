// S3 driver: spawns the stdio server, lists tools, calls find_symbol, measures round trips.
// Run: node s3-mcp-client.ts
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { printTable, summarize } from "./stats.ts";

const CALLS = 200;
const t0 = performance.now();
const client = new Client({ name: "catenet-spike-client", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["s3-mcp-server.ts"] }));
const connectMs = performance.now() - t0;

const tools = await client.listTools();
console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);

const first = await client.callTool({ name: "find_symbol", arguments: { query: "formatCurrency1" } });
console.log(`sample result: ${JSON.stringify(first.content).slice(0, 160)}...`);

const invalid = await client.callTool({ name: "find_symbol", arguments: { query: "" } }).then(
  (r) => `isError=${String(r.isError)}`,
  (e: Error) => `threw: ${e.message.slice(0, 80)}`,
);
console.log(`invalid input (empty query): ${invalid}`);

const times: number[] = [];
for (let i = 0; i < CALLS; i++) {
  const s = performance.now();
  await client.callTool({ name: "find_symbol", arguments: { query: `formatCurrency${i % 500}` } });
  times.push(performance.now() - s);
}
await client.close();

printTable([
  { label: "spawn server + initialize", n: 1, p50: connectMs, p95: connectMs, max: connectMs },
  summarize("tools/call find_symbol round trip", times),
]);
