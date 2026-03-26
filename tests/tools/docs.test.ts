import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock better-sqlite3 before importing the module
vi.mock("better-sqlite3", () => {
  const mockStatement = {
    all: vi.fn(),
    get: vi.fn(),
    run: vi.fn(),
  };

  const mockDb = {
    prepare: vi.fn(() => mockStatement),
    exec: vi.fn(),
    close: vi.fn(),
  };

  return {
    default: vi.fn(() => mockDb),
    __mockDb: mockDb,
    __mockStatement: mockStatement,
  };
});

import { tools, handleToolCall } from "../../src/tools/docs/index.js";

describe("Documentation Tools", () => {
  describe("tool definitions", () => {
    it("should export an array of tool definitions", () => {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should define search_docs tool", () => {
      const tool = tools.find((t) => t.name === "search_docs");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should define get_class tool", () => {
      const tool = tools.find((t) => t.name === "get_class");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should define get_namespace tool", () => {
      const tool = tools.find((t) => t.name === "get_namespace");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should define list_categories tool", () => {
      const tool = tools.find((t) => t.name === "list_categories");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should have required fields in each tool definition", () => {
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });

  describe("search_docs", () => {
    it("should require a query parameter", () => {
      const tool = tools.find((t) => t.name === "search_docs");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("query");
    });
  });

  describe("get_class", () => {
    it("should require a class_name parameter", () => {
      const tool = tools.find((t) => t.name === "get_class");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("class_name");
    });
  });

  describe("get_namespace", () => {
    it("should require a namespace parameter", () => {
      const tool = tools.find((t) => t.name === "get_namespace");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("namespace");
    });
  });

  describe("list_categories", () => {
    it("should have no required parameters", () => {
      const tool = tools.find((t) => t.name === "list_categories");
      const required = tool!.inputSchema.required as string[];
      expect(required).toHaveLength(0);
    });
  });

  describe("handleToolCall", () => {
    it("should return a string for search_docs", async () => {
      const result = await handleToolCall("search_docs", { query: "texture" });
      expect(typeof result).toBe("string");
    });

    it("should return a string for unknown tool names", async () => {
      const result = await handleToolCall("nonexistent_tool", {});
      expect(typeof result).toBe("string");
      expect(result).toContain("Unknown docs tool");
    });
  });
});
