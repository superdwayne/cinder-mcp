/**
 * US-005 — CinderBlock tools
 * 3 tools: list_cinderblocks, add_cinderblock, get_cinderblock_info
 */

import { z } from "zod";
import { readConfig } from "../../config.js";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const AddCinderBlockSchema = z.object({
  project_path: z.string().min(1).describe("Path to the Cinder project"),
  block_name: z.string().min(1).describe("CinderBlock name"),
  git_url: z
    .string()
    .url()
    .optional()
    .describe("Git URL to clone the block from"),
});

const GetCinderBlockInfoSchema = z.object({
  block_name: z.string().min(1).describe("CinderBlock name"),
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
    name: "list_cinderblocks",
    description:
      "List all CinderBlocks from the local Cinder installation and well-known community blocks.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "add_cinderblock",
    description:
      "Add a CinderBlock to a project. Updates CMakeLists.txt with include paths and sources.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Cinder project",
        },
        block_name: { type: "string", description: "CinderBlock name" },
        git_url: {
          type: "string",
          description: "Git URL to clone (for community blocks)",
        },
      },
      required: ["project_path", "block_name"],
    },
  },
  {
    name: "get_cinderblock_info",
    description:
      "Get detailed info about a CinderBlock: description, author, dependencies, source files, platforms.",
    inputSchema: {
      type: "object",
      properties: {
        block_name: { type: "string", description: "CinderBlock name" },
      },
      required: ["block_name"],
    },
  },
];

// ---------------------------------------------------------------------------
// Well-known community blocks
// ---------------------------------------------------------------------------

interface CommunityBlock {
  name: string;
  description: string;
  author: string;
  git_url: string;
}

const COMMUNITY_BLOCKS: CommunityBlock[] = [
  {
    name: "Cinder-ImGui",
    description:
      "Dear ImGui integration for rapid debug UI and parameter tweaking.",
    author: "Simon Geilfus",
    git_url: "https://github.com/simongeilfus/Cinder-ImGui.git",
  },
  {
    name: "Cinder-OpenCV",
    description: "OpenCV computer vision bindings for Cinder.",
    author: "Cinder contributors",
    git_url: "https://github.com/cinder/Cinder-OpenCV.git",
  },
  {
    name: "Cinder-OSC",
    description: "Open Sound Control (OSC) networking for Cinder.",
    author: "Cinder contributors",
    git_url: "https://github.com/cinder/Cinder-OSC.git",
  },
  {
    name: "Cinder-MIDI",
    description: "MIDI input/output using RtMidi.",
    author: "Adrià Navarro",
    git_url: "https://github.com/adrianavarro/Cinder-MIDI2.git",
  },
  {
    name: "Cinder-Syphon",
    description: "Syphon frame sharing (macOS) for live visuals pipelines.",
    author: "Anthony Stellato",
    git_url: "https://github.com/astellato/Cinder-Syphon.git",
  },
  {
    name: "Cinder-Spout",
    description: "Spout frame sharing (Windows) for live visuals pipelines.",
    author: "Bruce Lane",
    git_url: "https://github.com/brucelane/Cinder-Spout.git",
  },
  {
    name: "Cinder-NDI",
    description: "NewTek NDI video streaming support.",
    author: "Bruce Lane",
    git_url: "https://github.com/brucelane/Cinder-NDI.git",
  },
  {
    name: "Cinder-poScene",
    description: "Scene graph with event propagation and animation.",
    author: "Potion Design",
    git_url: "https://github.com/nicowesse/Cinder-poScene.git",
  },
  {
    name: "Cinder-Assimp",
    description: "3D model loading via Assimp (FBX, OBJ, Collada, etc.).",
    author: "Gabor Papp",
    git_url: "https://github.com/gaborpapp/Cinder-Assimp.git",
  },
  {
    name: "Cinder-Runtime",
    description: "Runtime C++ compilation and hot-reloading.",
    author: "Simon Geilfus",
    git_url: "https://github.com/simongeilfus/Cinder-Runtime.git",
  },
];

// ---------------------------------------------------------------------------
// XML parsing helpers (lightweight, no external dep)
// ---------------------------------------------------------------------------

interface BlockInfo {
  name: string;
  description: string;
  author: string;
  gitUrl?: string;
  dependencies: string[];
  sourceFiles: string[];
  headerFiles: string[];
  platforms: string[];
  path: string;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

function extractSelfClosingAttr(
  xml: string,
  tag: string,
  attr: string,
): string[] {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*/?>`, "gi");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

async function parseBlockXml(xmlPath: string): Promise<BlockInfo | null> {
  if (!existsSync(xmlPath)) return null;

  const xml = await readFile(xmlPath, "utf-8");

  const name = extractAttr(xml, "cinder-block", "name") || extractTag(xml, "name") || basename(join(xmlPath, ".."));
  const description = extractTag(xml, "description") || "";
  const author = extractTag(xml, "author") || extractAttr(xml, "cinder-block", "author") || "";
  const gitUrl = extractAttr(xml, "cinder-block", "git") || extractTag(xml, "git") || undefined;

  const dependencies = extractSelfClosingAttr(xml, "dependency", "name")
    .concat(extractAllTags(xml, "dependency"));

  const sourceFiles = extractSelfClosingAttr(xml, "source", "name")
    .concat(extractSelfClosingAttr(xml, "source", "file"));

  const headerFiles = extractSelfClosingAttr(xml, "header", "name")
    .concat(extractSelfClosingAttr(xml, "header", "file"));

  // Platform support
  const platforms: string[] = [];
  if (xml.includes('os="macosx"') || xml.includes('platform="macosx"') || !xml.includes('os='))
    platforms.push("macOS");
  if (xml.includes('os="msw"') || xml.includes('platform="msw"') || !xml.includes('os='))
    platforms.push("Windows");
  if (xml.includes('os="linux"') || xml.includes('platform="linux"') || !xml.includes('os='))
    platforms.push("Linux");

  return {
    name,
    description,
    author,
    gitUrl,
    dependencies: [...new Set(dependencies.filter(Boolean))],
    sourceFiles: [...new Set(sourceFiles.filter(Boolean))],
    headerFiles: [...new Set(headerFiles.filter(Boolean))],
    platforms: [...new Set(platforms)],
    path: join(xmlPath, ".."),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const config = readConfig();

  switch (name) {
    // ----- list_cinderblocks -----
    case "list_cinderblocks": {
      let md = "# CinderBlocks\n\n";

      // Scan local installation
      if (config.CINDER_PATH) {
        const blocksDir = join(config.CINDER_PATH, "blocks");
        if (existsSync(blocksDir)) {
          const entries = await readdir(blocksDir, { withFileTypes: true });
          const blockDirs = entries.filter(
            (e) => e.isDirectory() && !e.name.startsWith("."),
          );

          if (blockDirs.length > 0) {
            md += `## Installed (${blocksDir})\n\n`;
            for (const dir of blockDirs) {
              const xmlPath = join(blocksDir, dir.name, "cinderblock.xml");
              const info = await parseBlockXml(xmlPath);
              if (info) {
                md += `- **${info.name}** — ${info.description || "_no description_"}`;
                if (info.author) md += ` _(${info.author})_`;
                if (info.gitUrl) md += ` [git](${info.gitUrl})`;
                md += "\n";
              } else {
                md += `- **${dir.name}** — _no cinderblock.xml_\n`;
              }
            }
            md += "\n";
          }
        }
      } else {
        md += "> CINDER_PATH is not configured. Local blocks cannot be listed.\n\n";
      }

      // Community blocks
      md += "## Community Blocks\n\n";
      for (const block of COMMUNITY_BLOCKS) {
        md += `- **${block.name}** — ${block.description} _(${block.author})_ [git](${block.git_url})\n`;
      }

      return md;
    }

    // ----- add_cinderblock -----
    case "add_cinderblock": {
      const parsed = AddCinderBlockSchema.parse(args);
      const cmakePath = join(parsed.project_path, "CMakeLists.txt");

      if (!existsSync(cmakePath)) {
        return `CMakeLists.txt not found at ${cmakePath}. Is this a valid Cinder project?`;
      }

      let blockDir: string | null = null;
      let blockInfo: BlockInfo | null = null;

      // Check if block is installed locally
      if (config.CINDER_PATH) {
        const localPath = join(config.CINDER_PATH, "blocks", parsed.block_name);
        if (existsSync(localPath)) {
          blockDir = localPath;
          blockInfo = await parseBlockXml(
            join(localPath, "cinderblock.xml"),
          );
        }
      }

      // If not found locally and git_url provided, clone it
      if (!blockDir && parsed.git_url) {
        const projectBlocksDir = join(parsed.project_path, "blocks");
        await mkdir(projectBlocksDir, { recursive: true });
        blockDir = join(projectBlocksDir, parsed.block_name);

        try {
          execSync(`git clone "${parsed.git_url}" "${blockDir}"`, {
            stdio: "pipe",
            timeout: 60000,
          });
          blockInfo = await parseBlockXml(
            join(blockDir, "cinderblock.xml"),
          );
        } catch (err) {
          return `Failed to clone ${parsed.git_url}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // If not found locally, check community list for a known URL
      if (!blockDir && !parsed.git_url) {
        const community = COMMUNITY_BLOCKS.find(
          (b) => b.name.toLowerCase() === parsed.block_name.toLowerCase(),
        );
        if (community) {
          const projectBlocksDir = join(parsed.project_path, "blocks");
          await mkdir(projectBlocksDir, { recursive: true });
          blockDir = join(projectBlocksDir, parsed.block_name);

          try {
            execSync(`git clone "${community.git_url}" "${blockDir}"`, {
              stdio: "pipe",
              timeout: 60000,
            });
            blockInfo = await parseBlockXml(
              join(blockDir, "cinderblock.xml"),
            );
          } catch (err) {
            return `Failed to clone ${community.git_url}: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      }

      if (!blockDir) {
        return `CinderBlock "${parsed.block_name}" not found. Provide a \`git_url\` to clone it, or install it in CINDER_PATH/blocks/.`;
      }

      // Update CMakeLists.txt
      let cmake = await readFile(cmakePath, "utf-8");

      const blockRelPath = blockDir.startsWith(parsed.project_path)
        ? `\${CMAKE_CURRENT_SOURCE_DIR}/${blockDir.replace(parsed.project_path + "/", "")}`
        : blockDir.startsWith(config.CINDER_PATH || "")
          ? `\${CINDER_PATH}/blocks/${parsed.block_name}`
          : blockDir;

      // Add include path
      const includeDir = existsSync(join(blockDir, "include"))
        ? `${blockRelPath}/include`
        : `${blockRelPath}/src`;

      let addition = `\n# CinderBlock: ${parsed.block_name}\n`;
      addition += `target_include_directories(\${PROJECT_NAME} PUBLIC ${includeDir})\n`;

      // Add source files from cinderblock.xml or glob src/
      if (blockInfo && blockInfo.sourceFiles.length > 0) {
        const files = blockInfo.sourceFiles
          .map((f) => `  ${blockRelPath}/${f}`)
          .join("\n");
        addition += `target_sources(\${PROJECT_NAME} PRIVATE\n${files}\n)\n`;
      } else {
        // Glob the src directory
        addition += `file(GLOB_RECURSE ${parsed.block_name.replace(/-/g, "_").toUpperCase()}_SOURCES ${blockRelPath}/src/*.cpp ${blockRelPath}/src/*.h)\n`;
        addition += `target_sources(\${PROJECT_NAME} PRIVATE \${${parsed.block_name.replace(/-/g, "_").toUpperCase()}_SOURCES})\n`;
      }

      cmake += addition;
      await writeFile(cmakePath, cmake);

      let md = `# CinderBlock Added: ${parsed.block_name}\n\n`;
      md += `**Path:** \`${blockDir}\`\n\n`;
      if (blockInfo) {
        if (blockInfo.description) md += `${blockInfo.description}\n\n`;
        if (blockInfo.dependencies.length > 0) {
          md += `**Dependencies:** ${blockInfo.dependencies.join(", ")}\n\n`;
          md += `> You may need to add these dependencies as well.\n\n`;
        }
      }
      md += `CMakeLists.txt has been updated with include paths and sources.\n`;
      md += `Re-run cmake to apply:\n\n\`\`\`bash\ncd ${parsed.project_path}/build && cmake ..\n\`\`\``;

      return md;
    }

    // ----- get_cinderblock_info -----
    case "get_cinderblock_info": {
      const { block_name } = GetCinderBlockInfoSchema.parse(args);

      // Check local installation
      if (config.CINDER_PATH) {
        const xmlPath = join(
          config.CINDER_PATH,
          "blocks",
          block_name,
          "cinderblock.xml",
        );
        const info = await parseBlockXml(xmlPath);
        if (info) {
          return formatBlockInfo(info);
        }
      }

      // Check community list
      const community = COMMUNITY_BLOCKS.find(
        (b) => b.name.toLowerCase() === block_name.toLowerCase(),
      );
      if (community) {
        return `# ${community.name}\n\n${community.description}\n\n**Author:** ${community.author}\n**Git:** ${community.git_url}\n\n_This is a community block. Use \`add_cinderblock\` to install it._`;
      }

      return `CinderBlock "${block_name}" not found. Check the name or use \`list_cinderblocks\` to see available blocks.`;
    }

    default:
      return `Unknown blocks tool: ${name}`;
  }
}

function formatBlockInfo(info: BlockInfo): string {
  let md = `# ${info.name}\n\n`;
  if (info.description) md += `${info.description}\n\n`;
  if (info.author) md += `**Author:** ${info.author}\n`;
  if (info.gitUrl) md += `**Git:** ${info.gitUrl}\n`;
  md += `**Path:** \`${info.path}\`\n`;
  if (info.platforms.length > 0)
    md += `**Platforms:** ${info.platforms.join(", ")}\n`;

  if (info.dependencies.length > 0) {
    md += `\n## Dependencies\n\n`;
    for (const d of info.dependencies) {
      md += `- ${d}\n`;
    }
  }

  if (info.sourceFiles.length > 0) {
    md += `\n## Source Files\n\n`;
    for (const f of info.sourceFiles) {
      md += `- \`${f}\`\n`;
    }
  }

  if (info.headerFiles.length > 0) {
    md += `\n## Header Files\n\n`;
    for (const f of info.headerFiles) {
      md += `- \`${f}\`\n`;
    }
  }

  return md;
}
