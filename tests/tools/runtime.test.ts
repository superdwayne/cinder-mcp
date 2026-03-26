import { describe, it, expect, vi } from "vitest";
import { tools, handleToolCall } from "../../src/tools/runtime/index.js";

describe("Runtime Tools", () => {
  describe("tool definitions", () => {
    it("should export an array of tool definitions", () => {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should define list_apps tool", () => {
      const tool = tools.find((t) => t.name === "list_apps");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("running Cinder apps");
    });

    it("should define connect tool", () => {
      const tool = tools.find((t) => t.name === "connect");
      expect(tool).toBeDefined();
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("port");
    });

    it("should define disconnect tool", () => {
      const tool = tools.find((t) => t.name === "disconnect");
      expect(tool).toBeDefined();
    });

    it("should define status tool", () => {
      const tool = tools.find((t) => t.name === "status");
      expect(tool).toBeDefined();
    });

    it("should define get_scene tool", () => {
      const tool = tools.find((t) => t.name === "get_scene");
      expect(tool).toBeDefined();
    });

    it("should define set_uniform tool", () => {
      const tool = tools.find((t) => t.name === "set_uniform");
      expect(tool).toBeDefined();
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("name");
      expect(required).toContain("value");
    });

    it("should define get_uniforms tool", () => {
      const tool = tools.find((t) => t.name === "get_uniforms");
      expect(tool).toBeDefined();
    });

    it("should define screenshot tool", () => {
      const tool = tools.find((t) => t.name === "screenshot");
      expect(tool).toBeDefined();
    });

    it("should define hot_reload_shader tool", () => {
      const tool = tools.find((t) => t.name === "hot_reload_shader");
      expect(tool).toBeDefined();
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("fragment_path");
    });

    it("should define set_camera tool", () => {
      const tool = tools.find((t) => t.name === "set_camera");
      expect(tool).toBeDefined();
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("eye");
      expect(required).toContain("target");
    });

    it("should define animate_param tool", () => {
      const tool = tools.find((t) => t.name === "animate_param");
      expect(tool).toBeDefined();
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("name");
      expect(required).toContain("target");
      expect(required).toContain("duration");
    });
  });

  describe("tool count", () => {
    it("should have all 21 runtime tools defined", () => {
      const expectedTools = [
        "list_apps",
        "connect",
        "disconnect",
        "status",
        "get_scene",
        "set_uniform",
        "get_uniforms",
        "set_param",
        "get_params",
        "animate_param",
        "screenshot",
        "set_window_size",
        "toggle_fullscreen",
        "set_camera",
        "set_clear_color",
        "set_framerate",
        "set_audio_gain",
        "set_audio_pan",
        "play_audio",
        "stop_audio",
        "get_audio_spectrum",
        "hot_reload_shader",
      ];

      for (const name of expectedTools) {
        expect(
          tools.find((t) => t.name === name),
          `Tool '${name}' should be defined`,
        ).toBeDefined();
      }
    });
  });

  describe("handleToolCall", () => {
    it("should throw for list_apps (not yet implemented)", async () => {
      await expect(handleToolCall("list_apps", {})).rejects.toThrow(
        "not yet implemented",
      );
    });

    it("should throw for set_uniform (not yet implemented)", async () => {
      await expect(
        handleToolCall("set_uniform", { name: "uTime", value: 1.0 }),
      ).rejects.toThrow("not yet implemented");
    });

    it("should throw for screenshot (not yet implemented)", async () => {
      await expect(handleToolCall("screenshot", {})).rejects.toThrow(
        "not yet implemented",
      );
    });

    it("should throw for hot_reload_shader (not yet implemented)", async () => {
      await expect(
        handleToolCall("hot_reload_shader", {
          fragment_path: "/tmp/shader.frag",
        }),
      ).rejects.toThrow("not yet implemented");
    });
  });
});
