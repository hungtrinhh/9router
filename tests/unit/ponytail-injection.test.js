import { describe, it, expect } from "vitest";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { PONYTAIL_LEVELS, PONYTAIL_PROMPTS } from "../../open-sse/rtk/ponytailPrompt.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("ponytail RTK system injection", () => {
  it("injects into OpenAI-format messages", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    };
    injectPonytail(body, FORMATS.OPENAI, PONYTAIL_LEVELS.FULL);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(PONYTAIL_PROMPTS[PONYTAIL_LEVELS.FULL]);
  });

  it("appends to existing OpenAI system message", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a bot." },
        { role: "user", content: "hello" },
      ],
    };
    injectPonytail(body, FORMATS.OPENAI, PONYTAIL_LEVELS.LITE);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].content).toBe(`You are a bot.\n\n${PONYTAIL_PROMPTS[PONYTAIL_LEVELS.LITE]}`);
  });

  it("injects into Claude-format body.system", () => {
    const body = {
      model: "claude-3-5-sonnet",
      system: "Original prompt",
      messages: [{ role: "user", content: "hi" }],
    };
    injectPonytail(body, FORMATS.CLAUDE, PONYTAIL_LEVELS.ULTRA);
    expect(body.system).toBe(`Original prompt\n\n${PONYTAIL_PROMPTS[PONYTAIL_LEVELS.ULTRA]}`);
  });

  it("injects into Gemini-format systemInstruction", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    };
    injectPonytail(body, FORMATS.GEMINI, PONYTAIL_LEVELS.FULL);
    expect(body.systemInstruction?.parts?.[0]?.text).toBe(PONYTAIL_PROMPTS[PONYTAIL_LEVELS.FULL]);
  });

  it("handles null or undefined safely", () => {
    expect(() => injectPonytail(null, FORMATS.OPENAI, PONYTAIL_LEVELS.FULL)).not.toThrow();
    expect(() => injectPonytail({}, FORMATS.OPENAI, "non-existent-level")).not.toThrow();
  });
});
