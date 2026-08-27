// Gemini helper functions for translator

import { safeParseJSON } from "../concerns/json.js";
import { OPENAI_BLOCK } from "../schema/index.js";

// Unsupported JSON Schema constraints that should be removed for Antigravity
export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  // Basic constraints (not supported by Gemini API)
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "format", "multipleOf",
  // Array keywords the Gemini schema proto has no field for. Agent tool
  // schemas set these routinely, and one occurrence rejects the whole request
  // with "Unknown name ...: Cannot find field".
  "uniqueItems", "contains",
  // 2020-12 keywords with no Gemini equivalent
  "unevaluatedProperties", "unevaluatedItems", "contentSchema",
  // Claude rejects these in VALIDATED mode
  "default", "examples",
  // JSON Schema meta keywords
  "$schema", "$defs", "definitions", "const", "$ref", "$comment",
  // Annotation keywords (rejected by Gemini/Antigravity - e.g. MCP tool schemas set these)
  "deprecated", "readOnly", "writeOnly",
  // Object validation keywords (not supported)
  "additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
  // Complex schema keywords (handled by flattenAnyOfOneOf/mergeAllOf)
  "anyOf", "oneOf", "allOf", "not",
  // Dependency keywords (not supported)
  "dependencies", "dependentSchemas", "dependentRequired",
  // Other unsupported keywords
  "title", "optional", "deprecated", "if", "then", "else", "contentMediaType", "contentEncoding",
  // UI/Styling properties (from Cursor tools - NOT JSON Schema standard)
  "cornerRadius", "fillColor", "fontFamily", "fontSize", "fontWeight",
  "gap", "padding", "strokeColor", "strokeThickness", "textColor"
];

// Default safety settings
export const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" }
];

// Convert OpenAI content to Gemini parts
export function convertOpenAIContentToParts(content) {
  const parts = [];

  if (typeof content === "string") {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === OPENAI_BLOCK.TEXT) {
        parts.push({ text: item.text });
      } else if (item.type === OPENAI_BLOCK.IMAGE_URL && item.image_url?.url?.startsWith("data:")) {
        const url = item.image_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex); // skip "data:"
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];

          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      } else if (item.type === OPENAI_BLOCK.IMAGE_URL && item.image_url?.url && (item.image_url.url.startsWith("http://") || item.image_url.url.startsWith("https://"))) {
        parts.push({
          fileData: { fileUri: item.image_url.url, mimeType: "image/*" }
        });
      } else if (item.type === OPENAI_BLOCK.INPUT_AUDIO && item.input_audio?.data) {
        const format = item.input_audio.format || "wav";
        const mimeType = format === "mp3" ? "audio/mpeg" : `audio/${format}`;
        parts.push({
          inlineData: { mime_type: mimeType, data: item.input_audio.data }
        });
      } else if (item.type === OPENAI_BLOCK.AUDIO_URL && item.audio_url?.url?.startsWith("data:")) {
        const url = item.audio_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];
          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      } else if (item.type === OPENAI_BLOCK.FILE && item.file?.file_data?.startsWith("data:")) {
        const url = item.file.file_data;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimeType = url.substring(5, commaIndex).split(";")[0];
          const data = url.substring(commaIndex + 1);
          parts.push({ inlineData: { mime_type: mimeType, data: data } });
        }
      }
    }
  }

  return parts;
}

// Extract text content from OpenAI content
export function extractTextContent(content, separator = "") {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === OPENAI_BLOCK.TEXT).map(c => c.text).join(separator);
  }
  return "";
}

// Try parse JSON safely (null fallback on parse error; re-export keeps legacy API)
export function tryParseJSON(str) {
  return safeParseJSON(str, null);
}

// Generate request ID
export function generateRequestId() {
  return `agent-${crypto.randomUUID()}`;
}

// Generate session ID (binary-compatible format: UUID + timestamp)
export function generateSessionId() {
  return crypto.randomUUID() + Date.now().toString();
}

// Generate project ID
export function generateProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

// Helper: Visit each child schema in a JSON schema object without traversing non-schema maps (like properties hashmap)
function forEachChildSchema(obj, fn) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object") fn(item);
    }
    return;
  }

  if (obj.properties) {
    if (Array.isArray(obj.properties)) {
      for (const entry of obj.properties) {
        if (entry && typeof entry === "object") {
          if (entry.value && typeof entry.value === "object") fn(entry.value);
          if (entry.items && typeof entry.items === "object") fn(entry.items);
          if (!("value" in entry) && entry.properties !== undefined) fn(entry);
        }
      }
    } else if (typeof obj.properties === "object") {
      for (const propSchema of Object.values(obj.properties)) {
        if (propSchema && typeof propSchema === "object") fn(propSchema);
      }
    }
  }

  if (obj.patternProperties && typeof obj.patternProperties === "object" && !Array.isArray(obj.patternProperties)) {
    for (const propSchema of Object.values(obj.patternProperties)) {
      if (propSchema && typeof propSchema === "object") fn(propSchema);
    }
  }

  if (obj.additionalProperties && typeof obj.additionalProperties === "object" && !Array.isArray(obj.additionalProperties)) {
    fn(obj.additionalProperties);
  }

  if (obj.items) {
    if (Array.isArray(obj.items)) {
      for (const item of obj.items) {
        if (item && typeof item === "object") fn(item);
      }
    } else if (typeof obj.items === "object") {
      fn(obj.items);
    }
  }

  if (obj.prefixItems && Array.isArray(obj.prefixItems)) {
    for (const item of obj.prefixItems) {
      if (item && typeof item === "object") fn(item);
    }
  }

  if (obj.allOf && Array.isArray(obj.allOf)) {
    for (const sub of obj.allOf) {
      if (sub && typeof sub === "object") fn(sub);
    }
  }

  if (obj.anyOf && Array.isArray(obj.anyOf)) {
    for (const sub of obj.anyOf) {
      if (sub && typeof sub === "object") fn(sub);
    }
  }

  if (obj.oneOf && Array.isArray(obj.oneOf)) {
    for (const sub of obj.oneOf) {
      if (sub && typeof sub === "object") fn(sub);
    }
  }

  if (obj.not && typeof obj.not === "object") {
    fn(obj.not);
  }
}

// Helper: Remove unsupported keywords recursively from schema objects
// Also strips all vendor extension fields (x- prefixed) not supported by Gemini
function removeUnsupportedKeywords(obj, keywords) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      removeUnsupportedKeywords(item, keywords);
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    if (keywords.includes(key) || key.startsWith("x-")) {
      delete obj[key];
    }
  }

  forEachChildSchema(obj, (child) => removeUnsupportedKeywords(child, keywords));
}

// Convert const to enum
function convertConstToEnum(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.const !== undefined && !obj.enum) {
    obj.enum = [obj.const];
    delete obj.const;
  }

  forEachChildSchema(obj, (child) => convertConstToEnum(child));
}

// Convert enum values to strings (Gemini requires string enum values + explicit type:"string")
function convertEnumValuesToStrings(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.enum && Array.isArray(obj.enum)) {
    obj.enum = obj.enum.map(v => String(v));
    // Gemini API requires type:"string" when enum is present — without it returns 400
    if (!obj.type) {
      obj.type = "string";
    }
  }

  forEachChildSchema(obj, (child) => convertEnumValuesToStrings(child));
}

// Merge allOf schemas
function mergeAllOf(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.allOf && Array.isArray(obj.allOf)) {
    const merged = {};

    for (const item of obj.allOf) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const req of item.required) {
          if (!merged.required.includes(req)) {
            merged.required.push(req);
          }
        }
      }
    }

    delete obj.allOf;
    if (merged.properties) obj.properties = { ...obj.properties, ...merged.properties };
    if (merged.required) obj.required = [...(obj.required || []), ...merged.required];
  }

  forEachChildSchema(obj, (child) => mergeAllOf(child));
}

// Select best schema from anyOf/oneOf
function selectBest(items) {
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let score = 0;
    const type = item.type;

    if (type === "object" || item.properties) {
      score = 3;
    } else if (type === "array" || item.items) {
      score = 2;
    } else if (type && type !== "null") {
      score = 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

// Flatten anyOf/oneOf
function flattenAnyOfOneOf(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.anyOf && Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
    const nonNullSchemas = obj.anyOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.anyOf;
      Object.assign(obj, selected);
    }
  }

  if (obj.oneOf && Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
    const nonNullSchemas = obj.oneOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.oneOf;
      Object.assign(obj, selected);
    }
  }

  forEachChildSchema(obj, (child) => flattenAnyOfOneOf(child));
}

// Flatten type arrays
function flattenTypeArrays(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.type && Array.isArray(obj.type)) {
    const nonNullTypes = obj.type.filter(t => t !== "null");
    obj.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
  }

  forEachChildSchema(obj, (child) => flattenTypeArrays(child));
}

// Expand JSON Schema shorthand into full schema objects.
// Clients (Claude/Anthropic tool schemas, MCP) routinely emit:
//   - property values as bare type strings: { "foo": "object" }
//   - boolean schemas: true (= any value) / false (= never valid)
//   - numeric/null/array scalar shorthands: { "port": 3000 }, { "x": null }
// Gemini/Antigravity reject all of these as 400 INVALID_ARGUMENT
// ("Starting an object on a scalar field"). Walk `properties` values and
// `items` explicitly — a plain recursive value scan cannot reach entries
// that are scalars, not objects.
function typeFromScalar(value) {
  if (value === null) return "object";
  switch (typeof value) {
    case "string":
      return value === "number" || value === "integer" || value === "boolean" || value === "array" || value === "string" ? value : "object";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

function scalarToSchema(value) {
  const t = typeFromScalar(value);
  return { type: t };
}

function expandShorthandSchemas(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)) {
    for (const key of Object.keys(obj.properties)) {
      const value = obj.properties[key];
      if (value && typeof value === "object" && !Array.isArray(value)) continue; // already a schema
      if (Array.isArray(value)) {
        // Scalar array shorthand: [ "a", "b" ] or [ 1, 2 ] → array schema.
        // If the array holds objects (a list of schemas), leave it untouched.
        const allScalar = value.length === 0 || value.every(v => v === null || typeof v !== "object");
        if (allScalar) {
          obj.properties[key] = {
            type: "array",
            items: value.length > 0 ? scalarToSchema(value[0]) : { type: "string" },
          };
        }
      } else {
        obj.properties[key] = scalarToSchema(value);
      }
    }
  } else if (Array.isArray(obj.properties)) {
    // Array-form properties (Antigravity/Google Cloud Code): each entry is
    // { name, value: <schema> }. Expand scalar shorthand inside `value`.
    for (let i = 0; i < obj.properties.length; i++) {
      const element = obj.properties[i];
      if (!element || typeof element !== "object") continue;
      // Handle element.value scalar shorthand
      if ("value" in element) {
        const v = element.value;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          expandShorthandSchemas(v); // already a schema object — recurse
        } else if (Array.isArray(v)) {
          // Scalar array shorthand
          const allScalar = v.length === 0 || v.every(x => x === null || typeof x !== "object");
          if (allScalar) {
            element.value = {
              type: "array",
              items: v.length > 0 ? scalarToSchema(v[0]) : { type: "string" },
            };
          }
        } else {
          element.value = scalarToSchema(v); // scalar shorthand
        }
      }
      // Handle element.items shorthand
      if ("items" in element) {
        const items = element.items;
        if (items && typeof items === "object" && !Array.isArray(items)) {
          // already a schema — recurse
        } else {
          element.items = (items === true || items === false || items === null || typeof items === "string" || typeof items === "number")
            ? scalarToSchema(items) : { type: "object" };
        }
      }
      // Handle element itself being a plain schema (no "value" key)
      if (!("value" in element) && element.properties !== undefined) {
        expandShorthandSchemas(element);
      }
    }
  }

  if (obj.items === true) {
    obj.items = { type: "object" };
  } else if (obj.items === false) {
    obj.items = { type: "object" };
  } else if (typeof obj.items === "string") {
    const t = obj.items === "number" ? "number" : obj.items === "integer" ? "integer" : obj.items === "boolean" ? "boolean" : obj.items === "array" ? "array" : obj.items === "string" ? "string" : "object";
    obj.items = { type: t };
  } else if (obj.items === null || typeof obj.items === "number" || typeof obj.items === "boolean") {
    obj.items = scalarToSchema(obj.items);
  } else if (Array.isArray(obj.items)) {
    // Nested-array shorthand: items: [ "a", "b" ] (scalar list) → array schema.
    // Items holding objects (a list of schemas) are left untouched.
    const allScalar = obj.items.length === 0 || obj.items.every(v => v === null || typeof v !== "object");
    if (allScalar) {
      obj.items = {
        type: "array",
        items: obj.items.length > 0 ? scalarToSchema(obj.items[0]) : { type: "string" },
      };
    }
  }

  forEachChildSchema(obj, (child) => expandShorthandSchemas(child));
}

// Infer missing type=object when properties exist (Gemini requires explicit type)
function ensureObjectType(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.properties && !obj.type) obj.type = "object";
  forEachChildSchema(obj, (child) => ensureObjectType(child));
}

// Clean JSON Schema for Antigravity API compatibility - removes unsupported keywords recursively
export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== "object") return schema;

  // Mutate directly (schema is only used once per request)
  let cleaned = schema;

  // Phase 0: Expand shorthand schemas (string/boolean property values, boolean items)
  expandShorthandSchemas(cleaned);

  // Phase 1: Convert and prepare
  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);

  // Phase 2: Flatten complex structures
  mergeAllOf(cleaned);
  flattenAnyOfOneOf(cleaned);
  flattenTypeArrays(cleaned);

  // Phase 2.5: Infer missing type=object when properties exist (Gemini requirement)
  ensureObjectType(cleaned);

  // Phase 3: Remove all unsupported keywords at ALL levels (including inside arrays)
  removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);

  // Phase 4: Cleanup required fields recursively
  function cleanupRequired(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.required && Array.isArray(obj.required) && obj.properties) {
      if (Array.isArray(obj.properties)) {
        const validRequired = obj.required.filter(field =>
          obj.properties.some(p => p && (p.name === field || p === field))
        );
        if (validRequired.length === 0) {
          delete obj.required;
        } else {
          obj.required = validRequired;
        }
      } else if (typeof obj.properties === "object") {
        const validRequired = obj.required.filter(field =>
          Object.prototype.hasOwnProperty.call(obj.properties, field)
        );
        if (validRequired.length === 0) {
          delete obj.required;
        } else {
          obj.required = validRequired;
        }
      }
    }

    forEachChildSchema(obj, (child) => cleanupRequired(child));
  }

  cleanupRequired(cleaned);

  // Phase 5: Add placeholder for empty object schemas (Antigravity requirement)
  function addPlaceholders(obj) {
    if (!obj || typeof obj !== "object") return;

    // Empty schema {} (no type, no properties) after $ref removal — treat as object with placeholder
    if (Object.keys(obj).length === 0) {
      obj.type = "object";
      obj.properties = {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      };
      obj.required = ["reason"];
      return;
    }

    if (obj.type === "object") {
      if (!obj.properties || (typeof obj.properties === "object" && !Array.isArray(obj.properties) && Object.keys(obj.properties).length === 0)) {
        obj.properties = {
          reason: {
            type: "string",
            description: "Brief explanation of why you are calling this tool"
          }
        };
        obj.required = ["reason"];
      }
    }

    forEachChildSchema(obj, (child) => addPlaceholders(child));
  }

  addPlaceholders(cleaned);

  // Phase 6: Safety net — any property value or items that is still not a
  // schema object (scalar from an exotic shorthand, leftover after earlier
  // phases) would be rejected by Gemini as "Starting an object on a scalar
  // field". Force every slot to an object schema and log the offending schema
  // so the source form can be handled precisely.
  function enforceSchemaObjects(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)) {
      for (const key of Object.keys(obj.properties)) {
        const value = obj.properties[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          enforceSchemaObjects(value);
        } else {
          console.warn(`[antigravity] non-object schema property "${key}": ${JSON.stringify(value)}`);
          obj.properties[key] = { type: "object" };
        }
      }
    } else if (Array.isArray(obj.properties)) {
      // Array-form properties (Antigravity/Google Cloud Code): each entry is
      // { name, value: <schema> }. Force every `value`/`items` to a schema object.
      for (let i = 0; i < obj.properties.length; i++) {
        const element = obj.properties[i];
        if (!element || typeof element !== "object") continue;
        if ("value" in element) {
          const v = element.value;
          if (v && typeof v === "object" && !Array.isArray(v)) {
            enforceSchemaObjects(v);
          } else {
            console.warn(`[antigravity] non-object schema property value: ${JSON.stringify(v)}`);
            element.value = { type: "object" };
          }
        }
        if ("items" in element) {
          const items = element.items;
          if (items && typeof items === "object" && !Array.isArray(items)) {
            enforceSchemaObjects(items);
          } else {
            console.warn(`[antigravity] non-object schema items: ${JSON.stringify(items)}`);
            element.items = { type: "object" };
          }
        }
        if (!("value" in element) && element.properties !== undefined) {
          enforceSchemaObjects(element);
        }
      }
    }

    if (obj.items !== undefined) {
      const items = obj.items;
      if (items && typeof items === "object" && !Array.isArray(items)) {
        enforceSchemaObjects(items);
      } else {
        console.warn(`[antigravity] non-object schema items: ${JSON.stringify(items)}`);
        obj.items = { type: "object" };
      }
    }

    forEachChildSchema(obj, (child) => enforceSchemaObjects(child));
  }

  enforceSchemaObjects(cleaned);

  return cleaned;
}

