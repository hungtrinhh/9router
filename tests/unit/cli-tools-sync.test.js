import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cli-sync-"));
  process.env.DATA_DIR = tempDir;
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("CLI Tools Config Database Persistence & Sync", () => {
  it("saves, retrieves, updates and deletes CLI tool configs in database", async () => {
    const {
      getCliToolConfig,
      setCliToolConfig,
      getAllCliToolConfigs,
      deleteCliToolConfig,
    } = db;

    // Initially empty
    expect(await getCliToolConfig("claude")).toBeNull();

    // Save claude config
    await setCliToolConfig("claude", {
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: "cc/claude-sonnet-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/claude-opus-5",
      },
      exaMcpEnabled: true,
    });

    const claude = await getCliToolConfig("claude");
    expect(claude).toBeDefined();
    expect(claude.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("cc/claude-sonnet-5");
    expect(claude.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("cc/claude-opus-5");
    expect(claude.exaMcpEnabled).toBe(true);

    // Save codex config
    await setCliToolConfig("codex", {
      model: "cx/gpt-5.5",
      subagentModel: "cx/gpt-5.5-mini",
    });

    // Save droid config
    await setCliToolConfig("droid", {
      model: "cc/claude-sonnet-5",
      models: ["cc/claude-sonnet-5", "cx/gpt-5.5"],
      activeModel: "cc/claude-sonnet-5",
    });

    // Save cline config
    await setCliToolConfig("cline", {
      model: "cc/claude-sonnet-5",
    });

    // Save copilot config
    await setCliToolConfig("copilot", {
      models: ["gpt-5-mini", "claude-haiku-4.5"],
    });

    // Save cowork config
    await setCliToolConfig("cowork", {
      models: ["cc/claude-sonnet-5"],
      plugins: [],
    });

    // Save deepseek-tui config
    await setCliToolConfig("deepseek-tui", {
      model: "deepseek-v4-pro",
    });

    // Save grok-build config
    await setCliToolConfig("grok-build", {
      model: "grok-code",
      contextWindow: 128000,
    });

    // Save hermes config
    await setCliToolConfig("hermes", {
      model: "hermes-3-llama-3.1-405b",
    });

    // Save jcode config
    await setCliToolConfig("jcode", {
      models: ["cc/claude-opus-5"],
      default_model: "cc/claude-opus-5",
    });

    // Save kilo config
    await setCliToolConfig("kilo", {
      model: "cc/claude-sonnet-5",
    });

    // Save omp config
    await setCliToolConfig("omp", {
      model: "cc/claude-sonnet-5",
      models: ["cc/claude-sonnet-5", "gemini/gemini-2.5-flash"],
      activeModel: "cc/claude-sonnet-5",
      smolModel: "gemini/gemini-2.5-flash",
    });

    // Save openclaw config
    await setCliToolConfig("openclaw", {
      model: "cc/claude-sonnet-5",
      agentModels: { main: "cx/gpt-5.5" },
    });

    // Save opencode config
    await setCliToolConfig("opencode", {
      model: "cc/claude-sonnet-5",
      models: ["cc/claude-sonnet-5"],
      activeModel: "cc/claude-sonnet-5",
      subagentModel: "gemini/gemini-2.5-flash",
    });

    // Get all configs
    const all = await getAllCliToolConfigs();
    const expectedTools = [
      "claude", "codex", "droid", "cline", "copilot", "cowork",
      "deepseek-tui", "grok-build", "hermes", "jcode", "kilo",
      "omp", "openclaw", "opencode",
    ];
    for (const tool of expectedTools) {
      expect(Object.keys(all)).toContain(tool);
    }
    expect(all.codex.model).toBe("cx/gpt-5.5");
    expect(all.droid.activeModel).toBe("cc/claude-sonnet-5");
    expect(all.openclaw.agentModels.main).toBe("cx/gpt-5.5");

    // Update / merge config
    await setCliToolConfig("claude", {
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: "cc/claude-sonnet-4-5-20250929",
      },
    });
    const updatedClaude = await getCliToolConfig("claude");
    expect(updatedClaude.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("cc/claude-sonnet-4-5-20250929");
    expect(updatedClaude.exaMcpEnabled).toBe(true);

    // Delete config
    await deleteCliToolConfig("codex");
    expect(await getCliToolConfig("codex")).toBeNull();
  });

  it("exports and imports cliToolConfigs through database backup/restore", async () => {
    const {
      setCliToolConfig,
      getCliToolConfig,
      exportDb,
      importDb,
    } = db;

    // Setup some tool configs
    await setCliToolConfig("claude", {
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "cc/claude-sonnet-custom" },
    });
    await setCliToolConfig("droid", {
      model: "cc/claude-opus-custom",
      models: ["cc/claude-opus-custom"],
      activeModel: "cc/claude-opus-custom",
    });
    await setCliToolConfig("openclaw", {
      model: "cc/claude-sonnet-4-5-20250929",
      agentModels: { main: "cx/gpt-5.5" },
    });
    await setCliToolConfig("opencode", {
      model: "gemini/gemini-2.5-pro",
      models: ["gemini/gemini-2.5-pro"],
      activeModel: "gemini/gemini-2.5-pro",
    });

    // Export DB
    const backup = await exportDb();
    expect(backup.cliToolConfigs).toBeDefined();
    expect(backup.cliToolConfigs.claude.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("cc/claude-sonnet-custom");
    expect(backup.cliToolConfigs.droid.model).toBe("cc/claude-opus-custom");
    expect(backup.cliToolConfigs.openclaw.agentModels.main).toBe("cx/gpt-5.5");
    expect(backup.cliToolConfigs.opencode.activeModel).toBe("gemini/gemini-2.5-pro");

    // Simulate restoring on a fresh database
    const freshBackup = JSON.parse(JSON.stringify(backup));
    await importDb(freshBackup);

    // Verify restored configs
    const restoredClaude = await getCliToolConfig("claude");
    expect(restoredClaude.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("cc/claude-sonnet-custom");

    const restoredDroid = await getCliToolConfig("droid");
    expect(restoredDroid.model).toBe("cc/claude-opus-custom");

    const restoredOpenClaw = await getCliToolConfig("openclaw");
    expect(restoredOpenClaw.agentModels.main).toBe("cx/gpt-5.5");

    const restoredOpenCode = await getCliToolConfig("opencode");
    expect(restoredOpenCode.activeModel).toBe("gemini/gemini-2.5-pro");
  });
});
