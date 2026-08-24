"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { getCliToolConfig, setCliToolConfig } from "@/lib/db/index.js";
import { parseYAML, stringifyYAML } from "confbox";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

const execAsync = promisify(exec);

const OMP_SUBAGENT_NAMES = [
  "task",
  "scout",
  "reviewer",
  "security-reviewer",
  "designer",
  "sonic",
];

const getOmpDir = () => {
  if (process.env.PI_CODING_AGENT_DIR) {
    return process.env.PI_CODING_AGENT_DIR;
  }
  return path.join(os.homedir(), ".omp", "agent");
};

const getModelsPath = () => path.join(getOmpDir(), "models.yml");
const getConfigPath = () => path.join(getOmpDir(), "config.yml");

// Check if omp CLI is installed (via which/where or known paths or config file exists)
const checkOmpInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where omp" : "which omp";
    const env = isWindows
      ? {
          ...process.env,
          PATH: `${path.join(os.homedir(), ".bun", "bin")};${process.env.APPDATA}\\npm;${process.env.PATH}`,
        }
      : {
          ...process.env,
          PATH: `${path.join(os.homedir(), ".bun", "bin")}:/usr/local/bin:/usr/bin:${process.env.PATH}`,
        };
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    const candidatePaths = [
      path.join(os.homedir(), ".bun", "bin", os.platform() === "win32" ? "omp.exe" : "omp"),
      getModelsPath(),
      getConfigPath(),
      path.join(os.homedir(), ".omp"),
    ];

    for (const p of candidatePaths) {
      try {
        await fs.access(p);
        return true;
      } catch {
        // continue checking next candidate
      }
    }
    return false;
  }
};

const readModelsYaml = async () => {
  try {
    const content = await fs.readFile(getModelsPath(), "utf-8");
    return parseYAML(content) || {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    return {};
  }
};

const readConfigYaml = async () => {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    return parseYAML(content) || {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    return {};
  }
};

const has9RouterConfig = (modelsData) => {
  if (!modelsData?.providers) return false;
  return Boolean(modelsData.providers["9router"]?.baseUrl);
};

// GET - Check omp CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOmpInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Oh My Pi (OMP) is not installed",
      });
    }

    const modelsData = await readModelsYaml();
    const configData = await readConfigYaml();
    const providerConfig = modelsData?.providers?.["9router"];

    const rawModels = providerConfig?.models || [];
    const modelIds = rawModels.map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);

    const defaultRole = configData?.modelRoles?.default;
    const activeModel = defaultRole?.startsWith("9router/")
      ? defaultRole.replace(/^9router\//, "").split(":")[0]
      : (modelIds[0] || null);

    const smolRole = configData?.modelRoles?.smol;
    const smolModel = smolRole?.startsWith("9router/")
      ? smolRole.replace(/^9router\//, "").split(":")[0]
      : null;

    const slowRole = configData?.modelRoles?.slow;
    const slowModel = slowRole?.startsWith("9router/")
      ? slowRole.replace(/^9router\//, "").split(":")[0]
      : null;

    const planRole = configData?.modelRoles?.plan;
    const planModel = planRole?.startsWith("9router/")
      ? planRole.replace(/^9router\//, "").split(":")[0]
      : null;

    // Parse subagent overrides from configData["task.agentModelOverrides"]
    const rawAgentOverrides = configData?.["task.agentModelOverrides"] || configData?.agentModelOverrides || {};
    const subagentModels = {};
    for (const name of OMP_SUBAGENT_NAMES) {
      const val = rawAgentOverrides[name];
      if (typeof val === "string" && val.startsWith("9router/")) {
        subagentModels[name] = val.replace(/^9router\//, "").split(":")[0];
      } else if (typeof val === "string" && val.trim()) {
        subagentModels[name] = val.trim();
      }
    }

    const savedConfig = await getCliToolConfig("omp");

    return NextResponse.json({
      installed: true,
      settings: {
        models: modelsData,
        config: configData,
        provider: providerConfig || null,
      },
      has9Router: has9RouterConfig(modelsData),
      savedConfig,
      configPath: getConfigPath(),
      modelsPath: getModelsPath(),
      omp: {
        models: modelIds,
        activeModel,
        smolModel,
        slowModel,
        planModel,
        subagentModels,
        baseUrl: providerConfig?.baseUrl || null,
        apiKey: providerConfig?.apiKey || null,
      },
    });
  } catch (error) {
    console.log("Error checking omp settings:", error);
    return NextResponse.json({ error: "Failed to check omp settings" }, { status: 500 });
  }
}

// POST - Apply 9Router as custom provider in models.yml and set modelRoles & subagent overrides in config.yml
export async function POST(request) {
  try {
    const {
      baseUrl,
      apiKey,
      model,
      models,
      activeModel,
      smolModel,
      slowModel,
      planModel,
      subagentModels,
    } = await request.json();

    const explicitModels = Array.isArray(models) && models.length > 0
      ? models.filter(Boolean)
      : (typeof model === "string" && model.trim() ? [model.trim()] : []);

    const subagentList = subagentModels && typeof subagentModels === "object"
      ? Object.values(subagentModels).map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean)
      : [];

    const allModelsSet = new Set([
      ...explicitModels,
      activeModel,
      smolModel,
      slowModel,
      planModel,
      ...subagentList,
    ].filter(Boolean));

    const modelsArray = Array.from(allModelsSet);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json(
        { error: "baseUrl and at least one model are required" },
        { status: 400 }
      );
    }

    const ompDir = getOmpDir();
    await fs.mkdir(ompDir, { recursive: true });

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";

    // Build model definitions for models.yml
    const modelItems = modelsArray.map((modelId) => {
      const slash = modelId.indexOf("/");
      const provider = slash > 0 ? modelId.slice(0, slash) : null;
      const cleanId = slash > 0 ? modelId.slice(slash + 1) : modelId;
      const caps = getCapabilitiesForModel(provider, cleanId);

      return {
        id: modelId,
        name: cleanId || modelId,
        contextWindow: caps.contextWindow || 200000,
        maxTokens: Math.min(caps.maxOutput || 8192, 32768),
        reasoning: Boolean(caps.reasoning),
        input: caps.vision ? ["text", "image"] : ["text"],
      };
    });

    // Update models.yml
    const modelsData = await readModelsYaml();
    if (!modelsData.providers) modelsData.providers = {};
    modelsData.providers["9router"] = {
      baseUrl: normalizedBaseUrl,
      apiKey: keyToUse,
      api: "openai-completions",
      models: modelItems,
    };
    await fs.writeFile(getModelsPath(), stringifyYAML(modelsData), "utf-8");

    // Update config.yml
    const configData = await readConfigYaml();
    if (!configData.modelRoles) configData.modelRoles = {};

    const primaryModel = activeModel && modelsArray.includes(activeModel)
      ? activeModel
      : modelsArray[0];

    configData.modelRoles.default = `9router/${primaryModel}`;

    if (smolModel && modelsArray.includes(smolModel)) {
      configData.modelRoles.smol = `9router/${smolModel}`;
    } else if (configData.modelRoles.smol?.startsWith("9router/")) {
      delete configData.modelRoles.smol;
    }

    if (slowModel && modelsArray.includes(slowModel)) {
      configData.modelRoles.slow = `9router/${slowModel}`;
    } else if (configData.modelRoles.slow?.startsWith("9router/")) {
      delete configData.modelRoles.slow;
    }

    if (planModel && modelsArray.includes(planModel)) {
      configData.modelRoles.plan = `9router/${planModel}`;
    } else if (configData.modelRoles.plan?.startsWith("9router/")) {
      delete configData.modelRoles.plan;
    }

    // Update task.agentModelOverrides in config.yml
    if (subagentModels && typeof subagentModels === "object") {
      if (!configData["task.agentModelOverrides"]) {
        configData["task.agentModelOverrides"] = {};
      }
      for (const [agentName, agentModel] of Object.entries(subagentModels)) {
        const trimmed = typeof agentModel === "string" ? agentModel.trim() : "";
        if (trimmed) {
          configData["task.agentModelOverrides"][agentName] = trimmed.startsWith("9router/")
            ? trimmed
            : `9router/${trimmed}`;
        } else if (configData["task.agentModelOverrides"][agentName]?.startsWith("9router/")) {
          delete configData["task.agentModelOverrides"][agentName];
        }
      }
      if (Object.keys(configData["task.agentModelOverrides"]).length === 0) {
        delete configData["task.agentModelOverrides"];
      }
    }

    await fs.writeFile(getConfigPath(), stringifyYAML(configData), "utf-8");

    // Save model settings to database for cross-machine sync
    await setCliToolConfig("omp", {
      model: primaryModel,
      models: modelsArray,
      activeModel: primaryModel,
      smolModel,
      slowModel,
      planModel,
      subagentModels,
    });

    return NextResponse.json({
      success: true,
      message: "Oh My Pi settings applied successfully!",
      configPath: getConfigPath(),
      modelsPath: getModelsPath(),
      activeModel: primaryModel,
    });
  } catch (error) {
    console.log("Error updating omp settings:", error);
    return NextResponse.json({ error: "Failed to update omp settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router provider from models.yml and config.yml
export async function DELETE() {
  try {
    const modelsData = await readModelsYaml();
    if (modelsData.providers?.["9router"]) {
      delete modelsData.providers["9router"];
      if (Object.keys(modelsData.providers).length === 0) {
        delete modelsData.providers;
      }
      await fs.writeFile(getModelsPath(), stringifyYAML(modelsData), "utf-8");
    }

    const configData = await readConfigYaml();
    if (configData.modelRoles) {
      for (const role of ["default", "smol", "slow", "plan"]) {
        if (configData.modelRoles[role]?.startsWith("9router/")) {
          delete configData.modelRoles[role];
        }
      }
      if (Object.keys(configData.modelRoles).length === 0) {
        delete configData.modelRoles;
      }
    }

    if (configData["task.agentModelOverrides"]) {
      for (const [agentName, modelVal] of Object.entries(configData["task.agentModelOverrides"])) {
        if (typeof modelVal === "string" && modelVal.startsWith("9router/")) {
          delete configData["task.agentModelOverrides"][agentName];
        }
      }
      if (Object.keys(configData["task.agentModelOverrides"]).length === 0) {
        delete configData["task.agentModelOverrides"];
      }
    }

    await fs.writeFile(getConfigPath(), stringifyYAML(configData), "utf-8");

    return NextResponse.json({
      success: true,
      message: "9Router configuration removed from Oh My Pi",
    });
  } catch (error) {
    console.log("Error resetting omp settings:", error);
    return NextResponse.json({ error: "Failed to reset omp settings" }, { status: 500 });
  }
}
