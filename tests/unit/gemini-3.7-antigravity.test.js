import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";
import geminiRegistry from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";

describe("Gemini 3.7 & 3.8 Flash Support & Config (#3286, #3281)", () => {
  it("registers gemini-3.7-flash and gemini-3.8-flash tiered models in antigravity provider registry", () => {
    const agIds = antigravityRegistry.models.map(m => m.id);
    expect(agIds).toContain("gemini-3.8-flash-high");
    expect(agIds).toContain("gemini-3.8-flash-medium");
    expect(agIds).toContain("gemini-3.8-flash-low");
    expect(agIds).toContain("gemini-3.8-flash");
    expect(agIds).toContain("gemini-3.7-flash-high");
    expect(agIds).toContain("gemini-3.7-flash-medium");
    expect(agIds).toContain("gemini-3.7-flash-low");
  });

  it("registers gemini-3.7-flash in gemini provider registry", () => {
    const geminiIds = geminiRegistry.models.map(m => m.id);
    expect(geminiIds).toContain("gemini-3.7-flash");
  });

  it("resolves capabilities correctly for gemini-3.7 & 3.8 models with official limits", () => {
    const caps37 = getCapabilitiesForModel("antigravity", "gemini-3.7-flash-high");
    expect(caps37.vision).toBe(true);
    expect(caps37.reasoning).toBe(true);
    expect(caps37.thinkingFormat).toBe("gemini-level");
    expect(caps37.contextWindow).toBe(1048576);
    expect(caps37.maxOutput).toBe(65536);

    const caps38 = getCapabilitiesForModel("antigravity", "gemini-3.8-flash-high");
    expect(caps38.vision).toBe(true);
    expect(caps38.reasoning).toBe(true);
    expect(caps38.thinkingFormat).toBe("gemini-level");
    expect(caps38.contextWindow).toBe(1048576);
    expect(caps38.maxOutput).toBe(65536);
  });

  it("defines pricing matching gemini-3.7-flash and gemini-3.8-flash rates", () => {
    expect(MODEL_PRICING["gemini-3.7-flash"]).toEqual(MODEL_PRICING["gemini-3.6-flash"]);
    expect(MODEL_PRICING["gemini-3.7-flash-high"]).toEqual(MODEL_PRICING["gemini-3.6-flash-high"]);
    expect(MODEL_PRICING["gemini-3.7-flash-medium"]).toEqual(MODEL_PRICING["gemini-3.6-flash-medium"]);
    expect(MODEL_PRICING["gemini-3.7-flash-low"]).toEqual(MODEL_PRICING["gemini-3.6-flash-low"]);

    expect(MODEL_PRICING["gemini-3.8-flash"].input).toBe(0.75);
    expect(MODEL_PRICING["gemini-3.8-flash"].output).toBe(3.75);
    expect(MODEL_PRICING["gemini-3.8-flash-high"].input).toBe(0.75);
    expect(MODEL_PRICING["gemini-3.8-flash-high"].output).toBe(3.75);
  });
});
