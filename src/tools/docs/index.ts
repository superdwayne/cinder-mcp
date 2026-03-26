/**
 * US-003 — Documentation tools
 * 7 tools that query the SQLite FTS5 knowledge base at data/cinder.db.
 */

import { z } from "zod";
import {
  searchDocs,
  getClassEntry,
  getNamespaceEntries,
  getGuideEntry,
  listAllCategories,
  type DocEntry,
  type SearchResult,
} from "../../knowledge-db.js";
import { readConfig } from "../../config.js";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SearchDocsSchema = z.object({
  query: z.string().describe("Full-text search query"),
  category: z.string().optional().describe("Filter by category"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
});

const GetClassSchema = z.object({
  class_name: z.string().describe("Cinder class name, e.g. gl::Texture2d"),
});

const GetNamespaceSchema = z.object({
  namespace: z.string().describe('Namespace path, e.g. "cinder::gl"'),
});

const GetGuideSchema = z.object({
  guide_name: z
    .string()
    .describe('Guide topic, e.g. "opengl", "audio", "setup"'),
});

const GetSampleSchema = z.object({
  sample_name: z.string().describe("Name of the Cinder sample project"),
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
    name: "search_docs",
    description:
      "Full-text search across the Cinder knowledge base. Returns matching entries with title, category, snippet, and relevance score.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text search query" },
        category: {
          type: "string",
          description: "Optional category filter (e.g. OpenGL, Audio, Math)",
        },
        limit: {
          type: "number",
          description: "Max results (default 10, max 50)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_class",
    description:
      "Get full reference for a Cinder class: description, methods, properties, inheritance, namespace, and code examples.",
    inputSchema: {
      type: "object",
      properties: {
        class_name: {
          type: "string",
          description: "Cinder class name, e.g. gl::Texture2d",
        },
      },
      required: ["class_name"],
    },
  },
  {
    name: "get_namespace",
    description:
      'List all classes and functions in a Cinder namespace (e.g. "cinder::gl").',
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: 'Namespace, e.g. "cinder::gl"',
        },
      },
      required: ["namespace"],
    },
  },
  {
    name: "list_categories",
    description:
      "List all 10 Cinder API categories with descriptions.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_guide",
    description:
      'Fetch a Cinder guide entry from the knowledge base (e.g. "opengl", "audio", "setup").',
    inputSchema: {
      type: "object",
      properties: {
        guide_name: {
          type: "string",
          description: "Guide topic name",
        },
      },
      required: ["guide_name"],
    },
  },
  {
    name: "list_samples",
    description:
      "List available Cinder sample projects with descriptions.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_sample",
    description:
      "Get the source code and description of a Cinder sample project.",
    inputSchema: {
      type: "object",
      properties: {
        sample_name: {
          type: "string",
          description: "Sample project name",
        },
      },
      required: ["sample_name"],
    },
  },
];

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  Geometry:
    "Meshes, TriMesh, VboMesh, geom::Source primitives, PolyLine, Shape2d, Path2d",
  Math: "Vectors, matrices, quaternions, Perlin noise, Rand, easing functions",
  System:
    "Filesystem, Timer, Signals, Xml, Json, Buffer, serialisation utilities",
  Platform:
    "App lifecycle, window management, display enumeration, platform abstractions",
  OpenGL:
    "gl::Texture, gl::Fbo, gl::GlslProg, gl::Batch, gl::VboMesh, scoped state",
  "2D Graphics":
    "Cairo backend, SVG, Surface, Channel, ColorA, drawing utilities",
  Audio:
    "Audio graph: Context, FilePlayerNode, GenNode, MonitorNode, FFT analysis",
  Video: "QuickTime playback (qtime::MovieGl), video capture (Capture)",
  Images:
    "Image loading/saving, Surface, Channel, ip:: image processing functions",
  App: "AppBase, AppMac, AppMSW, setup/update/draw lifecycle, events, params",
};

const CURATED_SAMPLES = [
  { name: "BasicApp", description: "Minimal Cinder app — clear screen and draw a circle." },
  { name: "CairoBasic", description: "2D drawing with the Cairo backend." },
  { name: "FBOBasic", description: "Render-to-texture using gl::Fbo." },
  { name: "GeometryApp", description: "Demonstrates geom::Source primitives and transforms." },
  { name: "HodesonParticles", description: "GPU particle system with Transform Feedback." },
  { name: "AudioBasic", description: "Audio file playback with FilePlayerNode." },
  { name: "AudioAnalysis", description: "Real-time FFT spectrum visualisation." },
  { name: "CameraPersp", description: "Perspective camera with mouse-driven CameraUi." },
  { name: "ConvexHull", description: "Computes and renders convex hulls from 2D points." },
  { name: "Earthquake", description: "3D globe with earthquake data mapped to a sphere." },
  { name: "FlockingApp", description: "Classic boids flocking simulation." },
  { name: "GLSLProg", description: "Loading and using custom GLSL shaders." },
  { name: "ImageFileBasic", description: "Loading, displaying, and saving images." },
  { name: "MandelbrotGLSL", description: "Mandelbrot set rendered via a fragment shader." },
  { name: "ObjLoader", description: "Loading and rendering .obj mesh files." },
  { name: "ParamsBasic", description: "Using params::InterfaceGl for runtime tweaking." },
  { name: "PickingByColor", description: "Object picking via unique-colour FBO readback." },
  { name: "StarsApp", description: "3D star field with camera fly-through." },
  { name: "VoronoiGPU", description: "GPU-accelerated Voronoi diagram using shaders." },
];

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  const lines = results.map(
    (r, i) =>
      `### ${i + 1}. ${r.title}\n**Category:** ${r.category} | **Type:** ${r.type} | **Score:** ${Math.abs(r.rank).toFixed(2)}\n\n${r.snippet}\n`,
  );
  return lines.join("\n---\n\n");
}

function formatClassEntry(entry: DocEntry): string {
  let md = `# ${entry.title}\n\n`;
  if (entry.namespace) md += `**Namespace:** \`${entry.namespace}\`\n\n`;
  md += `**Category:** ${entry.category}\n\n`;
  md += entry.content;
  return md;
}

function formatNamespace(entries: DocEntry[], ns: string): string {
  let md = `# Namespace: \`${ns}\`\n\n`;
  md += `**${entries.length} entries**\n\n`;

  const grouped: Record<string, DocEntry[]> = {};
  for (const e of entries) {
    const key = e.type || "other";
    (grouped[key] ??= []).push(e);
  }

  for (const [type, items] of Object.entries(grouped)) {
    md += `## ${type.charAt(0).toUpperCase() + type.slice(1)}s\n\n`;
    for (const item of items) {
      const brief = item.content.slice(0, 120).replace(/\n/g, " ");
      md += `- **${item.title}** — ${brief}\n`;
    }
    md += "\n";
  }
  return md;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    // ----- search_docs -----
    case "search_docs": {
      const parsed = SearchDocsSchema.parse(args);
      const results = searchDocs(parsed.query, parsed.category, parsed.limit);
      if (typeof results === "string") return results;
      return formatSearchResults(results);
    }

    // ----- get_class -----
    case "get_class": {
      const { class_name } = GetClassSchema.parse(args);
      const entry = getClassEntry(class_name);
      if (typeof entry === "string") return entry;
      return formatClassEntry(entry);
    }

    // ----- get_namespace -----
    case "get_namespace": {
      const { namespace } = GetNamespaceSchema.parse(args);
      const entries = getNamespaceEntries(namespace);
      if (typeof entries === "string") return entries;
      return formatNamespace(entries, namespace);
    }

    // ----- list_categories -----
    case "list_categories": {
      const dbCats = listAllCategories();
      let md = "# Cinder API Categories\n\n";
      for (const [cat, desc] of Object.entries(CATEGORY_DESCRIPTIONS)) {
        const inDb =
          typeof dbCats !== "string" && dbCats.includes(cat) ? " (indexed)" : "";
        md += `- **${cat}**${inDb}: ${desc}\n`;
      }
      if (typeof dbCats === "string") {
        md += `\n> ${dbCats}\n`;
      }
      return md;
    }

    // ----- get_guide -----
    case "get_guide": {
      const { guide_name } = GetGuideSchema.parse(args);
      const entry = getGuideEntry(guide_name);
      if (typeof entry === "string") return entry;
      return `# Guide: ${entry.title}\n\n${entry.content}`;
    }

    // ----- list_samples -----
    case "list_samples": {
      const config = readConfig();
      let md = "# Cinder Sample Projects\n\n";

      // Try to list from CINDER_PATH/samples/
      if (config.CINDER_PATH) {
        const samplesDir = join(config.CINDER_PATH, "samples");
        if (existsSync(samplesDir)) {
          try {
            const entries = await readdir(samplesDir, {
              withFileTypes: true,
            });
            const dirs = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith("."))
              .map((e) => e.name)
              .sort();
            if (dirs.length > 0) {
              md += `## From CINDER_PATH (${samplesDir})\n\n`;
              for (const d of dirs) {
                md += `- **${d}**\n`;
              }
              md += "\n";
            }
          } catch {
            // fall through to curated list
          }
        }
      }

      md += "## Curated Samples\n\n";
      for (const s of CURATED_SAMPLES) {
        md += `- **${s.name}** — ${s.description}\n`;
      }
      return md;
    }

    // ----- get_sample -----
    case "get_sample": {
      const { sample_name } = GetSampleSchema.parse(args);
      const config = readConfig();

      if (!config.CINDER_PATH) {
        return "CINDER_PATH is not configured. Set it with the `set_cinder_path` tool.";
      }

      const sampleDir = join(config.CINDER_PATH, "samples", sample_name);
      if (!existsSync(sampleDir)) {
        return `Sample "${sample_name}" not found at ${sampleDir}. Use \`list_samples\` to see available samples.`;
      }

      let md = `# Sample: ${sample_name}\n\n`;
      md += `**Path:** \`${sampleDir}\`\n\n`;

      // Try to read main source file — common patterns
      const srcCandidates = [
        join(sampleDir, "src", `${sample_name}App.cpp`),
        join(sampleDir, "src", `${sample_name}.cpp`),
        join(sampleDir, "src", "main.cpp"),
      ];

      let found = false;
      for (const srcPath of srcCandidates) {
        if (existsSync(srcPath)) {
          const content = await readFile(srcPath, "utf-8");
          md += `## Source: \`${srcPath.replace(sampleDir, ".")}\`\n\n\`\`\`cpp\n${content}\n\`\`\`\n`;
          found = true;
          break;
        }
      }

      // If no single file found, list the src/ directory
      if (!found) {
        const srcDir = join(sampleDir, "src");
        if (existsSync(srcDir)) {
          const files = await readdir(srcDir);
          md += "## Source files\n\n";
          for (const f of files) {
            if (f.endsWith(".cpp") || f.endsWith(".h")) {
              const content = await readFile(join(srcDir, f), "utf-8");
              md += `### ${f}\n\n\`\`\`cpp\n${content}\n\`\`\`\n\n`;
            }
          }
        } else {
          md += "_No src/ directory found._\n";
        }
      }

      // Check for a README
      for (const readme of ["README.md", "README.txt", "readme.md"]) {
        const rp = join(sampleDir, readme);
        if (existsSync(rp)) {
          const content = await readFile(rp, "utf-8");
          md += `\n## README\n\n${content}\n`;
          break;
        }
      }

      return md;
    }

    default:
      return `Unknown docs tool: ${name}`;
  }
}
