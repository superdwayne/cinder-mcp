import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BuildError {
  file: string;
  line: number;
  message: string;
}

export interface BuildResult {
  success: boolean;
  errors: BuildError[];
  warnings: BuildError[];
  output: string;
}

export interface RunResult {
  pid: number;
  binary_path: string;
}

// Regex patterns for compiler error/warning parsing
const GCC_CLANG_ERROR = /^(.+?):(\d+):\d+:\s+error:\s+(.+)$/;
const GCC_CLANG_WARNING = /^(.+?):(\d+):\d+:\s+warning:\s+(.+)$/;
const MSVC_ERROR = /^(.+?)\((\d+)\):\s+error\s+C\d+:\s+(.+)$/;
const MSVC_WARNING = /^(.+?)\((\d+)\):\s+warning\s+C\d+:\s+(.+)$/;

function parseBuildOutput(output: string): {
  errors: BuildError[];
  warnings: BuildError[];
} {
  const errors: BuildError[] = [];
  const warnings: BuildError[] = [];

  for (const line of output.split("\n")) {
    let match = line.match(GCC_CLANG_ERROR) || line.match(MSVC_ERROR);
    if (match) {
      errors.push({
        file: match[1],
        line: parseInt(match[2], 10),
        message: match[3],
      });
      continue;
    }

    match = line.match(GCC_CLANG_WARNING) || line.match(MSVC_WARNING);
    if (match) {
      warnings.push({
        file: match[1],
        line: parseInt(match[2], 10),
        message: match[3],
      });
    }
  }

  return { errors, warnings };
}

function findBinary(buildDir: string, config: string): string | null {
  const configDir = join(buildDir, config);
  const searchDirs = [configDir, buildDir];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isFile() && (stat.mode & 0o111) !== 0) {
          return fullPath;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

export const tools: ToolDefinition[] = [
  {
    name: "build",
    description:
      "Build a Cinder project using CMake. Configures and compiles the project, returning structured error/warning information.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Cinder project root directory",
        },
        generator: {
          type: "string",
          enum: ["Xcode", "Visual Studio 17", "Unix Makefiles"],
          description: "CMake generator to use (optional)",
        },
        config: {
          type: "string",
          enum: ["Debug", "Release"],
          description: "Build configuration (default: Debug)",
        },
      },
      required: ["project_path"],
    },
  },
  {
    name: "run",
    description:
      "Run a compiled Cinder application. Finds the binary in the build directory and spawns it as a detached process.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Cinder project root directory",
        },
        config: {
          type: "string",
          enum: ["Debug", "Release"],
          description: "Build configuration to run (default: Debug)",
        },
      },
      required: ["project_path"],
    },
  },
  {
    name: "clean",
    description: "Clean a Cinder project by removing the build directory.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Cinder project root directory",
        },
      },
      required: ["project_path"],
    },
  },
  {
    name: "build_and_run",
    description:
      "Build a Cinder project and run it if the build succeeds. Combines the build and run tools in a single operation.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Cinder project root directory",
        },
        generator: {
          type: "string",
          enum: ["Xcode", "Visual Studio 17", "Unix Makefiles"],
          description: "CMake generator to use (optional)",
        },
        config: {
          type: "string",
          enum: ["Debug", "Release"],
          description: "Build configuration (default: Debug)",
        },
      },
      required: ["project_path"],
    },
  },
];

async function handleBuild(
  args: Record<string, unknown>,
): Promise<BuildResult> {
  const projectPath = args.project_path as string;
  const generator = args.generator as string | undefined;
  const config = (args.config as string) || "Debug";

  if (!existsSync(projectPath)) {
    return {
      success: false,
      errors: [
        {
          file: projectPath,
          line: 0,
          message: "Project path does not exist",
        },
      ],
      warnings: [],
      output: "",
    };
  }

  let output = "";

  try {
    // Configure step
    let configureCmd = "cmake -S . -B build";
    if (generator) {
      configureCmd += ` -G "${generator}"`;
    }

    output += execSync(configureCmd, {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; stdout?: string };
    const stderr = execErr.stderr || "";
    const stdout = execErr.stdout || "";
    output = stdout + "\n" + stderr;
    const { errors, warnings } = parseBuildOutput(output);
    return { success: false, errors, warnings, output };
  }

  try {
    // Build step
    const buildCmd = `cmake --build build --config ${config}`;
    output += execSync(buildCmd, {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; stdout?: string };
    const stderr = execErr.stderr || "";
    const stdout = execErr.stdout || "";
    output += stdout + "\n" + stderr;
    const { errors, warnings } = parseBuildOutput(output);
    return { success: false, errors, warnings, output };
  }

  const { errors, warnings } = parseBuildOutput(output);
  return { success: errors.length === 0, errors, warnings, output };
}

async function handleRun(args: Record<string, unknown>): Promise<RunResult> {
  const projectPath = args.project_path as string;
  const config = (args.config as string) || "Debug";
  const buildDir = join(projectPath, "build");

  if (!existsSync(buildDir)) {
    throw new Error(
      `Build directory not found at ${buildDir}. Run 'build' first.`,
    );
  }

  const binaryPath = findBinary(buildDir, config);
  if (!binaryPath) {
    throw new Error(
      `No executable binary found in ${buildDir}/${config}. Build may have failed.`,
    );
  }

  const child = spawn(binaryPath, [], {
    cwd: projectPath,
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  return {
    pid: child.pid!,
    binary_path: binaryPath,
  };
}

async function handleClean(
  args: Record<string, unknown>,
): Promise<{ success: boolean; message: string }> {
  const projectPath = args.project_path as string;
  const buildDir = join(projectPath, "build");

  if (!existsSync(buildDir)) {
    return {
      success: true,
      message: `Build directory does not exist at ${buildDir}. Nothing to clean.`,
    };
  }

  rmSync(buildDir, { recursive: true, force: true });

  return {
    success: true,
    message: `Successfully removed build directory at ${buildDir}`,
  };
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "build":
      return handleBuild(args);

    case "run":
      return handleRun(args);

    case "clean":
      return handleClean(args);

    case "build_and_run": {
      const buildResult = await handleBuild(args);
      if (!buildResult.success) {
        return { build: buildResult, run: null };
      }
      const runResult = await handleRun(args);
      return { build: buildResult, run: runResult };
    }

    default:
      throw new Error(`Unknown build tool: "${name}"`);
  }
}
