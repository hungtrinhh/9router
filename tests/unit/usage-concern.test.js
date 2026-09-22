// A3: locks toOpenAIUsage per-provider token math (claude/gemini/kiro/ollama/commandcode).
import { describe, it, expect } from "vitest";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

describe("toOpenAIUsage", () => {
  it("claude: folds cache read+create into prompt, exposes details", () => {
    const u = toOpenAIUsage(
      { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 10 },
      "claude"
    );
    expect(u.prompt_tokens).toBe(140);
    expect(u.completion_tokens).toBe(20);
    expect(u.total_tokens).toBe(160);
    expect(u.prompt_tokens_details.cached_tokens).toBe(30);
    expect(u.prompt_tokens_details.cache_creation_tokens).toBe(10);
  });

  it("claude: no cache -> no prompt_tokens_details", () => {
    const u = toOpenAIUsage({ input_tokens: 50, output_tokens: 5 }, "claude");
    expect(u.prompt_tokens).toBe(50);
    expect(u.prompt_tokens_details).toBeUndefined();
  });

  it("gemini: full fields, completion = candidates + thoughts", () => {
    const u = toOpenAIUsage(
      { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10, totalTokenCount: 150 },
      "gemini"
    );
    expect(u.prompt_tokens).toBe(100);
    expect(u.completion_tokens).toBe(50);
    expect(u.total_tokens).toBe(150);
    expect(u.completion_tokens_details.reasoning_tokens).toBe(10);
  });

  it("gemini fallback: candidates=0 -> derive from total - prompt - thoughts", () => {
    const u = toOpenAIUsage(
      { promptTokenCount: 100, candidatesTokenCount: 0, thoughtsTokenCount: 10, totalTokenCount: 150 },
      "gemini"
    );
    // candidates derived = 150 - 100 - 10 = 40 ; completion = 40 + 10
    expect(u.completion_tokens).toBe(50);
  });

  it("kiro: input/output straight", () => {
    const u = toOpenAIUsage({ inputTokens: 12, outputTokens: 3 }, "kiro");
    expect(u.prompt_tokens).toBe(12);
    expect(u.completion_tokens).toBe(3);
    expect(u.total_tokens).toBe(15);
  });

  it("ollama: prompt_eval_count/eval_count", () => {
    const u = toOpenAIUsage({ prompt_eval_count: 7, eval_count: 4 }, "ollama");
    expect(u.prompt_tokens).toBe(7);
    expect(u.completion_tokens).toBe(4);
    expect(u.total_tokens).toBe(11);
  });

  it("commandcode: keeps totalTokens fallback", () => {
    const u = toOpenAIUsage({ inputTokens: 8, outputTokens: 2, totalTokens: 99 }, "commandcode");
    expect(u.prompt_tokens).toBe(8);
    expect(u.completion_tokens).toBe(2);
    expect(u.total_tokens).toBe(99);
  });

  it("commandcode: reports AI SDK v5 cache reads (live finish.totalUsage shape)", () => {
    // Verified live 2026-09-22: inputTokens is cache-INCLUSIVE (noCacheTokens + cacheReadTokens),
    // so cached must surface as a prompt_tokens_details subset, not be added to prompt_tokens.
    const u = toOpenAIUsage(
      {
        inputTokens: 2079,
        inputTokenDetails: { noCacheTokens: 159, cacheReadTokens: 1920 },
        outputTokens: 16,
        totalTokens: 2095,
        cachedInputTokens: 1920,
      },
      "commandcode"
    );
    expect(u.prompt_tokens).toBe(2079);
    expect(u.prompt_tokens_details.cached_tokens).toBe(1920);
    expect(u.total_tokens).toBe(2095);
  });

  it("commandcode: reports AI SDK v5 reasoning tokens (live finish.totalUsage shape)", () => {
    // Live: outputTokenDetails.textTokens + reasoningTokens == outputTokens,
    // so reasoning is a completion subset reported via completion_tokens_details.
    const u = toOpenAIUsage(
      { inputTokens: 2079, outputTokens: 16, totalTokens: 2095, outputTokenDetails: { textTokens: 0, reasoningTokens: 16 }, reasoningTokens: 16 },
      "commandcode"
    );
    expect(u.completion_tokens).toBe(16);
    expect(u.completion_tokens_details.reasoning_tokens).toBe(16);
  });

  it("commandcode: falls back to raw upstream cache fields", () => {
    const fromRaw = toOpenAIUsage(
      { inputTokens: 2079, outputTokens: 16, raw: { prompt_tokens_details: { cached_tokens: 1920 } } },
      "commandcode"
    );
    expect(fromRaw.prompt_tokens_details.cached_tokens).toBe(1920);

    const fromHit = toOpenAIUsage(
      { inputTokens: 2079, outputTokens: 16, raw: { prompt_cache_hit_tokens: 1920 } },
      "commandcode"
    );
    expect(fromHit.prompt_tokens_details.cached_tokens).toBe(1920);
  });

  it("commandcode: cache miss -> no prompt_tokens_details", () => {
    const u = toOpenAIUsage(
      { inputTokens: 2079, inputTokenDetails: { noCacheTokens: 2079, cacheReadTokens: 0 }, outputTokens: 16, cachedInputTokens: 0 },
      "commandcode"
    );
    expect(u.prompt_tokens_details).toBeUndefined();
  });

  it("unknown kind / null raw -> null", () => {
    expect(toOpenAIUsage({}, "nope")).toBeNull();
    expect(toOpenAIUsage(null, "claude")).toBeNull();
  });
});
