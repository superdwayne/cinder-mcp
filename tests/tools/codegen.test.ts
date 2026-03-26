import { describe, it, expect } from "vitest";
import { tools, handleToolCall } from "../../src/tools/codegen/index.js";

describe("Codegen Tools", () => {
  describe("tool definitions", () => {
    it("should export 8 tool definitions", () => {
      expect(tools).toHaveLength(8);
    });

    it("should define generate_shader tool", () => {
      const tool = tools.find((t) => t.name === "generate_shader");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("shader");
    });

    it("should define generate_batch tool", () => {
      const tool = tools.find((t) => t.name === "generate_batch");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("Batch");
    });

    it("should define generate_fbo_pipeline tool", () => {
      const tool = tools.find((t) => t.name === "generate_fbo_pipeline");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("FBO");
    });

    it("should define generate_audio_graph tool", () => {
      const tool = tools.find((t) => t.name === "generate_audio_graph");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("audio");
    });

    it("should define generate_audio_reactive tool", () => {
      const tool = tools.find((t) => t.name === "generate_audio_reactive");
      expect(tool).toBeDefined();
    });

    it("should define generate_particle_system tool", () => {
      const tool = tools.find((t) => t.name === "generate_particle_system");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("particle");
    });

    it("should define generate_params_ui tool", () => {
      const tool = tools.find((t) => t.name === "generate_params_ui");
      expect(tool).toBeDefined();
    });

    it("should define generate_params_from_uniforms tool", () => {
      const tool = tools.find(
        (t) => t.name === "generate_params_from_uniforms",
      );
      expect(tool).toBeDefined();
    });
  });

  describe("generate_shader", () => {
    it("should require effect parameter", () => {
      const tool = tools.find((t) => t.name === "generate_shader");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("effect");
    });

    it("should accept shader_type enum", () => {
      const tool = tools.find((t) => t.name === "generate_shader");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.shader_type.enum).toEqual([
        "vertex",
        "fragment",
        "both",
      ]);
    });
  });

  describe("generate_batch", () => {
    it("should require geometry parameter", () => {
      const tool = tools.find((t) => t.name === "generate_batch");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("geometry");
    });
  });

  describe("generate_fbo_pipeline", () => {
    it("should require passes parameter", () => {
      const tool = tools.find((t) => t.name === "generate_fbo_pipeline");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("passes");
    });

    it("should accept width and height parameters", () => {
      const tool = tools.find((t) => t.name === "generate_fbo_pipeline");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.width).toBeDefined();
      expect(props.height).toBeDefined();
    });
  });

  describe("generate_audio_graph", () => {
    it("should require nodes parameter", () => {
      const tool = tools.find((t) => t.name === "generate_audio_graph");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("nodes");
    });

    it("should accept array of node strings", () => {
      const tool = tools.find((t) => t.name === "generate_audio_graph");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.nodes.type).toBe("array");
      expect(props.nodes.items.type).toBe("string");
    });
  });

  describe("generate_particle_system", () => {
    it("should require max_particles parameter", () => {
      const tool = tools.find((t) => t.name === "generate_particle_system");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("max_particles");
    });

    it("should accept forces array and emitter_type", () => {
      const tool = tools.find((t) => t.name === "generate_particle_system");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.forces.type).toBe("array");
      expect(props.emitter_type.type).toBe("string");
    });
  });

  describe("handleToolCall", () => {
    it("should throw for unimplemented tools (stubs)", async () => {
      await expect(
        handleToolCall("generate_shader", { effect: "blur" }),
      ).rejects.toThrow("not yet implemented");
    });

    it("should throw for generate_batch stub", async () => {
      await expect(
        handleToolCall("generate_batch", { geometry: "sphere" }),
      ).rejects.toThrow("not yet implemented");
    });

    it("should throw for generate_fbo_pipeline stub", async () => {
      await expect(
        handleToolCall("generate_fbo_pipeline", { passes: 3 }),
      ).rejects.toThrow("not yet implemented");
    });

    it("should throw for generate_audio_graph stub", async () => {
      await expect(
        handleToolCall("generate_audio_graph", {
          nodes: ["input", "gain", "output"],
        }),
      ).rejects.toThrow("not yet implemented");
    });

    it("should throw for generate_particle_system stub", async () => {
      await expect(
        handleToolCall("generate_particle_system", { max_particles: 1000 }),
      ).rejects.toThrow("not yet implemented");
    });
  });
});
