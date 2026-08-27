// Resolve a model's authoritative capabilities (context window + max output +
// modality/reasoning flags) and the token-limit subset.
//
// Single source of truth is getCapabilitiesForModel (open-sse/providers/capabilities.js),
// which falls back through: provider-specific override -> canonical exact id ->
// glob pattern -> safe floor (200k ctx / 64k out).
//
// The `modelId` string uses the *routing alias* form ("cc/claude-sonnet-5",
// "cx/gpt-5.6-sol", "kr/gpt-5.6-sol"). PROVIDER_CAPABILITIES is keyed by
// provider *id* ("claude", "codex", "kiro"), so the alias must be mapped before
// lookup — passing the raw alias silently falls through to the generic pattern
// and returns the wrong window (e.g. codex gpt-5.6-sol read as 400k instead of 372k).
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { ALIAS_TO_ID } from "@/shared/constants/providers";

const FALLBACK = { contextWindow: 200000, maxOutput: 64000 };

// Full capability object, flattened to the subset consumers need.
export function resolveModelCaps(modelId) {
  const str = typeof modelId === "string" ? modelId.trim() : "";
  const slash = str.indexOf("/");
  const alias = slash > 0 ? str.slice(0, slash) : null;
  const id = slash > 0 ? str.slice(slash + 1) : str;
  const providerId = alias ? (ALIAS_TO_ID[alias] || alias) : null;
  const caps = getCapabilitiesForModel(providerId, id);
  return {
    vision: Boolean(caps?.vision),
    search: Boolean(caps?.search),
    reasoning: Boolean(caps?.reasoning),
    contextWindow: Number.isFinite(caps?.contextWindow) ? caps.contextWindow : FALLBACK.contextWindow,
    maxOutput: Number.isFinite(caps?.maxOutput) ? caps.maxOutput : FALLBACK.maxOutput,
  };
}

// Token-limit subset only (context window + max output).
export function resolveModelLimits(modelId) {
  const { contextWindow, maxOutput } = resolveModelCaps(modelId);
  return { contextWindow, maxOutput };
}
