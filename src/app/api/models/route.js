import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { resolveModelCaps } from "@/shared/utils/modelLimits";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    // One row per routable id. The catalog lists a few ids twice (gemini's STT
    // rows reuse the LLM ids) and AI_MODELS drops `kind`, so nothing downstream
    // could tell the repeats apart.
    const models = [];
    const byRoute = new Map(); // id form and alias form -> entry

    for (const m of AI_MODELS) {
      const providerAlias = getProviderAlias(m.provider) || m.provider;
      const list = disabled[providerAlias] || disabled[m.provider] || [];
      if (list.includes(m.model)) continue;

      const fullModel = `${m.provider}/${m.model}`;
      const routedModel = `${providerAlias}/${m.model}`;
      if (byRoute.has(fullModel) || byRoute.has(routedModel)) continue;

      const c = resolveModelCaps(routedModel);
      const entry = {
        ...m,
        fullModel,
        routedModel,
        alias: modelAliases[fullModel] || m.model,
        caps: {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
        },
      };
      byRoute.set(fullModel, entry);
      byRoute.set(routedModel, entry);
      models.push(entry);
    }

    // Custom models ride along; their stored caps override the name heuristic.
    // Catalog rows carry the provider id in `fullModel` and the routing alias in
    // `routedModel` — those differ for ~28 providers — while custom models are
    // stored under the alias, so either form must match or an alias-registered
    // custom model lands as a second copy of a row already in the list.
    for (const m of await getCustomModels()) {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") continue;

      const fullModel = `${m.providerAlias}/${m.id}`;
      const c = resolveModelCaps(fullModel);
      const caps = {
        vision: c.vision,
        search: c.search,
        reasoning: c.reasoning,
        contextWindow: c.contextWindow,
        maxOutput: c.maxOutput,
        ...(m.caps || {}),
      };

      const existing = byRoute.get(fullModel);
      if (existing) {
        existing.caps = caps;
        continue;
      }

      const entry = {
        provider: m.providerAlias,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel: fullModel,
        alias: modelAliases[fullModel] || m.id,
        caps,
      };
      byRoute.set(fullModel, entry);
      models.push(entry);
    }

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
