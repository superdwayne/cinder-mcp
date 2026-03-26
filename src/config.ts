import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CinderMcpConfig {
  CINDER_PATH: string;
  default_template: string;
  bridge_port_start: number;
  bridge_port_end: number;
  default_cmake_generator: string;
}

const CONFIG_DIR = join(homedir(), ".cinder-mcp");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: CinderMcpConfig = {
  CINDER_PATH: "",
  default_template: "BasicApp",
  bridge_port_start: 9000,
  bridge_port_end: 9100,
  default_cmake_generator: "Unix Makefiles",
};

/**
 * Ensures the config directory exists.
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Reads the current config from disk, merging with defaults.
 */
export function readConfig(): CinderMcpConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_PATH)) {
    writeConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CinderMcpConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Writes the full config to disk.
 */
export function writeConfig(config: CinderMcpConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Updates specific config keys, preserving the rest.
 */
export function updateConfig(
  updates: Partial<CinderMcpConfig>,
): CinderMcpConfig {
  const current = readConfig();
  const updated = { ...current, ...updates };
  writeConfig(updated);
  return updated;
}

/**
 * Validates that CINDER_PATH points to a real Cinder installation.
 * Checks for the existence of include/cinder/Cinder.h.
 */
export function validateCinderPath(cinderPath: string): {
  valid: boolean;
  reason?: string;
} {
  if (!cinderPath) {
    return { valid: false, reason: "CINDER_PATH is not set" };
  }

  if (!existsSync(cinderPath)) {
    return {
      valid: false,
      reason: `Directory does not exist: ${cinderPath}`,
    };
  }

  const headerPath = join(cinderPath, "include", "cinder", "Cinder.h");
  if (!existsSync(headerPath)) {
    return {
      valid: false,
      reason: `Cinder.h not found at ${headerPath}. Is this a valid Cinder installation?`,
    };
  }

  return { valid: true };
}

export { CONFIG_DIR, CONFIG_PATH, DEFAULT_CONFIG };
