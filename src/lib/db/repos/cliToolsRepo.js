import { makeKv } from "../helpers/kvStore.js";

const cliToolsKv = makeKv("cliToolConfigs");

/**
 * Get saved configuration for a CLI tool
 * @param {string} toolName - e.g. "claude", "codex", "droid", "omp", etc.
 * @returns {Promise<Object|null>}
 */
export async function getCliToolConfig(toolName) {
  if (!toolName) return null;
  return await cliToolsKv.get(toolName, null);
}

/**
 * Save configuration for a CLI tool (merges with existing config if any)
 * @param {string} toolName
 * @param {Object} config
 * @returns {Promise<Object>}
 */
export async function setCliToolConfig(toolName, config) {
  if (!toolName || !config || typeof config !== "object") return {};
  const existing = (await getCliToolConfig(toolName)) || {};
  const merged = { ...existing, ...config };
  await cliToolsKv.set(toolName, merged);
  return merged;
}

/**
 * Get all saved CLI tool configs
 * @returns {Promise<Record<string, Object>>}
 */
export async function getAllCliToolConfigs() {
  return await cliToolsKv.getAll();
}

/**
 * Delete saved configuration for a CLI tool
 * @param {string} toolName
 */
export async function deleteCliToolConfig(toolName) {
  if (!toolName) return;
  await cliToolsKv.remove(toolName);
}
