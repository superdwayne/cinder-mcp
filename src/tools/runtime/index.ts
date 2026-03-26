import { z } from "zod";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OscClient, OscArg } from "../../runtime/osc-client.js";

// ---------------------------------------------------------------------------
// Shared singleton OscClient
// ---------------------------------------------------------------------------
let client: OscClient | null = null;
let connectedPort: number | null = null;
let connectedAppName: string | null = null;

function getClient(): OscClient {
  if (!client || !client.isConnected) {
    throw new Error("Not connected to any Cinder app. Use connect first.");
  }
  return client;
}

function extractAckMessage(ack: { args: { type: string; value: unknown }[] }): string {
  // Ack format: [commandId, status, message]
  const status = ack.args.length > 1 ? (ack.args[1].value as string) : "unknown";
  const message = ack.args.length > 2 ? (ack.args[2].value as string) : "";
  if (status === "error") {
    throw new Error(`Cinder error: ${message}`);
  }
  return message;
}

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------
const ConnectSchema = z.object({
  port: z.number().optional(),
  name: z.string().optional(),
});

const SetUniformSchema = z.object({
  name: z.string(),
  type: z.enum(["float", "int", "vec2", "vec3", "vec4"]),
  value: z.union([z.number(), z.array(z.number())]),
});

const SetParamSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string(), z.boolean()]),
});

const AnimateParamSchema = z.object({
  name: z.string(),
  target_value: z.number(),
  duration_ms: z.number(),
});

const ScreenshotSchema = z.object({
  path: z.string().optional(),
});

const SetWindowSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});

const SetCameraSchema = z.object({
  eye: z.tuple([z.number(), z.number(), z.number()]),
  target: z.tuple([z.number(), z.number(), z.number()]),
  fov: z.number().optional().default(45),
  near: z.number().optional().default(0.1),
  far: z.number().optional().default(1000),
});

const SetClearColorSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number().optional().default(1.0),
});

const SetFramerateSchema = z.object({
  fps: z.number(),
});

const AudioNodeSchema = z.object({
  node_name: z.string(),
});

const SetAudioGainSchema = z.object({
  node_name: z.string(),
  gain: z.number(),
});

const SetAudioPanSchema = z.object({
  node_name: z.string(),
  pan: z.number(),
});

const HotReloadShaderSchema = z.object({
  shader_name: z.string(),
  vertex_source: z.string().optional(),
  fragment_source: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: ToolDefinition[] = [
  // --- Connection tools (US-012) ---
  {
    name: "list_apps",
    description: "Scan for running Cinder apps with active OSC bridges on ports 9090-9099",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "connect",
    description: "Connect to a running Cinder app via its OSC bridge port or app name",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", description: "OSC port of the Cinder app (default 9090)" },
        name: { type: "string", description: "App name to connect to (scans ports to find it)" },
      },
      required: [],
    },
  },
  {
    name: "disconnect",
    description: "Disconnect from the currently connected Cinder app",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "status",
    description: "Get connection status and full app state from the running Cinder app",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_scene",
    description: "Get the complete scene state: all uniforms and params from the running app",
    inputSchema: { type: "object", properties: {}, required: [] },
  },

  // --- Uniform/param tools (US-013) ---
  {
    name: "set_uniform",
    description: "Set a GL shader uniform value by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Uniform name" },
        type: { type: "string", enum: ["float", "int", "vec2", "vec3", "vec4"], description: "Uniform type" },
        value: { description: "Value (number or array of numbers for vector types)" },
      },
      required: ["name", "type", "value"],
    },
  },
  {
    name: "get_uniforms",
    description: "List all active GL shader uniforms in the running app",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_param",
    description: "Set an exposed parameter value in the running app",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Parameter name" },
        value: { description: "New value (number, string, or boolean)" },
      },
      required: ["name", "value"],
    },
  },
  {
    name: "get_params",
    description: "List all exposed parameters and their current values",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "animate_param",
    description: "Smoothly animate a float parameter to a target value over a duration",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Parameter name" },
        target_value: { type: "number", description: "Target value to animate to" },
        duration_ms: { type: "number", description: "Animation duration in milliseconds" },
      },
      required: ["name", "target_value", "duration_ms"],
    },
  },

  // --- Render control tools (US-014) ---
  {
    name: "screenshot",
    description: "Capture a screenshot of the running Cinder app window",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional file path to save the PNG (auto-generated if omitted)" },
      },
      required: [],
    },
  },
  {
    name: "set_window_size",
    description: "Set the Cinder app window size in pixels",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
      },
      required: ["width", "height"],
    },
  },
  {
    name: "toggle_fullscreen",
    description: "Toggle the Cinder app between windowed and fullscreen mode",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_camera",
    description: "Set the 3D camera position, target, field of view, and clip planes",
    inputSchema: {
      type: "object",
      properties: {
        eye: { type: "array", items: { type: "number" }, description: "[x, y, z] camera position" },
        target: { type: "array", items: { type: "number" }, description: "[x, y, z] look-at target" },
        fov: { type: "number", description: "Field of view in degrees (default 45)" },
        near: { type: "number", description: "Near clip plane (default 0.1)" },
        far: { type: "number", description: "Far clip plane (default 1000)" },
      },
      required: ["eye", "target"],
    },
  },
  {
    name: "set_clear_color",
    description: "Set the background clear color (RGBA, 0-1 range)",
    inputSchema: {
      type: "object",
      properties: {
        r: { type: "number" },
        g: { type: "number" },
        b: { type: "number" },
        a: { type: "number", description: "Alpha (default 1.0)" },
      },
      required: ["r", "g", "b"],
    },
  },
  {
    name: "set_framerate",
    description: "Set the target framerate of the Cinder app",
    inputSchema: {
      type: "object",
      properties: {
        fps: { type: "number" },
      },
      required: ["fps"],
    },
  },

  // --- Audio tools (US-015) ---
  {
    name: "set_audio_gain",
    description: "Set the gain level of a named audio node",
    inputSchema: {
      type: "object",
      properties: {
        node_name: { type: "string", description: "Name of the audio gain node" },
        gain: { type: "number", description: "Gain level (0.0 - 1.0+)" },
      },
      required: ["node_name", "gain"],
    },
  },
  {
    name: "set_audio_pan",
    description: "Set the stereo pan position of a named audio node",
    inputSchema: {
      type: "object",
      properties: {
        node_name: { type: "string", description: "Name of the audio pan node" },
        pan: { type: "number", description: "Pan position (-1.0 left to 1.0 right)" },
      },
      required: ["node_name", "pan"],
    },
  },
  {
    name: "play_audio",
    description: "Start playback on a named audio player node",
    inputSchema: {
      type: "object",
      properties: {
        node_name: { type: "string", description: "Name of the audio player node" },
      },
      required: ["node_name"],
    },
  },
  {
    name: "stop_audio",
    description: "Stop playback on a named audio player node",
    inputSchema: {
      type: "object",
      properties: {
        node_name: { type: "string", description: "Name of the audio player node" },
      },
      required: ["node_name"],
    },
  },
  {
    name: "get_audio_spectrum",
    description: "Get the FFT spectrum data from a named audio monitor node",
    inputSchema: {
      type: "object",
      properties: {
        node_name: { type: "string", description: "Name of the audio monitor node" },
      },
      required: ["node_name"],
    },
  },

  // --- Hot-reload tool (US-016) ---
  {
    name: "hot_reload_shader",
    description: "Hot-reload a shader by writing source to temp files and recompiling in the running app",
    inputSchema: {
      type: "object",
      properties: {
        shader_name: { type: "string", description: "Name/identifier of the shader to reload" },
        vertex_source: { type: "string", description: "GLSL vertex shader source code" },
        fragment_source: { type: "string", description: "GLSL fragment shader source code" },
      },
      required: ["shader_name"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    // -----------------------------------------------------------------------
    // Connection tools (US-012)
    // -----------------------------------------------------------------------
    case "list_apps": {
      const scanner = new OscClient({ port: 9090 });
      const activePorts = await scanner.scan(9090, 9099);

      const apps: { port: number; name: string | null }[] = [];
      for (const port of activePorts) {
        let appName: string | null = null;
        try {
          const probe = new OscClient({ port, timeout: 2000 });
          await probe.connect();
          const ack = await probe.send("/get_state");
          const msg = extractAckMessage(ack);
          try {
            const state = JSON.parse(msg);
            appName = state.app || null;
          } catch {
            appName = null;
          }
          probe.disconnect();
        } catch {
          // Could not query, still report port
        }
        apps.push({ port, name: appName });
      }
      return { apps };
    }

    case "connect": {
      const input = ConnectSchema.parse(args);
      let port = input.port ?? 9090;

      // If name was provided, scan to find matching app
      if (input.name && !input.port) {
        const scanner = new OscClient({ port: 9090 });
        const activePorts = await scanner.scan(9090, 9099);
        let found = false;
        for (const p of activePorts) {
          try {
            const probe = new OscClient({ port: p, timeout: 2000 });
            await probe.connect();
            const ack = await probe.send("/get_state");
            const msg = extractAckMessage(ack);
            const state = JSON.parse(msg);
            if (state.app === input.name) {
              port = p;
              found = true;
              probe.disconnect();
              break;
            }
            probe.disconnect();
          } catch {
            continue;
          }
        }
        if (!found) {
          throw new Error(`App "${input.name}" not found on ports 9090-9099`);
        }
      }

      // Disconnect existing
      if (client) {
        client.disconnect();
      }

      client = new OscClient({ port, timeout: 5000 });
      await client.connect();
      connectedPort = port;

      // Try to get app name
      try {
        const ack = await client.send("/get_state");
        const msg = extractAckMessage(ack);
        const state = JSON.parse(msg);
        connectedAppName = state.app || null;
      } catch {
        connectedAppName = null;
      }

      return { connected: true, port, appName: connectedAppName };
    }

    case "disconnect": {
      if (client) {
        client.disconnect();
        client = null;
      }
      const prevPort = connectedPort;
      connectedPort = null;
      connectedAppName = null;
      return { disconnected: true, previousPort: prevPort };
    }

    case "status": {
      if (!client || !client.isConnected) {
        return { connected: false, port: null, appName: null, state: null };
      }
      const ack = await client.send("/get_state");
      const msg = extractAckMessage(ack);
      return {
        connected: true,
        port: connectedPort,
        appName: connectedAppName,
        state: JSON.parse(msg),
      };
    }

    case "get_scene": {
      const c = getClient();
      const [uniformsAck, paramsAck] = await Promise.all([
        c.send("/get_uniforms"),
        c.send("/get_params"),
      ]);
      const uniformsMsg = extractAckMessage(uniformsAck);
      const paramsMsg = extractAckMessage(paramsAck);
      return {
        uniforms: JSON.parse(uniformsMsg),
        params: JSON.parse(paramsMsg),
      };
    }

    // -----------------------------------------------------------------------
    // Uniform/param tools (US-013)
    // -----------------------------------------------------------------------
    case "set_uniform": {
      const input = SetUniformSchema.parse(args);
      const c = getClient();
      const oscArgs: OscArg[] = [
        { type: "s", value: input.name },
        { type: "s", value: input.type },
      ];

      if (typeof input.value === "number") {
        oscArgs.push({ type: input.type === "int" ? "i" : "f", value: input.value });
      } else if (Array.isArray(input.value)) {
        for (const v of input.value) {
          oscArgs.push({ type: "f", value: v });
        }
      }

      const ack = await c.send("/set_uniform", oscArgs);
      return { result: extractAckMessage(ack) };
    }

    case "get_uniforms": {
      const c = getClient();
      const ack = await c.send("/get_uniforms");
      const msg = extractAckMessage(ack);
      return { uniforms: JSON.parse(msg) };
    }

    case "set_param": {
      const input = SetParamSchema.parse(args);
      const c = getClient();
      const oscArgs: OscArg[] = [{ type: "s", value: input.name }];

      if (typeof input.value === "number") {
        oscArgs.push({ type: "f", value: input.value });
      } else if (typeof input.value === "string") {
        oscArgs.push({ type: "s", value: input.value });
      } else if (typeof input.value === "boolean") {
        oscArgs.push({ type: "i", value: input.value ? 1 : 0 });
      }

      const ack = await c.send("/set_param", oscArgs);
      return { result: extractAckMessage(ack) };
    }

    case "get_params": {
      const c = getClient();
      const ack = await c.send("/get_params");
      const msg = extractAckMessage(ack);
      return { params: JSON.parse(msg) };
    }

    case "animate_param": {
      const input = AnimateParamSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/animate_param", [
        { type: "s", value: input.name },
        { type: "f", value: input.target_value },
        { type: "f", value: input.duration_ms },
      ]);
      return { result: extractAckMessage(ack) };
    }

    // -----------------------------------------------------------------------
    // Render control tools (US-014)
    // -----------------------------------------------------------------------
    case "screenshot": {
      const input = ScreenshotSchema.parse(args);
      const c = getClient();
      const filePath =
        input.path ||
        join(
          mkdtempSync(join(tmpdir(), "cinder-screenshot-")),
          `screenshot-${Date.now()}.png`,
        );
      const ack = await c.send("/screenshot", [{ type: "s", value: filePath }]);
      extractAckMessage(ack);
      return { path: filePath };
    }

    case "set_window_size": {
      const input = SetWindowSizeSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/set_window_size", [
        { type: "i", value: input.width },
        { type: "i", value: input.height },
      ]);
      return { result: extractAckMessage(ack) };
    }

    case "toggle_fullscreen": {
      const c = getClient();
      const ack = await c.send("/toggle_fullscreen");
      return { result: extractAckMessage(ack) };
    }

    case "set_camera": {
      const input = SetCameraSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/set_camera", [
        { type: "f", value: input.eye[0] },
        { type: "f", value: input.eye[1] },
        { type: "f", value: input.eye[2] },
        { type: "f", value: input.target[0] },
        { type: "f", value: input.target[1] },
        { type: "f", value: input.target[2] },
        { type: "f", value: input.fov },
        { type: "f", value: input.near },
        { type: "f", value: input.far },
      ]);
      return { result: extractAckMessage(ack) };
    }

    case "set_clear_color": {
      const input = SetClearColorSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/set_clear_color", [
        { type: "f", value: input.r },
        { type: "f", value: input.g },
        { type: "f", value: input.b },
        { type: "f", value: input.a },
      ]);
      return { result: extractAckMessage(ack) };
    }

    case "set_framerate": {
      const input = SetFramerateSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/set_framerate", [
        { type: "f", value: input.fps },
      ]);
      return { result: extractAckMessage(ack) };
    }

    // -----------------------------------------------------------------------
    // Audio tools (US-015)
    // -----------------------------------------------------------------------
    case "set_audio_gain": {
      const input = SetAudioGainSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/audio/set_gain", [
        { type: "s", value: input.node_name },
        { type: "f", value: input.gain },
      ]);
      return { result: extractAckMessage(ack) };
    }

    case "set_audio_pan": {
      const input = SetAudioPanSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/audio/set_pan", [
        { type: "s", value: input.node_name },
        { type: "f", value: input.pan },
      ]);
      return { result: extractAckMessage(ack) };
    }

    case "play_audio": {
      const input = AudioNodeSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/audio/play", [
        { type: "s", value: input.node_name },
      ]);
      return { result: extractAckMessage(ack) };
    }

    case "stop_audio": {
      const input = AudioNodeSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/audio/stop", [
        { type: "s", value: input.node_name },
      ]);
      return { result: extractAckMessage(ack) };
    }

    case "get_audio_spectrum": {
      const input = AudioNodeSchema.parse(args);
      const c = getClient();
      const ack = await c.send("/audio/get_spectrum", [
        { type: "s", value: input.node_name },
      ]);
      const msg = extractAckMessage(ack);
      return { spectrum: JSON.parse(msg) };
    }

    // -----------------------------------------------------------------------
    // Hot-reload tool (US-016)
    // -----------------------------------------------------------------------
    case "hot_reload_shader": {
      const input = HotReloadShaderSchema.parse(args);
      const c = getClient();

      const tempDir = mkdtempSync(join(tmpdir(), "cinder-shader-"));
      const vertPath = join(tempDir, `${input.shader_name}.vert`);
      const fragPath = join(tempDir, `${input.shader_name}.frag`);

      if (input.vertex_source) {
        writeFileSync(vertPath, input.vertex_source, "utf-8");
      } else {
        // Write a pass-through vertex shader if not provided
        writeFileSync(
          vertPath,
          `#version 150\nuniform mat4 ciModelViewProjection;\nin vec4 ciPosition;\nvoid main() { gl_Position = ciModelViewProjection * ciPosition; }\n`,
          "utf-8",
        );
      }

      if (input.fragment_source) {
        writeFileSync(fragPath, input.fragment_source, "utf-8");
      } else {
        throw new Error("fragment_source is required for hot_reload_shader");
      }

      const ack = await c.send("/hot_reload_shader", [
        { type: "s", value: input.shader_name },
        { type: "s", value: vertPath },
        { type: "s", value: fragPath },
      ]);
      const result = extractAckMessage(ack);

      return {
        shader_name: input.shader_name,
        vertex_path: vertPath,
        fragment_path: fragPath,
        result,
      };
    }

    default:
      throw new Error(`Unknown runtime tool: "${name}"`);
  }
}
