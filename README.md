# Cinder MCP Server

An MCP (Model Context Protocol) server that gives AI assistants deep integration with the [Cinder](https://libcinder.org/) creative coding framework. Build, run, inspect, and modify Cinder applications through structured tool calls.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Tool Reference](#tool-reference)
- [CinderBridge Setup](#cinderbridge-setup)
- [Knowledge Base](#knowledge-base)
- [Runtime Bridge](#runtime-bridge)
- [Configuration](#configuration)
- [Contributing](#contributing)

---

## Overview

The Cinder MCP server exposes **57 tools** across 8 categories that enable AI assistants to:

- **Scaffold** new Cinder projects from templates
- **Build** and run projects with CMake, with structured error parsing
- **Generate** GLSL shaders, audio graphs, particle systems, and UI code
- **Manage assets** with validation and C++ loader code generation
- **Search documentation** and browse the Cinder API
- **Control running apps** in real-time via an OSC bridge
- **Diagnose** build errors and OpenGL issues
- **Manage CinderBlocks** and project configuration

---

## Installation

### Prerequisites

- **Node.js** 18+
- **Cinder** (latest release from [libcinder.org](https://libcinder.org/))
- **CMake** 3.19+
- **C++ compiler**: clang++ (macOS), MSVC (Windows), or g++ (Linux)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-org/cinder-mcp.git
cd cinder-mcp

# Install dependencies
npm install

# Set the Cinder path
export CINDER_PATH=/path/to/cinder

# Build the server
npm run build

# Index the knowledge base (optional, for documentation search)
npm run index-knowledge
```

### MCP Client Configuration

Add to your MCP client config (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cinder": {
      "command": "node",
      "args": ["/path/to/cinder-mcp/dist/index.js"],
      "env": {
        "CINDER_PATH": "/path/to/cinder"
      }
    }
  }
}
```

---

## Quick Start

**1. Verify your Cinder installation:**

Use the `check_cinder_install` tool to verify everything is configured correctly.

**2. Create a new project:**

Use `create_project` with a name and path. The server generates a complete project skeleton with CMakeLists.txt, source files, and asset directories.

**3. Add assets:**

Use `add_asset` to copy images, shaders, or models into your project. The server returns ready-to-use C++ loader code.

**4. Build and run:**

Use `build_and_run` to compile with CMake and launch the application. Build errors are parsed and returned as structured data with file, line, and message.

**5. Connect for live control:**

Include the CinderBridge header in your app, then use runtime tools (`set_uniform`, `set_camera`, `hot_reload_shader`) to modify the running application in real time.

---

## Tool Reference

### Scaffold Tools (3 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `create_project` | Create a new Cinder project from template | `name`, `path`, `template` |
| `configure_build` | Configure CMake build settings | `project_path`, `generator`, `build_type` |
| `create_from_sample` | Create project from a Cinder sample | `sample_name`, `dest_path` |

### Build Tools (4 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `build` | Build with CMake, returns structured errors | `project_path`, `generator`, `config` |
| `run` | Run compiled binary (detached) | `project_path`, `config` |
| `clean` | Remove build directory | `project_path` |
| `build_and_run` | Build then run if successful | `project_path`, `generator`, `config` |

### Code Generation Tools (8 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `generate_shader` | Generate GLSL vertex + fragment shaders | `effect`, `shader_type` |
| `generate_batch` | Generate gl::Batch setup code | `geometry`, `shader_name` |
| `generate_fbo_pipeline` | Generate multi-pass FBO pipeline | `passes`, `width`, `height` |
| `generate_audio_graph` | Generate audio node graph | `nodes` |
| `generate_audio_reactive` | Generate audio-reactive visual code | `source`, `bands` |
| `generate_particle_system` | Generate particle system | `max_particles`, `forces`, `emitter_type` |
| `generate_params_ui` | Generate params UI code | `params` |
| `generate_params_from_uniforms` | Parse GLSL and generate params | `shader_path` |

### Asset Tools (4 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_assets` | List all assets with type/size info | `project_path` |
| `add_asset` | Copy asset and generate loader code | `project_path`, `source_path`, `subfolder` |
| `generate_resource_macros` | Generate Resources.h with CINDER_RESOURCE | `project_path` |
| `validate_assets` | Cross-reference code vs. files on disk | `project_path` |

### Documentation Tools (7 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `search_docs` | Full-text search of Cinder docs | `query` |
| `get_class` | Get class documentation | `class_name` |
| `get_namespace` | Get namespace listing | `namespace` |
| `list_categories` | List documentation categories | -- |
| `get_guide` | Get a specific guide | `guide_name` |
| `list_samples` | List sample projects | `category` |
| `get_sample` | Get sample project details | `sample_name` |

### Runtime Tools (21 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_apps` | Scan for running Cinder apps | -- |
| `connect` | Connect to app via OSC | `port` |
| `disconnect` | Disconnect from app | -- |
| `status` | Get connection status | -- |
| `get_scene` | Get scene graph | -- |
| `set_uniform` | Set shader uniform | `name`, `value` |
| `get_uniforms` | Get all uniforms | -- |
| `set_param` | Set app parameter | `name`, `value` |
| `get_params` | Get all parameters | -- |
| `animate_param` | Animate parameter over time | `name`, `target`, `duration`, `easing` |
| `screenshot` | Capture screenshot | `path` |
| `set_window_size` | Set window dimensions | `width`, `height` |
| `toggle_fullscreen` | Toggle fullscreen | -- |
| `set_camera` | Set camera position/target | `eye`, `target`, `up` |
| `set_clear_color` | Set background color | `r`, `g`, `b`, `a` |
| `set_framerate` | Set target FPS | `fps` |
| `set_audio_gain` | Set audio gain | `gain` |
| `set_audio_pan` | Set audio pan | `pan` |
| `play_audio` | Play audio file | `path` |
| `stop_audio` | Stop audio playback | -- |
| `get_audio_spectrum` | Get spectrum data | `bands` |
| `hot_reload_shader` | Hot-reload shader files | `fragment_path`, `vertex_path` |

### Diagnostics Tools (3 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `diagnose_build_error` | Analyze build errors with fix suggestions | `error_text` |
| `diagnose_gl_error` | Explain GL error codes | `error_code` |
| `check_cinder_install` | Verify Cinder installation health | -- |

### Block & Config Tools (7 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_blocks` | List available CinderBlocks | -- |
| `get_block_info` | Get CinderBlock details | `block_name` |
| `add_block` | Add a CinderBlock to project | `project_path`, `block_name` |
| `search_blocks` | Search CinderBlock registry | `query` |
| `get_config` | Get server configuration | -- |
| `set_config` | Update configuration | `key`, `value` |
| `reset_config` | Reset to defaults | -- |

---

## CinderBridge Setup

### Single-Header Quick Start

Include the CinderBridge header in your Cinder app to enable real-time communication with the MCP server:

```cpp
#include "CinderBridge.h"

class MyApp : public ci::app::App {
public:
    CinderBridge bridge;

    void setup() override {
        bridge.setup();  // Starts OSC listener on port 9000
    }

    void update() override {
        bridge.update();  // Process incoming commands
    }

    void draw() override {
        ci::gl::clear();
        // Your drawing code...
    }
};
```

The single-header file is located at `cinder-bridge/CinderBridge.h`.

### CinderBlock Integration

For tighter integration, add CinderBridge as a CinderBlock:

1. Copy the `cinder-bridge/` directory into your Cinder blocks folder
2. Add to your CMakeLists.txt via `ci_make_app( BLOCKS CinderBridge )`

### Bridge Features

- **Uniform control**: Set shader uniforms by name
- **Parameter binding**: Expose ci::params values for remote tuning
- **Camera control**: Position and orient the camera
- **Shader hot-reload**: Update shaders without restarting
- **Screenshot capture**: Save framebuffer to disk
- **Audio control**: Play, stop, gain, pan, spectrum analysis

---

## Knowledge Base

The knowledge base provides indexed Cinder documentation and patterns for the `search_docs`, `get_class`, and `get_namespace` tools.

### Building the Index

```bash
npm run index-knowledge
```

This parses the Cinder documentation and API reference into a SQLite database at `data/knowledge.db`.

### How Search Works

- Full-text search across class docs, guides, and code samples
- Namespace browsing for organized API exploration
- Category filtering (GL, Audio, App, Math, etc.)

### Adding Patterns

Add markdown files to `knowledge/` with front-matter:

```markdown
---
category: patterns
tags: [shader, glsl, postprocess]
---
# Post-Processing Pipeline Pattern
...
```

Then rebuild the index with `npm run index-knowledge`.

---

## Runtime Bridge

### Architecture

```
+------------------+       TCP/OSC        +------------------+
|                  | <------------------> |                  |
|   Cinder MCP    |    Port 9000-9010    |   Cinder App     |
|   Server        |                      |   + CinderBridge |
|                  | --- command -------> |                  |
|                  | <-- ack/data ------- |                  |
+------------------+                      +------------------+
        |                                         |
        | MCP Protocol                            | OpenGL
        |                                         | Context
+------------------+                      +------------------+
|   AI Assistant   |                      |   GPU / Display  |
+------------------+                      +------------------+
```

### Port Scheme

| Port Range | Purpose |
|-----------|---------|
| 9000 | Default primary app |
| 9001-9009 | Additional app instances |
| 9010 | Reserved for discovery |

### Command Flow

1. AI assistant calls an MCP tool (e.g., `set_uniform`)
2. MCP server encodes the command as an OSC message with a unique ID
3. Command is sent over TCP to the CinderBridge in the running app
4. CinderBridge processes the command and sends an ack with the same ID
5. MCP server matches the ack and returns the result to the assistant

### OSC Message Format

- **Size-prefixed framing**: 4-byte big-endian length prefix
- **Command ID**: UUID string as first argument for ack matching
- **Standard OSC types**: float (f), int (i), string (s), blob (b)

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `CINDER_PATH` | -- | Path to Cinder installation (required) |
| `CINDER_MCP_PORT` | `9000` | Default OSC bridge port |
| `CINDER_MCP_TIMEOUT` | `5000` | Command timeout in ms |
| `CINDER_MCP_DB_PATH` | `data/knowledge.db` | Knowledge base path |
| `CINDER_MCP_RECONNECT` | `true` | Auto-reconnect on disconnect |
| `CINDER_MCP_MAX_RECONNECT` | `10` | Max reconnect attempts |
| `CINDER_MCP_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

Set via environment variables or in the MCP client configuration.

---

## Contributing

### Adding a New Tool

1. Create or edit a file in `src/tools/<category>/index.ts`
2. Add the tool definition to the `tools` array with name, description, and JSON Schema
3. Implement the handler in `handleToolCall`
4. Add tests in `tests/tools/<category>.test.ts`
5. Run `npm test` to verify

### Adding Knowledge Patterns

1. Add a markdown file to `knowledge/`
2. Include front-matter with `category` and `tags`
3. Run `npm run index-knowledge` to rebuild the database
4. Test with `search_docs`

### Project Structure

```
cinder-mcp/
  src/
    tools/
      scaffold/     — Project creation and CMake config
      build/        — Build, run, clean
      codegen/      — Shader, batch, FBO, audio, particle generation
      assets/       — Asset management and validation
      docs/         — Documentation search and browsing
      runtime/      — Live app control via OSC
      diagnostics/  — Error diagnosis and install checks
      blocks/       — CinderBlock management
      config/       — Server configuration
    runtime/
      osc-client.ts — TCP/OSC client for bridge communication
    config.ts       — Server configuration
    knowledge-db.ts — SQLite knowledge base
  cinder-bridge/    — C++ single-header bridge for Cinder apps
  knowledge/        — Markdown docs and patterns
  data/             — SQLite database (generated)
  tests/            — Vitest test suites
  scripts/          — Build and indexing scripts
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx vitest tests/tools/build.test.ts

# Run tests in watch mode
npx vitest --watch
```

---

## License

MIT
