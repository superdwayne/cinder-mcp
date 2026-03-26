import { describe, it, expect } from "vitest";
import { tools, handleToolCall } from "../../src/tools/scaffold/index.js";

describe("Scaffold Tools", () => {
  describe("tool definitions", () => {
    it("should export tool definitions", () => {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should define create_project tool", () => {
      const tool = tools.find((t) => t.name === "create_project");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("Cinder project");
    });

    it("should define configure_build tool", () => {
      const tool = tools.find((t) => t.name === "configure_build");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("CMake");
    });

    it("should define create_from_sample tool", () => {
      const tool = tools.find((t) => t.name === "create_from_sample");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("sample");
    });
  });

  describe("create_project", () => {
    it("should require name and path parameters", () => {
      const tool = tools.find((t) => t.name === "create_project");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("name");
      expect(required).toContain("path");
    });

    it("should accept template parameter", () => {
      const tool = tools.find((t) => t.name === "create_project");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.template).toBeDefined();
      expect(props.template.type).toBe("string");
    });
  });

  describe("configure_build", () => {
    it("should require project_path parameter", () => {
      const tool = tools.find((t) => t.name === "configure_build");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("project_path");
    });

    it("should accept add_sources and add_libraries parameters", () => {
      const tool = tools.find((t) => t.name === "configure_build");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.add_sources).toBeDefined();
      expect(props.add_libraries).toBeDefined();
    });
  });

  describe("create_from_sample", () => {
    it("should require sample_name, name, and path parameters", () => {
      const tool = tools.find((t) => t.name === "create_from_sample");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("sample_name");
      expect(required).toContain("name");
      expect(required).toContain("path");
    });
  });

  describe("handleToolCall", () => {
    it("should return a result string for create_project", async () => {
      const result = await handleToolCall("create_project", {
        name: "TestApp",
        path: "/tmp/cinder-test-" + Date.now(),
      });
      expect(typeof result).toBe("string");
      expect(result).toContain("TestApp");
    });

    it("should return a result string for configure_build", async () => {
      const result = await handleToolCall("configure_build", {
        project_path: "/tmp/nonexistent-path",
      });
      expect(typeof result).toBe("string");
      expect(result).toContain("CMakeLists.txt not found");
    });

    it("should throw zod validation for create_from_sample with missing params", async () => {
      await expect(
        handleToolCall("create_from_sample", {
          sample_name: "BasicApp",
          dest_path: "/tmp/test",
        }),
      ).rejects.toThrow();
    });
  });
});
