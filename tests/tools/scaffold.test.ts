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

    it("should accept generator and build_type parameters", () => {
      const tool = tools.find((t) => t.name === "configure_build");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.generator).toBeDefined();
      expect(props.build_type).toBeDefined();
    });
  });

  describe("create_from_sample", () => {
    it("should require sample_name and dest_path parameters", () => {
      const tool = tools.find((t) => t.name === "create_from_sample");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("sample_name");
      expect(required).toContain("dest_path");
    });
  });

  describe("handleToolCall", () => {
    it("should throw for create_project (not yet implemented)", async () => {
      await expect(
        handleToolCall("create_project", {
          name: "TestApp",
          path: "/tmp/test",
        }),
      ).rejects.toThrow("not yet implemented");
    });

    it("should throw for configure_build (not yet implemented)", async () => {
      await expect(
        handleToolCall("configure_build", {
          project_path: "/tmp/test",
        }),
      ).rejects.toThrow("not yet implemented");
    });

    it("should throw for create_from_sample (not yet implemented)", async () => {
      await expect(
        handleToolCall("create_from_sample", {
          sample_name: "BasicApp",
          dest_path: "/tmp/test",
        }),
      ).rejects.toThrow("not yet implemented");
    });
  });
});
