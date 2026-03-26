import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, extname, basename, relative } from "node:path";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface AssetInfo {
  name: string;
  path: string;
  size: number;
  type: "image" | "audio" | "video" | "shader" | "model" | "other";
}

interface AssetValidation {
  valid: string[];
  missing: string[];
  unused: string[];
}

const EXTENSION_TYPE_MAP: Record<string, AssetInfo["type"]> = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".bmp": "image",
  ".tga": "image",
  ".tiff": "image",
  ".gif": "image",
  ".hdr": "image",
  ".exr": "image",
  ".wav": "audio",
  ".mp3": "audio",
  ".ogg": "audio",
  ".aiff": "audio",
  ".flac": "audio",
  ".mp4": "video",
  ".mov": "video",
  ".avi": "video",
  ".glsl": "shader",
  ".vert": "shader",
  ".frag": "shader",
  ".geom": "shader",
  ".comp": "shader",
  ".obj": "model",
  ".fbx": "model",
  ".gltf": "model",
  ".glb": "model",
  ".stl": "model",
  ".ply": "model",
};

function getAssetType(filename: string): AssetInfo["type"] {
  const ext = extname(filename).toLowerCase();
  return EXTENSION_TYPE_MAP[ext] || "other";
}

function listFilesRecursive(dir: string, basePath: string): AssetInfo[] {
  const assets: AssetInfo[] = [];

  if (!existsSync(dir)) return assets;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      assets.push(...listFilesRecursive(fullPath, basePath));
    } else {
      assets.push({
        name: entry,
        path: relative(basePath, fullPath),
        size: stat.size,
        type: getAssetType(entry),
      });
    }
  }

  return assets;
}

function generateLoaderSnippet(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const name = basename(filename, ext);

  switch (ext) {
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".bmp":
    case ".tga":
    case ".tiff":
    case ".hdr":
    case ".exr":
      return `auto tex = gl::Texture2d::create(loadImage(loadAsset("${filename}")));`;

    case ".vert":
      return `auto shader = gl::GlslProg::create(loadAsset("${filename}"), loadAsset("${name}.frag"));`;

    case ".frag":
      return `auto shader = gl::GlslProg::create(loadAsset("${name}.vert"), loadAsset("${filename}"));`;

    case ".glsl":
      return `auto shader = gl::GlslProg::create(loadAsset("${name}.vert"), loadAsset("${name}.frag"));`;

    case ".wav":
    case ".mp3":
    case ".ogg":
    case ".aiff":
    case ".flac":
      return `auto source = audio::load(loadAsset("${filename}"));`;

    case ".obj":
      return `auto mesh = ObjLoader(loadAsset("${filename}"));`;

    case ".fbx":
    case ".gltf":
    case ".glb":
      return `// Load 3D model: ${filename}\nauto model = loadAsset("${filename}");`;

    default:
      return `auto data = loadAsset("${filename}");`;
  }
}

function scanSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...scanSourceFiles(fullPath));
    } else {
      const ext = extname(entry).toLowerCase();
      if ([".cpp", ".h", ".hpp", ".cxx", ".cc"].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function extractAssetReferences(sourceFiles: string[]): {
  assetRefs: string[];
  resourceRefs: string[];
} {
  const assetRefs: Set<string> = new Set();
  const resourceRefs: Set<string> = new Set();

  const loadAssetRegex = /loadAsset\(\s*"([^"]+)"\s*\)/g;
  const loadResourceRegex = /loadResource\(\s*"([^"]+)"\s*\)/g;

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");

    let match: RegExpExecArray | null;
    while ((match = loadAssetRegex.exec(content)) !== null) {
      assetRefs.add(match[1]);
    }
    while ((match = loadResourceRegex.exec(content)) !== null) {
      resourceRefs.add(match[1]);
    }
  }

  return {
    assetRefs: Array.from(assetRefs),
    resourceRefs: Array.from(resourceRefs),
  };
}

export const tools: ToolDefinition[] = [
  {
    name: "list_assets",
    description:
      "List all assets in a Cinder project's assets/ directory with file type classification and sizes.",
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
    name: "add_asset",
    description:
      "Copy a file into a Cinder project's assets/ directory and generate the corresponding C++ loader code snippet.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Cinder project root directory",
        },
        source_path: {
          type: "string",
          description: "Path to the source file to copy into assets/",
        },
        subfolder: {
          type: "string",
          description: "Optional subfolder within assets/ to place the file",
        },
      },
      required: ["project_path", "source_path"],
    },
  },
  {
    name: "generate_resource_macros",
    description:
      "Scan a Cinder project's resources/ directory and generate a Resources.h header with CINDER_RESOURCE macros.",
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
    name: "validate_assets",
    description:
      "Cross-reference loadAsset() and loadResource() calls in source code with actual files in assets/ and resources/ directories.",
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
];

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_assets": {
      const projectPath = args.project_path as string;
      const assetsDir = join(projectPath, "assets");
      const assets = listFilesRecursive(assetsDir, assetsDir);
      return {
        project_path: projectPath,
        asset_count: assets.length,
        assets,
      };
    }

    case "add_asset": {
      const projectPath = args.project_path as string;
      const sourcePath = args.source_path as string;
      const subfolder = args.subfolder as string | undefined;

      if (!existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
      }

      let destDir = join(projectPath, "assets");
      if (subfolder) {
        destDir = join(destDir, subfolder);
      }

      mkdirSync(destDir, { recursive: true });

      const filename = basename(sourcePath);
      const destPath = join(destDir, filename);

      copyFileSync(sourcePath, destPath);

      const snippet = generateLoaderSnippet(filename);

      return {
        filename,
        destination: destPath,
        type: getAssetType(filename),
        loader_snippet: snippet,
      };
    }

    case "generate_resource_macros": {
      const projectPath = args.project_path as string;
      const resourcesDir = join(projectPath, "resources");

      if (!existsSync(resourcesDir)) {
        mkdirSync(resourcesDir, { recursive: true });
      }

      const resources = listFilesRecursive(resourcesDir, resourcesDir);

      let resourceId = 128;
      const macros: string[] = [];

      for (const resource of resources) {
        const macroName = resource.name
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .toUpperCase();
        const typeLabel = resource.type.toUpperCase();
        macros.push(
          `#define RES_${macroName}  CINDER_RESOURCE(../resources/, ${resource.path}, ${resourceId}, ${typeLabel})`,
        );
        resourceId++;
      }

      const header = [
        "#pragma once",
        '#include "cinder/CinderResources.h"',
        "",
        ...macros,
        "",
      ].join("\n");

      const includeDir = join(projectPath, "include");
      mkdirSync(includeDir, { recursive: true });
      const headerPath = join(includeDir, "Resources.h");
      writeFileSync(headerPath, header, "utf-8");

      return {
        path: headerPath,
        resource_count: resources.length,
        content: header,
      };
    }

    case "validate_assets": {
      const projectPath = args.project_path as string;
      const assetsDir = join(projectPath, "assets");
      const resourcesDir = join(projectPath, "resources");

      // Get actual files on disk
      const assetFiles = listFilesRecursive(assetsDir, assetsDir).map(
        (a) => a.path,
      );
      const resourceFiles = listFilesRecursive(
        resourcesDir,
        resourcesDir,
      ).map((r) => r.path);
      const allOnDisk = new Set([...assetFiles, ...resourceFiles]);

      // Get references from source code
      const srcDir = join(projectPath, "src");
      const sourceFiles = scanSourceFiles(srcDir);
      const { assetRefs, resourceRefs } = extractAssetReferences(sourceFiles);
      const allRefs = new Set([...assetRefs, ...resourceRefs]);

      const valid: string[] = [];
      const missing: string[] = [];
      const unused: string[] = [];

      for (const ref of allRefs) {
        if (allOnDisk.has(ref)) {
          valid.push(ref);
        } else {
          missing.push(ref);
        }
      }

      for (const file of allOnDisk) {
        if (!allRefs.has(file)) {
          unused.push(file);
        }
      }

      const result: AssetValidation = { valid, missing, unused };
      return result;
    }

    default:
      throw new Error(`Unknown asset tool: "${name}"`);
  }
}
