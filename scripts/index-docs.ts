#!/usr/bin/env tsx
/**
 * index-docs.ts
 * Placeholder script that would scrape libcinder.org/docs.
 * For now, generates stub API entries for all categories and namespaces
 * and outputs them to knowledge/api/ as markdown files.
 */

import * as fs from "fs";
import * as path from "path";

const API_DIR = path.resolve(__dirname, "../knowledge/api");

interface NamespaceStub {
  filename: string;
  namespace: string;
  category: string;
  title: string;
  description: string;
  classes: { name: string; description: string; methods: string[] }[];
}

const stubs: NamespaceStub[] = [
  {
    filename: "gl.md",
    namespace: "cinder::gl",
    category: "OpenGL",
    title: "ci::gl — OpenGL Wrapper",
    description:
      "High-level OpenGL abstraction layer providing managed GPU resources, shader programs, and draw calls.",
    classes: [
      {
        name: "Texture2d / Texture2dRef",
        description: "2D texture wrapper with format options, mipmapping, and pixel transfer.",
        methods: ["create()", "bind()", "unbind()", "getWidth()", "getHeight()", "update()", "setWrap()", "setMinFilter()", "setMagFilter()"],
      },
      {
        name: "Fbo / FboRef",
        description: "Framebuffer Object for off-screen rendering.",
        methods: ["create()", "bindFramebuffer()", "unbindFramebuffer()", "getColorTexture()", "getDepthTexture()", "getSize()"],
      },
      {
        name: "GlslProg / GlslProgRef",
        description: "GLSL shader program compilation, linking, and uniform management.",
        methods: ["create()", "bind()", "uniform()", "getAttribLocation()", "getUniformLocation()"],
      },
      {
        name: "Batch / BatchRef",
        description: "Combines geometry (VboMesh) with a shader (GlslProg) for efficient draw calls.",
        methods: ["create()", "draw()", "replaceGlslProg()", "replaceVboMesh()", "getGlslProg()", "getVboMesh()"],
      },
      {
        name: "Vbo / VboRef",
        description: "Vertex Buffer Object for raw GPU buffer management.",
        methods: ["create()", "bind()", "bufferData()", "bufferSubData()", "map()", "unmap()"],
      },
      {
        name: "VboMesh / VboMeshRef",
        description: "Managed vertex buffer mesh with attribute layout.",
        methods: ["create()", "getNumVertices()", "getNumIndices()", "appendVbo()", "bufferAttrib()"],
      },
      {
        name: "Vao / VaoRef",
        description: "Vertex Array Object for attribute state management.",
        methods: ["create()", "bind()", "unbind()", "replacementBindBegin()", "replacementBindEnd()"],
      },
    ],
  },
  {
    filename: "geom.md",
    namespace: "cinder::geom",
    category: "Geometry",
    title: "ci::geom — Geometry Primitives & Modifiers",
    description:
      "Procedural geometry generation with composable sources and modifiers.",
    classes: [
      {
        name: "Sphere",
        description: "UV sphere with configurable subdivisions.",
        methods: ["radius()", "subdivisions()", "center()"],
      },
      {
        name: "Cube",
        description: "Axis-aligned cube / box.",
        methods: ["size()", "colors()"],
      },
      {
        name: "Torus",
        description: "Torus with major/minor radius.",
        methods: ["radius()", "ratio()", "subdivisionsAxis()", "subdivisionsHeight()"],
      },
      {
        name: "Plane",
        description: "2D plane in 3D space.",
        methods: ["size()", "subdivisions()", "origin()", "normal()"],
      },
      {
        name: "Twist",
        description: "Modifier that twists geometry along an axis.",
        methods: ["axis()", "angle()"],
      },
      {
        name: "Translate / Scale / Rotate",
        description: "Transform modifiers for geometry sources.",
        methods: ["Translate(vec3)", "Scale(vec3)", "Rotate(float, vec3)"],
      },
    ],
  },
  {
    filename: "audio.md",
    namespace: "cinder::audio",
    category: "Audio",
    title: "ci::audio — Audio Engine",
    description:
      "Node-based audio graph for synthesis, analysis, playback, and recording.",
    classes: [
      {
        name: "Context",
        description: "Main audio context managing the node graph and device I/O.",
        methods: ["master()", "makeNode()", "enable()", "disable()", "getSampleRate()", "getFramesPerBlock()"],
      },
      {
        name: "Voice / VoiceRef",
        description: "High-level audio playback for simple use cases.",
        methods: ["create()", "start()", "stop()", "setVolume()", "setPan()"],
      },
      {
        name: "BufferPlayerNode",
        description: "Plays an audio::Buffer with sample-accurate control.",
        methods: ["start()", "stop()", "seek()", "setBuffer()", "isEnabled()", "setLoopEnabled()"],
      },
      {
        name: "MonitorSpectralNode",
        description: "FFT analysis node providing magnitude spectrum.",
        methods: ["getMagSpectrum()", "getNumBins()", "getSmoothingFactor()", "setFftSize()", "getFreqForBin()"],
      },
      {
        name: "GainNode",
        description: "Multiplies signal amplitude.",
        methods: ["setValue()", "getValue()", "getParam()"],
      },
      {
        name: "GenSineNode / GenOscNode",
        description: "Oscillator nodes for synthesis.",
        methods: ["setFreq()", "getFreq()", "start()", "stop()"],
      },
    ],
  },
  {
    filename: "app.md",
    namespace: "cinder::app",
    category: "App",
    title: "ci::app — Application Framework",
    description:
      "Application lifecycle, window management, input events, and resource loading.",
    classes: [
      {
        name: "App",
        description: "Base application class with setup/update/draw lifecycle.",
        methods: ["setup()", "update()", "draw()", "cleanup()", "prepareSettings()", "getElapsedSeconds()", "getElapsedFrames()", "quit()"],
      },
      {
        name: "Window",
        description: "Platform window abstraction.",
        methods: ["getSize()", "setSize()", "getPos()", "setPos()", "setTitle()", "setFullScreen()", "isFullScreen()", "close()"],
      },
      {
        name: "MouseEvent",
        description: "Mouse input event data.",
        methods: ["getPos()", "getX()", "getY()", "isLeft()", "isRight()", "isMiddle()", "isShiftDown()", "isControlDown()"],
      },
      {
        name: "KeyEvent",
        description: "Keyboard input event data.",
        methods: ["getCode()", "getChar()", "isShiftDown()", "isControlDown()", "isAltDown()"],
      },
      {
        name: "FileDropEvent",
        description: "File drag-and-drop event.",
        methods: ["getFiles()", "getNumFiles()", "getFile()"],
      },
    ],
  },
  {
    filename: "cairo.md",
    namespace: "cinder::cairo",
    category: "2D Graphics",
    title: "ci::cairo — 2D Vector Graphics",
    description:
      "Cairo-based 2D rendering with paths, gradients, text, and PDF/SVG export.",
    classes: [
      {
        name: "Context",
        description: "Cairo drawing context with path, stroke, and fill operations.",
        methods: ["moveTo()", "lineTo()", "curveTo()", "arc()", "fill()", "stroke()", "setSource()", "setLineWidth()", "save()", "restore()"],
      },
      {
        name: "SurfaceImage",
        description: "Pixel-backed cairo surface for rasterized output.",
        methods: ["create()", "getSurface()", "getWidth()", "getHeight()"],
      },
      {
        name: "GradientLinear",
        description: "Linear gradient pattern.",
        methods: ["GradientLinear()", "addColorStop()"],
      },
      {
        name: "GradientRadial",
        description: "Radial gradient pattern.",
        methods: ["GradientRadial()", "addColorStop()"],
      },
    ],
  },
  {
    filename: "ip.md",
    namespace: "cinder::ip",
    category: "Images",
    title: "ci::ip — Image Processing",
    description:
      "CPU-based image processing operations on Surface and Channel types.",
    classes: [
      {
        name: "Functions (free functions)",
        description: "Image processing utilities operating on Surface8u / Surface32f.",
        methods: ["resize()", "flipVertical()", "flipHorizontal()", "threshold()", "grayscale()", "blend()", "fill()", "hFlip()", "edgeDetectSobel()"],
      },
      {
        name: "Surface8u / Surface32f",
        description: "CPU image buffer with 8-bit or 32-bit float channels.",
        methods: ["create()", "getWidth()", "getHeight()", "getPixel()", "setPixel()", "getData()", "getRowBytes()"],
      },
      {
        name: "Channel8u / Channel32f",
        description: "Single-channel image buffer.",
        methods: ["create()", "getValue()", "setValue()", "getWidth()", "getHeight()"],
      },
    ],
  },
  {
    filename: "svg.md",
    namespace: "cinder::svg",
    category: "2D Graphics",
    title: "ci::svg — SVG Loading & Rendering",
    description:
      "SVG document parsing, node traversal, and rendering to OpenGL or Cairo.",
    classes: [
      {
        name: "Doc",
        description: "Parsed SVG document root.",
        methods: ["create()", "getWidth()", "getHeight()", "getNumChildren()", "findNode()"],
      },
      {
        name: "Node",
        description: "Base class for SVG elements.",
        methods: ["getId()", "getTransform()", "getBoundingBox()"],
      },
      {
        name: "Renderer (gl / cairo)",
        description: "Renders SVG nodes to a target backend.",
        methods: ["draw()", "setScale()"],
      },
    ],
  },
  {
    filename: "signals.md",
    namespace: "cinder::signals",
    category: "System",
    title: "ci::signals — Signal/Slot System",
    description:
      "Type-safe signal/slot connections for event-driven programming.",
    classes: [
      {
        name: "Signal<void(Args...)>",
        description: "Type-safe signal that can connect to multiple slots.",
        methods: ["connect()", "disconnect()", "disconnectAll()", "emit()", "getNumSlots()"],
      },
      {
        name: "Connection",
        description: "Handle to a signal-slot connection.",
        methods: ["disconnect()", "isConnected()", "enable()", "disable()"],
      },
      {
        name: "ScopedConnection",
        description: "RAII connection that disconnects on destruction.",
        methods: ["ScopedConnection()", "operator=()"],
      },
    ],
  },
  {
    filename: "params.md",
    namespace: "cinder::params",
    category: "System",
    title: "ci::params — Debug UI Parameters",
    description:
      "AntTweakBar-based debug parameter UI for runtime tweaking.",
    classes: [
      {
        name: "InterfaceGl / InterfaceGlRef",
        description: "Debug parameter window with various control types.",
        methods: ["create()", "addParam()", "addButton()", "addSeparator()", "addText()", "setOptions()", "minimize()", "maximize()", "draw()"],
      },
    ],
  },
  {
    filename: "log.md",
    namespace: "cinder::log",
    category: "System",
    title: "ci::log — Logging System",
    description:
      "Hierarchical logging with configurable levels and multiple output targets.",
    classes: [
      {
        name: "Logger / LoggerRef",
        description: "Central logging manager.",
        methods: ["makeLogger()", "setLevel()", "getLevel()"],
      },
      {
        name: "LoggerConsole",
        description: "Outputs log messages to stdout/stderr.",
        methods: ["write()"],
      },
      {
        name: "LoggerFile",
        description: "Outputs log messages to a file.",
        methods: ["LoggerFile()", "write()"],
      },
      {
        name: "Macros",
        description: "Convenience logging macros.",
        methods: ["CI_LOG_V()", "CI_LOG_D()", "CI_LOG_I()", "CI_LOG_W()", "CI_LOG_E()"],
      },
    ],
  },
];

function generateStubMarkdown(stub: NamespaceStub): string {
  let md = `---
title: "${stub.title}"
category: "${stub.category}"
namespace: "${stub.namespace}"
tags: [api, reference, ${stub.category.toLowerCase()}]
---

# ${stub.title}

${stub.description}

> **Note:** This is a stub generated by \`index-docs.ts\`. It will be enriched
> when the libcinder.org documentation scraper is implemented.

## Classes & Key Types

`;

  for (const cls of stub.classes) {
    md += `### ${cls.name}\n\n`;
    md += `${cls.description}\n\n`;
    md += `**Key methods:**\n`;
    for (const method of cls.methods) {
      md += `- \`${method}\`\n`;
    }
    md += "\n";
  }

  md += `## See Also

- [libcinder.org/docs](https://libcinder.org/docs) — Official API reference
- [Cinder Guide](https://libcinder.org/docs/guides/) — Tutorials and guides
`;

  return md;
}

function main() {
  // Ensure output directory exists
  fs.mkdirSync(API_DIR, { recursive: true });

  console.log(`Generating API stubs in ${API_DIR}...\n`);

  for (const stub of stubs) {
    const content = generateStubMarkdown(stub);
    const outPath = path.join(API_DIR, stub.filename);
    fs.writeFileSync(outPath, content, "utf-8");
    console.log(`  Created: ${stub.filename} (${stub.namespace})`);
  }

  console.log(`\nGenerated ${stubs.length} API stub files.`);
  console.log(
    "Run build-knowledge.ts to index these into the FTS5 database."
  );
}

main();
