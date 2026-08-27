// Real Antigravity-MITM requests (Gemini-internal: { request: { contents, ... } }) → OpenAI.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../open-sse/config/appConstants.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

const AG2O = (req) =>
  translateRequest(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, "m", { request: req }, true, null, null);

describe("Antigravity → OpenAI", () => {
  // antigravity-to-openai.js — content with BOTH functionResponse and functionCall/text
  // previously returned toolResults early → dropped tool calls / text (fixed in #2225)
  it("functionResponse + functionCall in same content keeps both", () => {
    const out = AG2O({
      contents: [{
        role: "model",
        parts: [
          { functionResponse: { id: "c1", name: "prev", response: { result: "done" } } },
          { functionCall: { id: "c2", name: "next", args: {} } },
        ],
      }],
    });
    const json = JSON.stringify(out);
    expect(json, "functionCall lost when sharing content with functionResponse").toContain("\"next\"");
  });

  // antigravity-to-openai.js:167 — functionCall without id gets a random Date.now() id
  // KNOWN BUG: unstable id breaks matching with its functionResponse
  it("functionCall without id keeps a stable matchable id", () => {
    const out = AG2O({
      contents: [
        { role: "model", parts: [{ functionCall: { name: "search", args: { q: "x" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "search", response: { result: "r" } } }] },
      ],
    });
    const asst = out.messages.find((m) => m.tool_calls);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id, "id mismatch between call and response").toBe(asst?.tool_calls?.[0]?.id);
  });

  // antigravity-to-openai.js:144-147 — signature-only part handling (regression guard)
  it("signature-only part does not produce empty text", () => {
    const out = AG2O({
      contents: [{ role: "model", parts: [{ thoughtSignature: "sig", text: "" }] }],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    const content = asst?.content;
    const hasEmpty = Array.isArray(content)
      ? content.some((c) => c.type === "text" && c.text === "")
      : content === "";
    expect(hasEmpty, "empty text part emitted").toBe(false);
  });
});

describe("Antigravity → Claude", () => {
  it("tool call input_json_delta includes Anthropic index", () => {
    const state = initState(FORMATS.CLAUDE);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, {
      response: {
        responseId: "resp-1",
        modelVersion: "gemini-pro-agent",
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { name: "bash", args: { command: "git status" } } }],
          },
          finishReason: "STOP",
          index: 0,
        }],
      },
    }, state);

    const jsonDelta = events.find(
      (event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta"
    );
    expect(jsonDelta).toMatchObject({ index: expect.any(Number) });
    expect(JSON.parse(jsonDelta.delta.partial_json)).toEqual({ command: "git status" });
  });
});

describe("Antigravity executor", () => {
  it("strips optional from nested tool schemas", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "lookup",
            description: "Lookup a value",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query",
                  optional: true,
                },
              },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const query = out.request.tools[0].functionDeclarations[0].parameters.properties.query;
    expect(query).toEqual({ type: "string", description: "Search query" });
  });
  // gemini.js cleanJSONSchemaForAntigravity: string-shorthand property values
  // ("foo": "object") and boolean items (items: true) are not valid schema objects
  // and previously reached Antigravity as-is → 400 INVALID_ARGUMENT at
  // properties[N].value / properties[N].value.items.
  it("expands string-shorthand properties and boolean items into schema objects", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "search",
            description: "Search",
            parameters: {
              type: "object",
              properties: {
                query: "string",
                strict: "boolean",
                nested: {
                  type: "object",
                  properties: {
                    anything: true,
                    never: false,
                  },
                },
                list: {
                  type: "array",
                  items: true,
                },
              },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const props = out.request.tools[0].functionDeclarations[0].parameters.properties;
    // bare true/false shorthand → boolean schema; the empty-object items
    // placeholder (list.items) is filled by Phase 5.
    expect(props.nested.properties.anything.type).toBe("boolean");
    expect(props.nested.properties.never.type).toBe("boolean");
    expect(props.list.items.type).toBe("object");
  });
  // gemini.js expandShorthandSchemas: numeric/null/array scalar property
  // values (MCP shorthand { "port": 3000 }, { "x": null }, [1,2,3]) previously
  // reached Antigravity as scalars → 400 "Starting an object on a scalar field".
  it("expands numeric, null, and scalar-array property shorthands", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "lookup",
            description: "Lookup",
            parameters: {
              type: "object",
              properties: {
                port: 3000,
                maybe: null,
                coords: [1, 2, 3],
                names: ["a", "b"],
              },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const props = out.request.tools[0].functionDeclarations[0].parameters.properties;
    expect(props.port).toEqual({ type: "number" });
    expect(props.maybe.type).toBe("object"); // placeholder object
    expect(props.coords.type).toBe("array");
    expect(props.coords.items.type).toBe("number");
    expect(props.names.type).toBe("array");
    expect(props.names.items.type).toBe("object"); // placeholder object
  });
  // gemini.js: items: [ "a", "b" ] (scalar list as items) is a nested-array
  // shorthand that previously stayed a raw array → 400 at properties[N].value.items.
  it("expands scalar-array items shorthand", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "matrix",
            description: "Matrix",
            parameters: {
              type: "object",
              properties: {
                grid: { type: "array", items: ["a", "b"] },
                deep: {
                  type: "object",
                  properties: { level: { type: "array", items: [1, 2] } },
                },
              },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const props = out.request.tools[0].functionDeclarations[0].parameters.properties;
    expect(props.grid.type).toBe("array");
    expect(props.grid.items.type).toBe("array");
    expect(props.grid.items.items.type).toBe("object"); // placeholder
    expect(props.deep.properties.level.type).toBe("array");
    expect(props.deep.properties.level.items.type).toBe("array");
  });

  // gemini.js expandShorthandSchemas/enforceSchemaObjects: Antigravity/Google
  // Cloud Code sends parameters.properties as an ARRAY of { name, value: <schema> }
  // entries. Scalar shorthand inside `value` previously stayed scalar → 400
  // "Starting an object on a scalar field" at properties[N].value.
  it("expands array-form properties with scalar shorthand values", () => {
    const schema = {
      type: "object",
      properties: [
        { name: "query", value: "string" },
        { name: "port", value: 3000 },
        { name: "flag", value: null },
        { name: "enabled", value: true },
        { name: "items", value: ["a", "b", "c"] },
        { name: "nested", value: { type: "object", properties: [{ name: "inner", value: 42 }] } },
      ],
    };

    const cleaned = cleanJSONSchemaForAntigravity(schema);
    const props = cleaned.properties;

    // Every properties[i].value must be a schema object with a type
    expect(props).toHaveLength(6);
    for (const p of props) {
      expect(p.value).toBeTypeOf("object");
      expect(typeof p.value.type).toBe("string");
    }
    // Scalar shorthands expanded to the correct type
    const byName = Object.fromEntries(props.map((p) => [p.name, p.value]));
    expect(byName.query).toEqual({ type: "string" });
    expect(byName.port).toEqual({ type: "number" });
    expect(byName.flag.type).toBe("object"); // null → placeholder object
    expect(byName.enabled).toEqual({ type: "boolean" });
    // scalar string "a" is not a schema type keyword → items becomes an object placeholder
    expect(byName.items.type).toBe("array");
    expect(byName.items.items.type).toBe("object");
    // Nested array-form properties also expanded
    expect(byName.nested.properties).toHaveLength(1);
    expect(byName.nested.properties[0].value).toEqual({ type: "number" });
  });

  // Deep nesting: array-form properties recursed at every level
  it("array-form properties with nested objects recurses correctly", () => {
    const schema = {
      type: "object",
      properties: [
        {
          name: "l1",
          value: {
            type: "object",
            properties: [
              {
                name: "l2",
                value: {
                  type: "object",
                  properties: [
                    { name: "l3", value: "integer" },
                    { name: "l3list", value: [1, 2, 3] },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    const cleaned = cleanJSONSchemaForAntigravity(schema);
    const l1 = cleaned.properties[0].value;
    expect(l1.properties[0].value.properties[0].value).toEqual({ type: "integer" });
    expect(l1.properties[0].value.properties[1].value).toEqual({
      type: "array",
      items: { type: "number" },
    });
  });
  it("correctly preserves parameters named properties, format, default without corrupting types", () => {
    const schema = {
      type: "object",
      properties: {
        i: { type: "string" },
        action: { type: "string" },
        format: { type: "string", description: "Audio format" },
        default: { type: "string", description: "Default value" },
        properties: {
          anyOf: [
            { type: "object", additionalProperties: true },
            { type: "string" },
            { type: "null" }
          ],
          default: null
        }
      },
      required: ["action", "i", "format", "default"]
    };

    const cleaned = cleanJSONSchemaForAntigravity(schema);

    // 1. Should preserve format and default as properties
    expect(cleaned.properties.format).toEqual({ type: "string", description: "Audio format" });
    expect(cleaned.properties.default).toEqual({ type: "string", description: "Default value" });

    // 2. Should clean `properties` property without turning its type or required into object
    expect(cleaned.properties.properties).toBeTypeOf("object");
    expect(cleaned.properties.properties.type).toBe("object");
    expect(cleaned.properties.properties.required).toEqual(["reason"]);
    expect(cleaned.properties.properties.properties).toEqual({
      reason: {
        type: "string",
        description: "Brief explanation of why you are calling this tool"
      }
    });

    // 3. Root schema should not have ghost `type` property in properties map
    expect(cleaned.properties.type).toBeUndefined();
    expect(cleaned.required).toEqual(["action", "i", "format", "default"]);
  });

  it("does not inject the legacy Antigravity default system prompt for Gemini-backed models", () => {
    const out = openaiToAntigravityRequest("gemini-3.5-flash-low", {
      messages: [
        { role: "system", content: "USER_SYSTEM_PROMPT" },
        { role: "user", content: "hello" },
      ],
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const system = JSON.stringify(out.request.systemInstruction);
    expect(system).toContain("USER_SYSTEM_PROMPT");
    expect(system).not.toContain(ANTIGRAVITY_DEFAULT_SYSTEM);
    expect(system).not.toContain("Please ignore the following [ignore]");
  });

  it("does not inject the legacy Antigravity default system prompt for Claude-backed models", () => {
    const out = openaiToAntigravityRequest("claude-opus-4-6-thinking", {
      messages: [
        { role: "system", content: "USER_SYSTEM_PROMPT" },
        { role: "user", content: "hello" },
      ],
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const system = JSON.stringify(out.request.systemInstruction);
    expect(system).toContain("USER_SYSTEM_PROMPT");
    expect(system).not.toContain(ANTIGRAVITY_DEFAULT_SYSTEM);
    expect(system).not.toContain("Please ignore the following [ignore]");
  });
});
