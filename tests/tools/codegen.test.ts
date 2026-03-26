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
    it("should require type parameter", () => {
      const tool = tools.find((t) => t.name === "generate_shader");
      const required = tool!.inputSchema.required as string[];
      expect(required).toContain("type");
    });

    it("should accept type enum", () => {
      const tool = tools.find((t) => t.name === "generate_shader");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.type.enum).toEqual([
        "basic",
        "phong",
        "wireframe",
        "particle",
        "postprocess",
        "custom",
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

    it("should accept array of node objects", () => {
      const tool = tools.find((t) => t.name === "generate_audio_graph");
      const props = tool!.inputSchema.properties as Record<string, any>;
      expect(props.nodes.type).toBe("array");
      expect(props.nodes.items.type).toBe("object");
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
    it("should generate a basic shader", async () => {
      const result = await handleToolCall("generate_shader", {
        type: "basic",
        name: "myShader",
      });
      expect(result).toContain("myShader");
      expect(result).toContain("#version 150");
    });

    it("should generate a batch", async () => {
      const result = await handleToolCall("generate_batch", {
        geometry: "sphere",
        shader_type: "basic",
        name: "myBatch",
      });
      expect(result).toContain("myBatch");
    });

    it("should generate an fbo pipeline", async () => {
      const result = await handleToolCall("generate_fbo_pipeline", {
        passes: 2,
        width: 1024,
        height: 768,
        format: "RGBA8",
        ping_pong: false,
      });
      expect(result).toContain("Fbo");
    });

    it("should generate an audio graph", async () => {
      const result = await handleToolCall("generate_audio_graph", {
        nodes: [
          { type: "GenSineNode", name: "sine" },
          { type: "GainNode", name: "gain" },
        ],
        connections: [{ from: "sine", to: "gain" }],
      });
      expect(result).toContain("audio");
    });

    it("should generate a particle system", async () => {
      const result = await handleToolCall("generate_particle_system", {
        max_particles: 1000,
        emitter_type: "point",
        forces: ["gravity"],
        render_mode: "points",
        instanced: false,
      });
      expect(result).toContain("particle");
    });
  });
});
