import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface Diagnosis {
  pattern: string;
  explanation: string;
  fix: string;
}

interface GlErrorInfo {
  code: string;
  name: string;
  explanation: string;
  common_causes: string[];
}

interface InstallCheck {
  cinder_path: string | null;
  cinder_version: string | null;
  cmake_version: string | null;
  compiler: string | null;
  platform: string;
  issues: string[];
}

// Common Cinder build error patterns and their diagnoses
const BUILD_ERROR_PATTERNS: Array<{
  pattern: RegExp;
  diagnosis: (match: RegExpMatchArray) => Diagnosis;
}> = [
  {
    pattern: /CINDER_PATH.*not\s+(?:set|defined|found)/i,
    diagnosis: () => ({
      pattern: "Missing CINDER_PATH",
      explanation:
        "The CINDER_PATH environment variable is not set. CMake cannot locate the Cinder framework installation.",
      fix: 'Set the CINDER_PATH environment variable to point to your Cinder installation:\n\nexport CINDER_PATH=/path/to/cinder\n\nOr add it to your CMakeLists.txt:\nset(CINDER_PATH "/path/to/cinder" CACHE PATH "")',
    }),
  },
  {
    pattern:
      /fatal\s+error:\s+['"]?(cinder\/\S+\.h|ci\/\S+\.h)['"]?\s+.*not\s+found/i,
    diagnosis: (match) => ({
      pattern: "Missing Cinder header",
      explanation: `The header file '${match[1]}' could not be found. This usually means CINDER_PATH is incorrect or the Cinder installation is incomplete.`,
      fix: `1. Verify CINDER_PATH points to the correct Cinder directory\n2. Check that ${match[1]} exists in $CINDER_PATH/include/\n3. If using a CinderBlock, make sure it's properly included in your CMakeLists.txt`,
    }),
  },
  {
    pattern: /fatal\s+error:\s+['"]?(\S+\.h)['"]?\s+.*not\s+found/i,
    diagnosis: (match) => ({
      pattern: "Missing include",
      explanation: `Header '${match[1]}' not found. This may be a system header, Cinder header, or CinderBlock header.`,
      fix: `Check which Cinder module provides '${match[1]}':\n- Core headers: #include "cinder/..."\n- GL headers: #include "cinder/gl/gl.h"\n- Audio: #include "cinder/audio/audio.h"\n- If from a CinderBlock, add it to your project's blocks/ configuration`,
    }),
  },
  {
    pattern: /undefined\s+(?:reference|symbol).*\b(ci::\S+|cinder::\S+)/i,
    diagnosis: (match) => ({
      pattern: "Linker error -- undefined Cinder symbol",
      explanation: `Linker cannot find the definition for '${match[1]}'. This usually means a Cinder library or CinderBlock is not linked.`,
      fix: 'Ensure your CMakeLists.txt includes:\n  include("${CINDER_PATH}/proj/cmake/modules/cinderMakeApp.cmake")\n  ci_make_app( ... CINDER_PATH ${CINDER_PATH} SOURCES src/MyApp.cpp)\nIf using CinderBlocks, add them via the BLOCKS parameter in ci_make_app().',
    }),
  },
  {
    pattern: /undefined\s+(?:reference|symbol).*\b(gl\w+|GL\w+)/i,
    diagnosis: (match) => ({
      pattern: "Linker error -- missing OpenGL symbol",
      explanation: `OpenGL symbol '${match[1]}' is undefined. This may indicate a missing OpenGL library link or an unsupported GL function.`,
      fix: "1. Make sure OpenGL is linked in CMakeLists.txt: find_package(OpenGL REQUIRED)\n2. On macOS, ensure the OpenGL framework is included\n3. Check that the GL function is available in your target OpenGL version (Cinder requires OpenGL 3.2+ core profile)",
    }),
  },
  {
    pattern: /GL_VERSION.*(\d\.\d).*required.*(\d\.\d)/i,
    diagnosis: (match) => ({
      pattern: "OpenGL version mismatch",
      explanation: `Your system reports OpenGL ${match[1]} but ${match[2]} is required. Cinder requires OpenGL 3.2 core profile minimum.`,
      fix: "1. Update your GPU drivers\n2. Check that your GPU supports OpenGL 3.2+\n3. On macOS, OpenGL 4.1 is the maximum supported version\n4. Consider using a different rendering backend if your hardware is older",
    }),
  },
  {
    pattern: /CMake\s+Error.*Could\s+not\s+find.*?(\w+)/i,
    diagnosis: (match) => ({
      pattern: "CMake dependency not found",
      explanation: `CMake could not find the required package '${match[1]}'.`,
      fix: `1. Install the missing package '${match[1]}'\n2. If it's a Cinder dependency, ensure CINDER_PATH is correct and Cinder is fully built\n3. Set the package's root directory: -D${match[1]}_DIR=/path/to/${match[1]}`,
    }),
  },
  {
    pattern: /CMake\s+Error.*Minimum\s+required.*?(\d+\.\d+)/i,
    diagnosis: (match) => ({
      pattern: "CMake version too old",
      explanation: `This project requires CMake ${match[1]} or newer.`,
      fix: `Upgrade CMake to version ${match[1]} or newer:\n- macOS: brew install cmake\n- Windows: Download from cmake.org\n- Linux: sudo apt install cmake or snap install cmake`,
    }),
  },
];

// OpenGL error code map
const GL_ERRORS: Record<string, GlErrorInfo> = {
  "0x0500": {
    code: "0x0500",
    name: "GL_INVALID_ENUM",
    explanation:
      "An invalid enum value was passed to a GL function. This often occurs when using features not supported by the current GL context.",
    common_causes: [
      "Using GL_TEXTURE_3D on a context that doesn't support it",
      "Passing an incorrect texture format enum to gl::Texture2d::create()",
      "Using gl::drawInstanced() parameters incorrectly",
      "Requesting an unsupported internal format for FBOs",
    ],
  },
  "0x0501": {
    code: "0x0501",
    name: "GL_INVALID_VALUE",
    explanation:
      "A numeric value passed to a GL function is out of the valid range.",
    common_causes: [
      "Negative width/height in gl::Texture2d::create() or gl::Fbo::create()",
      "Texture dimensions exceeding GL_MAX_TEXTURE_SIZE",
      "Invalid mipmap level in texture operations",
      "Zero-size buffer creation with gl::Vbo",
    ],
  },
  "0x0502": {
    code: "0x0502",
    name: "GL_INVALID_OPERATION",
    explanation:
      "The operation is not allowed in the current GL state. This is the most common error in Cinder apps.",
    common_causes: [
      "Drawing without a bound shader (GlslProg not set via gl::ScopedGlslProg)",
      "Accessing a framebuffer that isn't complete",
      "Calling gl::draw() outside of the draw() method before GL context is ready",
      "Mismatched vertex attribute layout between VboMesh and GlslProg",
      "Reading from a texture that's also bound as a render target",
    ],
  },
  "0x0505": {
    code: "0x0505",
    name: "GL_OUT_OF_MEMORY",
    explanation:
      "The GL driver ran out of memory for the requested operation.",
    common_causes: [
      "Creating too many large textures or FBOs",
      "Particle system with excessive vertex data",
      "Loading very large images without downsampling",
      "Memory leak from not releasing GL resources (check Batch/Fbo/Texture lifecycle)",
    ],
  },
  "0x0506": {
    code: "0x0506",
    name: "GL_INVALID_FRAMEBUFFER_OPERATION",
    explanation:
      "An operation was attempted on an incomplete framebuffer object.",
    common_causes: [
      "FBO created with incompatible attachment formats",
      "Rendering to an FBO before all attachments are configured",
      "Mismatched dimensions between FBO color and depth attachments",
      "Using gl::Fbo::Format() with unsupported combinations on the current GPU",
    ],
  },
};

// Name-to-hex mapping for GL error lookup
const GL_ERROR_NAMES: Record<string, string> = {
  GL_INVALID_ENUM: "0x0500",
  GL_INVALID_VALUE: "0x0501",
  GL_INVALID_OPERATION: "0x0502",
  GL_OUT_OF_MEMORY: "0x0505",
  GL_INVALID_FRAMEBUFFER_OPERATION: "0x0506",
};

export const tools: ToolDefinition[] = [
  {
    name: "diagnose_build_error",
    description:
      "Analyze a Cinder build error and provide a diagnosis with explanation and fix suggestion.",
    inputSchema: {
      type: "object",
      properties: {
        error_text: {
          type: "string",
          description: "The build error text to diagnose",
        },
      },
      required: ["error_text"],
    },
  },
  {
    name: "diagnose_gl_error",
    description:
      "Explain an OpenGL error code in the context of Cinder development, with common causes and fixes.",
    inputSchema: {
      type: "object",
      properties: {
        error_code: {
          type: ["number", "string"],
          description:
            'GL error code as number (e.g. 1280) or string (e.g. "GL_INVALID_ENUM" or "0x0500")',
        },
      },
      required: ["error_code"],
    },
  },
  {
    name: "check_cinder_install",
    description:
      "Check the Cinder installation, CMake availability, compiler, and platform, reporting any issues found.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "diagnose_build_error": {
      const errorText = args.error_text as string;
      const diagnoses: Diagnosis[] = [];

      for (const { pattern, diagnosis } of BUILD_ERROR_PATTERNS) {
        const match = errorText.match(pattern);
        if (match) {
          diagnoses.push(diagnosis(match));
        }
      }

      if (diagnoses.length === 0) {
        return {
          diagnosed: false,
          message:
            "Could not match the error to a known pattern. Please share the full build log for more context.",
          error_text: errorText,
        };
      }

      return {
        diagnosed: true,
        diagnoses,
      };
    }

    case "diagnose_gl_error": {
      const errorCode = args.error_code;
      let hexCode: string;

      if (typeof errorCode === "number") {
        hexCode = "0x" + errorCode.toString(16).padStart(4, "0");
      } else if (typeof errorCode === "string") {
        if (errorCode.startsWith("GL_")) {
          hexCode = GL_ERROR_NAMES[errorCode] || errorCode;
        } else if (errorCode.startsWith("0x")) {
          hexCode = errorCode.toLowerCase();
        } else {
          const num = parseInt(errorCode, 10);
          hexCode = isNaN(num)
            ? errorCode
            : "0x" + num.toString(16).padStart(4, "0");
        }
      } else {
        throw new Error("error_code must be a number or string");
      }

      const info = GL_ERRORS[hexCode];

      if (!info) {
        return {
          found: false,
          message: `Unknown GL error code: ${hexCode}. Known codes: ${Object.keys(GL_ERRORS).join(", ")}`,
        };
      }

      return {
        found: true,
        ...info,
      };
    }

    case "check_cinder_install": {
      const result: InstallCheck = {
        cinder_path: null,
        cinder_version: null,
        cmake_version: null,
        compiler: null,
        platform: process.platform,
        issues: [],
      };

      // Check CINDER_PATH
      const cinderPath = process.env.CINDER_PATH || null;
      result.cinder_path = cinderPath;

      if (!cinderPath) {
        result.issues.push(
          "CINDER_PATH environment variable is not set. Set it to the root of your Cinder installation.",
        );
      } else if (!existsSync(cinderPath)) {
        result.issues.push(
          `CINDER_PATH points to '${cinderPath}' which does not exist.`,
        );
      } else {
        const cinderHeader = join(
          cinderPath,
          "include",
          "cinder",
          "Cinder.h",
        );
        if (!existsSync(cinderHeader)) {
          result.issues.push(
            `Cinder.h not found at ${cinderHeader}. Cinder installation may be incomplete.`,
          );
        }

        // Try to read version from CinderVersion.h
        const versionHeader = join(
          cinderPath,
          "include",
          "cinder",
          "CinderVersion.h",
        );
        if (existsSync(versionHeader)) {
          try {
            const versionContent = readFileSync(versionHeader, "utf-8");
            const majorMatch = versionContent.match(
              /CINDER_VERSION_MAJOR\s+(\d+)/,
            );
            const minorMatch = versionContent.match(
              /CINDER_VERSION_MINOR\s+(\d+)/,
            );
            const patchMatch = versionContent.match(
              /CINDER_VERSION_PATCH\s+(\d+)/,
            );
            if (majorMatch && minorMatch && patchMatch) {
              result.cinder_version = `${majorMatch[1]}.${minorMatch[1]}.${patchMatch[1]}`;
            }
          } catch {
            // Ignore version read errors
          }
        }
      }

      // Check CMake
      try {
        const cmakeOutput = execSync("cmake --version", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const versionMatch = cmakeOutput.match(/cmake version (\S+)/);
        result.cmake_version = versionMatch ? versionMatch[1] : "unknown";
      } catch {
        result.cmake_version = null;
        result.issues.push(
          "CMake is not installed or not in PATH. Install CMake 3.19+ to build Cinder projects.",
        );
      }

      // Check compiler (platform-specific)
      if (process.platform === "darwin") {
        try {
          const clangOutput = execSync("clang++ --version", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          const versionMatch = clangOutput.match(
            /(?:Apple\s+)?clang\s+version\s+(\S+)/,
          );
          result.compiler = versionMatch
            ? `clang++ ${versionMatch[1]}`
            : "clang++ (version unknown)";
        } catch {
          result.issues.push(
            "clang++ not found. Install Xcode Command Line Tools: xcode-select --install",
          );
        }
      } else if (process.platform === "win32") {
        try {
          execSync("cl.exe", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          result.compiler = "cl.exe (MSVC)";
        } catch {
          result.issues.push(
            "cl.exe (MSVC) not found. Install Visual Studio 2022 with C++ workload.",
          );
        }
      } else {
        // Linux
        try {
          const gccOutput = execSync("g++ --version", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          const versionMatch = gccOutput.match(/g\+\+.*?(\d+\.\d+\.\d+)/);
          result.compiler = versionMatch
            ? `g++ ${versionMatch[1]}`
            : "g++ (version unknown)";
        } catch {
          try {
            execSync("clang++ --version", {
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            });
            result.compiler = "clang++";
          } catch {
            result.issues.push(
              "No C++ compiler found. Install g++ or clang++.",
            );
          }
        }
      }

      return result;
    }

    default:
      throw new Error(`Unknown diagnostics tool: "${name}"`);
  }
}
