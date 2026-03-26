#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import all tool categories
import * as docsTools from "./tools/docs/index.js";
import * as scaffoldTools from "./tools/scaffold/index.js";
import * as blocksTools from "./tools/blocks/index.js";
import * as codegenTools from "./tools/codegen/index.js";
import * as runtimeTools from "./tools/runtime/index.js";
import * as buildTools from "./tools/build/index.js";
import * as assetsTools from "./tools/assets/index.js";
import * as diagnosticsTools from "./tools/diagnostics/index.js";
import * as configTools from "./tools/config/index.js";

// Collect all tool modules for dispatch
const toolModules = [
  docsTools,
  scaffoldTools,
  blocksTools,
  codegenTools,
  runtimeTools,
  buildTools,
  assetsTools,
  diagnosticsTools,
  configTools,
];

// Build a name -> module lookup for fast dispatch
const toolHandlers = new Map<
  string,
  (name: string, args: Record<string, unknown>) => Promise<unknown>
>();

for (const mod of toolModules) {
  for (const tool of mod.tools) {
    toolHandlers.set(tool.name, mod.handleToolCall);
  }
}

// Create MCP server
const server = new Server(
  {
    name: "cinder-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

/**
 * Handler: tools/list
 * Returns all registered tool definitions across every category.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const allTools = toolModules.flatMap((mod) =>
    mod.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );

  return { tools: allTools };
});

/**
 * Handler: tools/call
 * Dispatches to the correct tool module based on tool name.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = toolHandlers.get(name);

  if (!handler) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Unknown tool: ${name}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await handler(name, (args ?? {}) as Record<string, unknown>);

    return {
      content: [
        {
          type: "text" as const,
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server with stdio transport.
 */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Cinder MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting Cinder MCP server:", error);
  process.exit(1);
});
