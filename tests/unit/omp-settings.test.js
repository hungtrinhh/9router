import { describe, expect, it } from "vitest";
import { parseYAML, stringifyYAML } from "confbox";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";
import { detectClientTool } from "../../open-sse/utils/clientDetector.js";

describe("Oh My Pi (OMP) CLI Tool", () => {
  it("defines omp in CLI_TOOLS constants", () => {
    const omp = CLI_TOOLS.omp;
    expect(omp).toBeDefined();
    expect(omp.id).toBe("omp");
    expect(omp.name).toBe("Oh My Pi");
    expect(omp.image).toBe("/providers/omp.png");
    expect(omp.configType).toBe("custom");
    expect(omp.defaultCommand).toBe("omp");
    expect(Array.isArray(omp.defaultModels)).toBe(true);
    expect(omp.defaultModels.length).toBeGreaterThan(0);
  });

  it("detects omp client from user-agent headers", () => {
    expect(detectClientTool({ "user-agent": "omp/17.4.2 (win32; x64)" })).toBe("omp");
    expect(detectClientTool({ "user-agent": "oh-my-pi/1.0" })).toBe("omp");
    expect(detectClientTool({ "user-agent": "pi-coding-agent" })).toBe("omp");
    expect(detectClientTool({ "user-agent": "Mozilla/5.0" })).toBeNull();
  });

  it("serializes and parses models.yml and config.yml correctly", () => {
    const modelsData = {
      providers: {
        "9router": {
          baseUrl: "http://127.0.0.1:20128/v1",
          apiKey: "sk-9router",
          api: "openai-completions",
          models: [
            {
              id: "claude-sonnet-4-6",
              name: "claude-sonnet-4-6",
              contextWindow: 1000000,
              maxTokens: 32768,
              reasoning: true,
              input: ["text", "image"],
            },
          ],
        },
      },
    };

    const yamlStr = stringifyYAML(modelsData);
    expect(yamlStr).toContain("9router:");
    expect(yamlStr).toContain("openai-completions");

    const parsed = parseYAML(yamlStr);
    expect(parsed.providers["9router"].baseUrl).toBe("http://127.0.0.1:20128/v1");
    expect(parsed.providers["9router"].models[0].id).toBe("claude-sonnet-4-6");

    const configData = {
      modelRoles: {
        default: "9router/claude-sonnet-4-6",
        smol: "9router/gemini-2.5-flash",
      },
    };

    const configYamlStr = stringifyYAML(configData);
    const parsedConfig = parseYAML(configYamlStr);
    expect(parsedConfig.modelRoles.default).toBe("9router/claude-sonnet-4-6");
    expect(parsedConfig.modelRoles.smol).toBe("9router/gemini-2.5-flash");
  });
  it("handles subagent task.agentModelOverrides in config.yml", () => {
    const configData = {
      modelRoles: {
        default: "9router/claude-sonnet-4-6",
        smol: "9router/gemini-2.5-flash",
      },
      "task.agentModelOverrides": {
        scout: "9router/gemini-2.5-flash",
        reviewer: "9router/claude-opus-4-6",
        designer: "9router/claude-sonnet-4-6",
      },
    };

    const yamlStr = stringifyYAML(configData);
    expect(yamlStr).toContain("task.agentModelOverrides:");
    expect(yamlStr).toContain("scout:");

    const parsed = parseYAML(yamlStr);
    expect(parsed["task.agentModelOverrides"].scout).toBe("9router/gemini-2.5-flash");
    expect(parsed["task.agentModelOverrides"].reviewer).toBe("9router/claude-opus-4-6");
  });
});
