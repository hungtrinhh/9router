"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { getCliToolConfig, setCliToolConfig, deleteCliToolConfig } from "@/lib/db/index.js";
import { parseYAML, stringifyYAML } from "confbox";
import { resolveModelCaps } from "@/shared/utils/modelLimits";

const execAsync = promisify(exec);

export const OMP_MODEL_ROLE_NAMES = [
  "default",
  "smol",
  "slow",
  "vision",
  "plan",
  "designer",
  "commit",
  "tiny",
  "task",
  "advisor",
];

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
    const savedConfig = await getCliToolConfig("omp");
    const hasPersisted =
      savedConfig && typeof savedConfig === "object" && Object.keys(savedConfig).length > 0;

    const modelsData = isInstalled ? await readModelsYaml() : {};
    const configData = isInstalled ? await readConfigYaml() : {};
    const providerConfig = modelsData?.providers?.["9router"];
    const rawModels = providerConfig?.models || [];
    const modelIds = rawModels.map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);

    const yamlActiveModel = (() => {
      const role = configData?.modelRoles?.default;
      return role?.startsWith("9router/")
        ? role.replace(/^9router\//, "").split(":")[0]
        : (modelIds[0] || null);
    })();

    const yamlRole = (roleName) => {
      const role = configData?.modelRoles?.[roleName];
      return role?.startsWith("9router/")
        ? role.replace(/^9router\//, "").split(":")[0]
        : null;
    };

    // Parse subagent overrides from configData["task.agentModelOverrides"]
    const rawAgentOverrides = configData?.["task.agentModelOverrides"] || configData?.agentModelOverrides || {};
    const yamlSubagentModels = {};
    for (const name of OMP_SUBAGENT_NAMES) {
      const val = rawAgentOverrides[name];
      if (typeof val === "string" && val.startsWith("9router/")) {
        yamlSubagentModels[name] = val.replace(/^9router\//, "").split(":")[0];
      } else if (typeof val === "string" && val.trim()) {
        yamlSubagentModels[name] = val.trim();
      }
    }

    const hasPersistedSubagents =
      savedConfig?.subagentModels && typeof savedConfig.subagentModels === "object"
        ? Object.values(savedConfig.subagentModels).some((v) => typeof v === "string" && v.trim())
        : false;

    const savedRoles = savedConfig?.modelRoles || {};
    const effectiveRoles = {};
    for (const role of OMP_MODEL_ROLE_NAMES) {
      effectiveRoles[role] =
        savedRoles[role] ||
        (role === "default"
          ? (savedConfig?.activeModel || savedConfig?.model || yamlActiveModel || "")
          : role === "smol"
          ? (savedConfig?.smolModel || yamlRole("smol") || "")
          : role === "slow"
          ? (savedConfig?.slowModel || yamlRole("slow") || "")
          : role === "plan"
          ? (savedConfig?.planModel || yamlRole("plan") || "")
          : role === "vision"
          ? (savedConfig?.visionModel || yamlRole("vision") || "")
          : role === "designer"
          ? (savedConfig?.designerModel || yamlRole("designer") || "")
          : role === "commit"
          ? (savedConfig?.commitModel || yamlRole("commit") || "")
          : role === "tiny"
          ? (savedConfig?.tinyModel || yamlRole("tiny") || "")
          : role === "task"
          ? (savedConfig?.taskModel || yamlRole("task") || "")
          : role === "advisor"
          ? (savedConfig?.advisorModel || yamlRole("advisor") || "")
          : (yamlRole(role) || ""));
    }

    // Persisted DB config is the primary source of truth so settings survive
    // restarts and work across local/remote environments.
    const omp = {
      models: Array.isArray(savedConfig?.models) && savedConfig.models.length > 0
        ? savedConfig.models
        : modelIds,
      activeModel: effectiveRoles.default || "",
      smolModel: effectiveRoles.smol || "",
      slowModel: effectiveRoles.slow || "",
      planModel: effectiveRoles.plan || "",
      visionModel: effectiveRoles.vision || "",
      designerModel: effectiveRoles.designer || "",
      commitModel: effectiveRoles.commit || "",
      tinyModel: effectiveRoles.tiny || "",
      taskModel: effectiveRoles.task || "",
      advisorModel: effectiveRoles.advisor || "",
      modelRoles: effectiveRoles,
      subagentModels: hasPersistedSubagents ? savedConfig.subagentModels : yamlSubagentModels,
      baseUrl: savedConfig?.baseUrl || providerConfig?.baseUrl || null,
      apiKey: savedConfig?.apiKey || providerConfig?.apiKey || null,
    };

    return NextResponse.json({
      installed: isInstalled || hasPersisted,
      settings: {
        models: modelsData,
        config: configData,
        provider: providerConfig || null,
      },
      has9Router: has9RouterConfig(modelsData) || Boolean(savedConfig?.baseUrl),
      savedConfig,
      configPath: getConfigPath(),
      modelsPath: getModelsPath(),
      omp,
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
      visionModel,
      designerModel,
      commitModel,
      tinyModel,
      taskModel,
      advisorModel,
      modelRoles: inputModelRoles,
      subagentModels,
    } = await request.json();

    const explicitModels = Array.isArray(models) && models.length > 0
      ? models.filter(Boolean)
      : (typeof model === "string" && model.trim() ? [model.trim()] : []);

    const roleMap = {
      default: activeModel || inputModelRoles?.default || model || "",
      smol: smolModel || inputModelRoles?.smol || "",
      slow: slowModel || inputModelRoles?.slow || "",
      plan: planModel || inputModelRoles?.plan || "",
      vision: visionModel || inputModelRoles?.vision || "",
      designer: designerModel || inputModelRoles?.designer || "",
      commit: commitModel || inputModelRoles?.commit || "",
      tiny: tinyModel || inputModelRoles?.tiny || "",
      task: taskModel || inputModelRoles?.task || "",
      advisor: advisorModel || inputModelRoles?.advisor || "",
      ...(inputModelRoles && typeof inputModelRoles === "object" ? inputModelRoles : {}),
    };

    const subagentList = subagentModels && typeof subagentModels === "object"
      ? Object.values(subagentModels).map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean)
      : [];

    const allModelsSet = new Set([
      ...explicitModels,
      ...Object.values(roleMap).filter((m) => typeof m === "string" && m.trim()),
      ...subagentList,
    ].filter(Boolean));

    const modelsArray = Array.from(allModelsSet);
    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json(
        { error: "baseUrl and at least one model are required" },
        { status: 400 }
      );
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";

    const primaryModel = roleMap.default && modelsArray.includes(roleMap.default)
      ? roleMap.default
      : modelsArray[0];

    // Ensure roleMap.default is primaryModel
    roleMap.default = primaryModel;

    // Merge subagent overrides
    const savedConfig = await getCliToolConfig("omp");
    const mergedSubagentModels = { ...(savedConfig?.subagentModels || {}) };
    if (subagentModels && typeof subagentModels === "object") {
      for (const [agentName, agentModel] of Object.entries(subagentModels)) {
        const trimmed = typeof agentModel === "string" ? agentModel.trim() : "";
        if (trimmed) {
          mergedSubagentModels[agentName] = trimmed;
        } else {
          delete mergedSubagentModels[agentName];
        }
      }
    }

    // 1. GUARANTEED: Save model settings to database for persistence and cross-machine sync
    await setCliToolConfig("omp", {
      model: primaryModel,
      models: modelsArray,
      activeModel: primaryModel,
      smolModel: roleMap.smol || "",
      slowModel: roleMap.slow || "",
      planModel: roleMap.plan || "",
      visionModel: roleMap.vision || "",
      designerModel: roleMap.designer || "",
      commitModel: roleMap.commit || "",
      tinyModel: roleMap.tiny || "",
      taskModel: roleMap.task || "",
      advisorModel: roleMap.advisor || "",
      modelRoles: roleMap,
      subagentModels: mergedSubagentModels,
      baseUrl: normalizedBaseUrl,
      apiKey: keyToUse,
    });

    // 2. BEST-EFFORT: Update local models.yml & config.yml if local filesystem allows
    try {
      const ompDir = getOmpDir();
      await fs.mkdir(ompDir, { recursive: true });

      // Build model definitions for models.yml
      const modelItems = modelsArray.map((modelId) => {
        const cleanId = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
        const caps = resolveModelCaps(modelId);

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
      for (const role of OMP_MODEL_ROLE_NAMES) {
        const val = roleMap[role];
        if (val && modelsArray.includes(val)) {
          configData.modelRoles[role] = `9router/${val}`;
        } else if (configData.modelRoles[role]?.startsWith("9router/")) {
          delete configData.modelRoles[role];
        }
      }
      if (Object.keys(configData.modelRoles).length === 0) {
        delete configData.modelRoles;
      }

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
    } catch (fsError) {
      console.log("Note: local OMP config files could not be updated (running in container or remote):", fsError.message);
    }

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
      for (const role of OMP_MODEL_ROLE_NAMES) {
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

    // Remove the persisted DB snapshot so the dashboard form resets too.
    await deleteCliToolConfig("omp");

    return NextResponse.json({
      success: true,
      message: "9Router configuration removed from Oh My Pi",
    });
  } catch (error) {
    console.log("Error resetting omp settings:", error);
    return NextResponse.json({ error: "Failed to reset omp settings" }, { status: 500 });
  }
}
