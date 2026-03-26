import { execSync } from "node:child_process";
import { platform } from "node:os";
import { z } from "zod";

import {
  type CinderMcpConfig,
  readConfig,
  updateConfig,
  validateCinderPath,
} from "../../config.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: ToolDefinition[] = [
  {
    name: "get_config",
    description:
      "Read the current Cinder MCP configuration from ~/.cinder-mcp/config.json. Returns all config values including CINDER_PATH, default_template, bridge ports, and CMake generator.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "set_config",
    description:
      "Update one or more Cinder MCP configuration values. Supported keys: CINDER_PATH, default_template, bridge_port_start, bridge_port_end, default_cmake_generator.",
    inputSchema: {
      type: "object",
      properties: {
        CINDER_PATH: {
          type: "string",
          description: "Path to the Cinder installation directory",
        },
        default_template: {
          type: "string",
          description: "Default project template (e.g. BasicApp, ScreenSaverApp)",
        },
        bridge_port_start: {
          type: "number",
          description: "Start of OSC bridge port scan range",
        },
        bridge_port_end: {
          type: "number",
          description: "End of OSC bridge port scan range",
        },
        default_cmake_generator: {
          type: "string",
          description: "CMake generator to use (e.g. 'Unix Makefiles', 'Xcode', 'Visual Studio 17 2022')",
        },
      },
      required: [],
    },
  },
  {
    name: "detect_platform",
    description:
      "Detect the current platform capabilities: OS, available C++ compilers (g++, clang++, cl.exe), CMake version, and available Cinder features.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

const SetConfigSchema = z.object({
  CINDER_PATH: z.string().optional(),
  default_template: z.string().optional(),
  bridge_port_start: z.number().int().positive().optional(),
  bridge_port_end: z.number().int().positive().optional(),
  default_cmake_generator: z.string().optional(),
});

function commandExists(cmd: string): string | null {
  try {
    const result = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function getCommandVersion(cmd: string, flag = "--version"): string | null {
  try {
    const result = execSync(`${cmd} ${flag} 2>&1`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    // Extract first line
    return result.split("\n")[0] || null;
  } catch {
    return null;
  }
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_config": {
      const config = readConfig();
      const validation = validateCinderPath(config.CINDER_PATH);
      return {
        config,
        cinder_path_valid: validation.valid,
        ...(validation.reason ? { cinder_path_reason: validation.reason } : {}),
      };
    }

    case "set_config": {
      const parsed = SetConfigSchema.parse(args);
      const updates: Partial<CinderMcpConfig> = {};

      if (parsed.CINDER_PATH !== undefined) {
        const validation = validateCinderPath(parsed.CINDER_PATH);
        if (!validation.valid) {
          return {
            success: false,
            error: `Invalid CINDER_PATH: ${validation.reason}`,
          };
        }
        updates.CINDER_PATH = parsed.CINDER_PATH;
      }
      if (parsed.default_template !== undefined)
        updates.default_template = parsed.default_template;
      if (parsed.bridge_port_start !== undefined)
        updates.bridge_port_start = parsed.bridge_port_start;
      if (parsed.bridge_port_end !== undefined)
        updates.bridge_port_end = parsed.bridge_port_end;
      if (parsed.default_cmake_generator !== undefined)
        updates.default_cmake_generator = parsed.default_cmake_generator;

      const updated = updateConfig(updates);
      return { success: true, config: updated };
    }

    case "detect_platform": {
      const os = platform();
      const compilers: Record<string, { available: boolean; version: string | null; path: string | null }> = {};

      for (const compiler of ["g++", "clang++", "cl.exe"]) {
        const path = commandExists(compiler);
        compilers[compiler] = {
          available: path !== null,
          version: path ? getCommandVersion(compiler) : null,
          path,
        };
      }

      const cmakePath = commandExists("cmake");
      const cmakeVersion = cmakePath ? getCommandVersion("cmake") : null;

      const config = readConfig();
      const cinderValidation = validateCinderPath(config.CINDER_PATH);

      return {
        os,
        arch: process.arch,
        compilers,
        cmake: {
          available: cmakePath !== null,
          version: cmakeVersion,
          path: cmakePath,
        },
        cinder: {
          path: config.CINDER_PATH || null,
          valid: cinderValidation.valid,
          reason: cinderValidation.reason || null,
        },
      };
    }

    default:
      throw new Error(`Unknown config tool: ${name}`);
  }
}
