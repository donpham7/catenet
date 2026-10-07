// S3: minimal stdio MCP server on @modelcontextprotocol/server v2 with one bounded, read-only tool.
// stdout carries JSON-RPC, so every log line goes to stderr.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const SYMBOLS = Array.from({ length: 500 }, (_, i) => ({
  name: `formatCurrency${i}`,
  path: `src/lib/f${i}.ts`,
  line: i + 1,
}));
const MAX_RESULTS = 20;

const server = new McpServer({ name: "catenet-spike", version: "0.0.0" });

server.registerTool(
  "find_symbol",
  {
    description:
      "Locate symbol definitions by name substring. Returns at most 20 matches; narrow the query if truncated.",
    inputSchema: z.object({ query: z.string().min(1).max(200) }),
  },
  async ({ query }) => {
    const matches = SYMBOLS.filter((s) => s.name.includes(query));
    const result = { matches: matches.slice(0, MAX_RESULTS), truncated: matches.length > MAX_RESULTS };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

console.error("catenet-spike MCP server ready on stdio");
await server.connect(new StdioServerTransport());
