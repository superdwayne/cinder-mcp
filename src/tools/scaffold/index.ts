/**
 * US-004 — Scaffold tools
 * 3 tools: create_project, configure_build, create_from_sample
 */

import { z } from "zod";
import { readConfig } from "../../config.js";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir, cp } from "node:fs/promises";
import { join, basename } from "node:path";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TemplateEnum = z.enum(["basic", "opengl", "audio", "fullscreen"]);

const CreateProjectSchema = z.object({
  name: z.string().min(1).describe("Project name"),
  path: z.string().min(1).describe("Parent directory for the project"),
  template: TemplateEnum.default("basic").describe("Project template"),
});

const ConfigureBuildSchema = z.object({
  project_path: z.string().min(1).describe("Path to existing Cinder project"),
  add_sources: z
    .array(z.string())
    .optional()
    .describe("Additional source files to add"),
  add_includes: z
    .array(z.string())
    .optional()
    .describe("Additional include directories"),
  add_libraries: z
    .array(z.string())
    .optional()
    .describe("Additional libraries to link"),
});

const CreateFromSampleSchema = z.object({
  sample_name: z.string().min(1).describe("Name of the Cinder sample"),
  name: z.string().min(1).describe("New project name"),
  path: z.string().min(1).describe("Destination parent directory"),
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
  {
    name: "create_project",
    description:
      "Create a new Cinder project with directory structure, CMakeLists.txt, and template source files.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name" },
        path: {
          type: "string",
          description: "Parent directory for the project",
        },
        template: {
          type: "string",
          enum: ["basic", "opengl", "audio", "fullscreen"],
          description: "Project template (default: basic)",
          default: "basic",
        },
      },
      required: ["name", "path"],
    },
  },
  {
    name: "configure_build",
    description:
      "Modify an existing CMakeLists.txt to add source files, include directories, or link libraries.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to existing Cinder project",
        },
        add_sources: {
          type: "array",
          items: { type: "string" },
          description: "Source files to add",
        },
        add_includes: {
          type: "array",
          items: { type: "string" },
          description: "Include directories to add",
        },
        add_libraries: {
          type: "array",
          items: { type: "string" },
          description: "Libraries to link",
        },
      },
      required: ["project_path"],
    },
  },
  {
    name: "create_from_sample",
    description:
      "Copy a Cinder sample project as starting point for a new project.",
    inputSchema: {
      type: "object",
      properties: {
        sample_name: { type: "string", description: "Cinder sample name" },
        name: { type: "string", description: "New project name" },
        path: {
          type: "string",
          description: "Destination parent directory",
        },
      },
      required: ["sample_name", "name", "path"],
    },
  },
];

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

function generateCMakeLists(name: string): string {
  return `cmake_minimum_required(VERSION 3.19)
project(${name})

# Point to your Cinder installation
if(NOT DEFINED CINDER_PATH)
  if(DEFINED ENV{CINDER_PATH})
    set(CINDER_PATH $ENV{CINDER_PATH})
  else()
    message(FATAL_ERROR "CINDER_PATH not set. Pass -DCINDER_PATH=<path> or set the environment variable.")
  endif()
endif()

get_filename_component(CINDER_PATH "\${CINDER_PATH}" ABSOLUTE)

# Include Cinder's CMake utilities
include("\${CINDER_PATH}/proj/cmake/modules/cinderMakeApp.cmake")

# Collect sources
file(GLOB_RECURSE SRC_FILES src/*.cpp src/*.h)

ci_make_app(
  APP_NAME    ${name}
  CINDER_PATH \${CINDER_PATH}
  SOURCES     \${SRC_FILES}
  INCLUDES    \${CMAKE_CURRENT_SOURCE_DIR}/include
)
`;
}

function generateResourcesH(): string {
  return `#pragma once
#include "cinder/CinderResources.h"

// Define resources here, e.g.:
// #define RES_SHADER_VERT  CINDER_RESOURCE(../resources/, shader.vert, 128, GLSL)
`;
}

function generateMainCpp(
  name: string,
  template: z.infer<typeof TemplateEnum>,
): string {
  const className = `${name}App`;

  switch (template) {
    case "basic":
      return `#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class ${className} : public App {
public:
  void setup() override;
  void update() override;
  void draw() override;
};

void ${className}::setup()
{
}

void ${className}::update()
{
}

void ${className}::draw()
{
  gl::clear(Color(0.1f, 0.1f, 0.15f));
  gl::drawSolidCircle(getWindowCenter(), 100.0f);
}

CINDER_APP(${className}, RendererGl)
`;

    case "opengl":
      return `#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"
#include "cinder/CameraUi.h"

using namespace ci;
using namespace ci::app;

class ${className} : public App {
public:
  void setup() override;
  void update() override;
  void draw() override;

private:
  CameraPersp       mCam;
  CameraUi          mCamUi;
  gl::BatchRef      mBatch;
  gl::GlslProgRef   mGlsl;
};

void ${className}::setup()
{
  mCam.lookAt(vec3(3, 3, 3), vec3(0));
  mCamUi = CameraUi(&mCam, getWindow());

  mGlsl = gl::getStockShader(gl::ShaderDef().lambert().color());
  mBatch = gl::Batch::create(geom::Cube(), mGlsl);

  gl::enableDepthRead();
  gl::enableDepthWrite();
}

void ${className}::update()
{
}

void ${className}::draw()
{
  gl::clear(Color(0.1f, 0.1f, 0.15f));
  gl::setMatrices(mCam);
  mBatch->draw();
}

CINDER_APP(${className}, RendererGl, [](App::Settings *settings) {
  settings->setWindowSize(1280, 720);
  settings->setTitle("${name}");
})
`;

    case "audio":
      return `#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"
#include "cinder/audio/Context.h"
#include "cinder/audio/FilePlayerNode.h"
#include "cinder/audio/MonitorNode.h"

using namespace ci;
using namespace ci::app;

class ${className} : public App {
public:
  void setup() override;
  void update() override;
  void draw() override;

private:
  audio::FilePlayerNodeRef  mFilePlayer;
  audio::MonitorNodeRef     mMonitor;
  audio::GainNodeRef        mGain;
};

void ${className}::setup()
{
  auto ctx = audio::Context::master();

  // Create the audio graph:  FilePlayer -> Gain -> Monitor -> Output
  mFilePlayer = ctx->makeNode(new audio::FilePlayerNode());
  mGain       = ctx->makeNode(new audio::GainNode(0.5f));
  mMonitor    = ctx->makeNode(new audio::MonitorNode());

  mFilePlayer >> mGain >> mMonitor >> ctx->getOutput();
  ctx->enable();

  // Load a file: replace with your own audio asset
  // auto sourceFile = audio::load(loadAsset("audio.wav"));
  // mFilePlayer->setSourceFile(sourceFile);
  // mFilePlayer->start();
}

void ${className}::update()
{
}

void ${className}::draw()
{
  gl::clear(Color(0.1f, 0.1f, 0.15f));

  if (mMonitor && mMonitor->getNumConnectedInputs()) {
    const auto &buffer = mMonitor->getBuffer();
    const float *data  = buffer.getData();
    const size_t size  = buffer.getNumFrames();

    gl::color(Color(0.4f, 0.8f, 1.0f));
    gl::begin(GL_LINE_STRIP);
    for (size_t i = 0; i < size; ++i) {
      float x = lmap<float>((float)i, 0, (float)size, 0, (float)getWindowWidth());
      float y = lmap<float>(data[i], -1.0f, 1.0f, 0, (float)getWindowHeight());
      gl::vertex(x, y);
    }
    gl::end();
  }
}

CINDER_APP(${className}, RendererGl, [](App::Settings *settings) {
  settings->setWindowSize(1024, 400);
  settings->setTitle("${name}");
})
`;

    case "fullscreen":
      return `#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class ${className} : public App {
public:
  void setup() override;
  void update() override;
  void draw() override;
  void keyDown(KeyEvent event) override;

private:
  float mTime = 0.0f;
};

void ${className}::setup()
{
  setFullScreen(true);
  hideCursor();
}

void ${className}::update()
{
  mTime = (float)getElapsedSeconds();
}

void ${className}::draw()
{
  gl::clear(Color(0.0f, 0.0f, 0.0f));

  float cx = getWindowWidth() * 0.5f;
  float cy = getWindowHeight() * 0.5f;
  float r  = 200.0f + 100.0f * sin(mTime);

  gl::color(Color(0.3f + 0.3f * sin(mTime), 0.4f, 0.8f));
  gl::drawSolidCircle(vec2(cx, cy), r);
}

void ${className}::keyDown(KeyEvent event)
{
  if (event.getCode() == KeyEvent::KEY_ESCAPE) {
    setFullScreen(false);
    showCursor();
    quit();
  }
}

CINDER_APP(${className}, RendererGl, [](App::Settings *settings) {
  settings->setFullScreen(true);
  settings->setTitle("${name}");
})
`;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    // ----- create_project -----
    case "create_project": {
      const parsed = CreateProjectSchema.parse(args);
      const projectDir = join(parsed.path, parsed.name);

      if (existsSync(projectDir)) {
        return `Directory already exists: ${projectDir}`;
      }

      // Create directory structure
      const dirs = ["src", "include", "assets", "resources"];
      for (const d of dirs) {
        await mkdir(join(projectDir, d), { recursive: true });
      }

      // Generate files
      await writeFile(
        join(projectDir, "CMakeLists.txt"),
        generateCMakeLists(parsed.name),
      );
      await writeFile(
        join(projectDir, "include", "Resources.h"),
        generateResourcesH(),
      );
      await writeFile(
        join(projectDir, "src", `${parsed.name}App.cpp`),
        generateMainCpp(parsed.name, parsed.template),
      );

      // Verify Cinder path availability
      const config = readConfig();
      let cinderNote = "";
      if (!config.CINDER_PATH) {
        cinderNote =
          "\n\n> **Note:** CINDER_PATH is not configured yet. Set it with `set_cinder_path` before building.";
      }

      return `# Project Created

**Name:** ${parsed.name}
**Template:** ${parsed.template}
**Path:** \`${projectDir}\`

## Files generated

\`\`\`
${parsed.name}/
  CMakeLists.txt
  src/${parsed.name}App.cpp
  include/Resources.h
  assets/
  resources/
\`\`\`

## Build instructions

\`\`\`bash
cd ${projectDir}
mkdir build && cd build
cmake .. -DCINDER_PATH=\${CINDER_PATH}
cmake --build .
\`\`\`

For Xcode: \`cmake .. -G Xcode -DCINDER_PATH=\${CINDER_PATH}\`
For Visual Studio: \`cmake .. -G "Visual Studio 17" -DCINDER_PATH=\${CINDER_PATH}\`${cinderNote}`;
    }

    // ----- configure_build -----
    case "configure_build": {
      const parsed = ConfigureBuildSchema.parse(args);
      const cmakePath = join(parsed.project_path, "CMakeLists.txt");

      if (!existsSync(cmakePath)) {
        return `CMakeLists.txt not found at ${cmakePath}. Is this a valid Cinder project?`;
      }

      let cmake = await readFile(cmakePath, "utf-8");
      const additions: string[] = [];

      // Add source files
      if (parsed.add_sources && parsed.add_sources.length > 0) {
        const files = parsed.add_sources.map((f) => `  \${CMAKE_CURRENT_SOURCE_DIR}/${f}`).join("\n");
        const block = `\n# Additional source files\nlist(APPEND SRC_FILES\n${files}\n)\n`;
        cmake += block;
        additions.push(`${parsed.add_sources.length} source file(s)`);
      }

      // Add include directories
      if (parsed.add_includes && parsed.add_includes.length > 0) {
        const dirs = parsed.add_includes.map((d) => `  \${CMAKE_CURRENT_SOURCE_DIR}/${d}`).join("\n");
        const block = `\n# Additional include directories\ntarget_include_directories(\${PROJECT_NAME} PUBLIC\n${dirs}\n)\n`;
        cmake += block;
        additions.push(`${parsed.add_includes.length} include directory(s)`);
      }

      // Add link libraries
      if (parsed.add_libraries && parsed.add_libraries.length > 0) {
        const libs = parsed.add_libraries.map((l) => `  ${l}`).join("\n");
        const block = `\n# Additional libraries\ntarget_link_libraries(\${PROJECT_NAME} PUBLIC\n${libs}\n)\n`;
        cmake += block;
        additions.push(`${parsed.add_libraries.length} library(s)`);
      }

      if (additions.length === 0) {
        return "No changes specified. Provide `add_sources`, `add_includes`, or `add_libraries`.";
      }

      await writeFile(cmakePath, cmake);

      return `# Build Configuration Updated

**Project:** \`${parsed.project_path}\`

## Changes

${additions.map((a) => `- Added ${a}`).join("\n")}

CMakeLists.txt has been updated. Re-run cmake to apply changes:

\`\`\`bash
cd ${parsed.project_path}/build
cmake ..
\`\`\``;
    }

    // ----- create_from_sample -----
    case "create_from_sample": {
      const parsed = CreateFromSampleSchema.parse(args);
      const config = readConfig();

      if (!config.CINDER_PATH) {
        return "CINDER_PATH is not configured. Set it with the `set_cinder_path` tool first.";
      }

      const sampleDir = join(config.CINDER_PATH, "samples", parsed.sample_name);
      if (!existsSync(sampleDir)) {
        return `Sample "${parsed.sample_name}" not found at ${sampleDir}. Use \`list_samples\` to see available samples.`;
      }

      const destDir = join(parsed.path, parsed.name);
      if (existsSync(destDir)) {
        return `Destination already exists: ${destDir}`;
      }

      // Copy the sample directory
      await cp(sampleDir, destDir, { recursive: true });

      // Update CMakeLists.txt if it exists — rename project references
      const cmakePath = join(destDir, "CMakeLists.txt");
      if (existsSync(cmakePath)) {
        let cmake = await readFile(cmakePath, "utf-8");
        cmake = cmake.replace(
          new RegExp(parsed.sample_name, "g"),
          parsed.name,
        );
        await writeFile(cmakePath, cmake);
      }

      // Also try proj/cmake/CMakeLists.txt (common in Cinder samples)
      const projCmake = join(destDir, "proj", "cmake", "CMakeLists.txt");
      if (existsSync(projCmake)) {
        let cmake = await readFile(projCmake, "utf-8");
        cmake = cmake.replace(
          new RegExp(parsed.sample_name, "g"),
          parsed.name,
        );
        await writeFile(projCmake, cmake);
      }

      // List what was copied
      let fileList = "";
      try {
        const topLevel = await readdir(destDir);
        fileList = topLevel.map((f) => `  ${f}`).join("\n");
      } catch {
        fileList = "  (unable to list files)";
      }

      return `# Project Created from Sample

**Based on:** ${parsed.sample_name}
**New name:** ${parsed.name}
**Path:** \`${destDir}\`

## Contents

\`\`\`
${fileList}
\`\`\`

Project references have been renamed from "${parsed.sample_name}" to "${parsed.name}".

## Build

\`\`\`bash
cd ${destDir}
mkdir build && cd build
cmake .. -DCINDER_PATH=\${CINDER_PATH}
cmake --build .
\`\`\``;
    }

    default:
      return `Unknown scaffold tool: ${name}`;
  }
}
