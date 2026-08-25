"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import BashSetupButton from "./BashSetupButton";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const ENDPOINT = "/api/cli-tools/omp-settings";

const OMP_SUBAGENT_TYPES = [
  {
    id: "task",
    label: "Task (General)",
    help: "Default general-purpose subagent for delegated multi-step tasks",
  },
  {
    id: "scout",
    label: "Scout (Research)",
    help: "Fast read-only agent for exploratory codebase research & file searching",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    help: "Code review specialist for quality, security & architecture analysis",
  },
  {
    id: "security-reviewer",
    label: "Security Reviewer",
    help: "Read-only security specialist for repository vulnerability discovery",
  },
  {
    id: "designer",
    label: "Designer",
    help: "UI/UX specialist for frontend design implementation & visual polish",
  },
  {
    id: "sonic",
    label: "Sonic (Fast)",
    help: "Low-reasoning subagent for strictly mechanical updates & data collection",
  },
];

function ModelField({ label, value, placeholder, onChange, onSelect, disabled, help, onClear }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8.5rem_auto_1fr_auto] sm:items-center sm:gap-2">
      <div className="sm:text-right">
        <span className="text-xs font-semibold text-text-main sm:text-sm">{label}</span>
        {help && <p className="mt-0.5 text-[10px] leading-tight text-text-muted">{help}</p>}
      </div>
      <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
      <div className="relative w-full min-w-0">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        />
        {value && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors"
            title="Clear"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${
          !disabled
            ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
            : "opacity-50 cursor-not-allowed border-border"
        }`}
      >
        Select
      </button>
    </div>
  );
}

export default function OmpToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  activeProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  canManageLocalSettings = true,
}) {
  const initialActiveModel =
    initialStatus?.omp?.activeModel || initialStatus?.omp?.models?.[0] || initialStatus?.savedConfig?.activeModel || initialStatus?.savedConfig?.model || "";
  const [ompStatus, setOmpStatus] = useState(initialStatus || null);
  const [checkingOmp, setCheckingOmp] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);

  const [selectedApiKey, setSelectedApiKey] = useState(
    initialStatus?.omp?.apiKey || apiKeys?.[0]?.key || ""
  );
  const [selectedModel, setSelectedModel] = useState(initialActiveModel);
  const [smolModel, setSmolModel] = useState(initialStatus?.omp?.smolModel || "");
  const [slowModel, setSlowModel] = useState(initialStatus?.omp?.slowModel || "");
  const [planModel, setPlanModel] = useState(initialStatus?.omp?.planModel || "");
  const [subagentModels, setSubagentModels] = useState(
    initialStatus?.omp?.subagentModels || {}
  );

  const [modalTarget, setModalTarget] = useState(null); // 'default' | 'smol' | 'slow' | 'plan' | subagent ID
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasFetchedStatus = useRef(Boolean(initialStatus));

  const configuredUrl = ompStatus?.omp?.baseUrl || ompStatus?.settings?.provider?.baseUrl;
  const configStatus = !ompStatus?.installed
    ? null
    : !ompStatus?.has9Router
    ? "not_configured"
    : !configuredUrl
    ? "not_configured"
    : matchKnownEndpoint(configuredUrl, { tunnelPublicUrl, tailscaleUrl })
    ? "configured"
    : "other";

  const hydrateForm = useCallback(
    (status) => {
      const active = status?.omp?.activeModel || status?.omp?.models?.[0] || status?.savedConfig?.activeModel || status?.savedConfig?.model || "";
      if (active) setSelectedModel(active);
      if (status?.omp?.smolModel !== undefined || status?.savedConfig?.smolModel !== undefined) {
        setSmolModel(status?.omp?.smolModel || status?.savedConfig?.smolModel || "");
      }
      if (status?.omp?.slowModel !== undefined || status?.savedConfig?.slowModel !== undefined) {
        setSlowModel(status?.omp?.slowModel || status?.savedConfig?.slowModel || "");
      }
      if (status?.omp?.planModel !== undefined || status?.savedConfig?.planModel !== undefined) {
        setPlanModel(status?.omp?.planModel || status?.savedConfig?.planModel || "");
      }
      if (status?.omp?.subagentModels || status?.savedConfig?.subagentModels) {
        setSubagentModels(status?.omp?.subagentModels || status?.savedConfig?.subagentModels || {});
      }
      if (status?.omp?.apiKey) {
        setSelectedApiKey(status.omp.apiKey);
      } else if (apiKeys?.length > 0) {
        setSelectedApiKey((prev) => prev || apiKeys[0].key);
      }
    },
    [apiKeys]
  );

  const fetchModelAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  }, []);

  const checkOmpStatus = useCallback(
    async ({ hydrate = false } = {}) => {
      setCheckingOmp(true);
      try {
        const res = await fetch(ENDPOINT);
        const status = await res.json();
        setOmpStatus(status);
        hasFetchedStatus.current = true;
        if (hydrate) hydrateForm(status);
      } catch (error) {
        setOmpStatus({ installed: false, error: error.message });
      } finally {
        setCheckingOmp(false);
      }
    },
    [hydrateForm]
  );

  useEffect(() => {
    if (isExpanded) {
      if (!hasFetchedStatus.current) checkOmpStatus({ hydrate: true });
      fetchModelAliases();
    }
  }, [isExpanded]);

  const normalizeLocalhost = (url) => url.replace("://localhost", "://127.0.0.1");

  const getLocalBaseUrl = () => {
    if (typeof window !== "undefined") {
      return normalizeLocalhost(window.location.origin);
    }
    return "http://127.0.0.1:20128";
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const debounceTimerRef = useRef(null);

  const handleApplySettings = async (overrides = {}) => {
    const currentSelectedModel = "selectedModel" in overrides ? overrides.selectedModel : selectedModel;
    const currentSmolModel = "smolModel" in overrides ? overrides.smolModel : smolModel;
    const currentSlowModel = "slowModel" in overrides ? overrides.slowModel : slowModel;
    const currentPlanModel = "planModel" in overrides ? overrides.planModel : planModel;
    const currentSubagentModels = "subagentModels" in overrides ? overrides.subagentModels : subagentModels;
    const currentApiKey = "selectedApiKey" in overrides ? overrides.selectedApiKey : selectedApiKey;
    const currentCustomBaseUrl = "customBaseUrl" in overrides ? overrides.customBaseUrl : customBaseUrl;

    const mappedSubagents = {};
    if (currentSubagentModels && typeof currentSubagentModels === "object") {
      for (const type of OMP_SUBAGENT_TYPES) {
        const m = currentSubagentModels[type.id]?.trim();
        if (m) mappedSubagents[type.id] = m;
      }
    }

    const effectivePrimaryModel = currentSelectedModel?.trim() || currentSmolModel?.trim() || currentSlowModel?.trim() || Object.values(mappedSubagents)[0] || "";

    // Collect all distinct models selected across roles & subagents
    const allModels = Array.from(
      new Set([
        effectivePrimaryModel,
        currentSmolModel?.trim(),
        currentSlowModel?.trim(),
        currentPlanModel?.trim(),
        ...Object.values(mappedSubagents),
      ].filter(Boolean))
    );

    if (allModels.length === 0) {
      return;
    }

    setApplying(true);
    setMessage(null);
    try {
      const keyToUse =
        currentApiKey?.trim() ||
        (apiKeys?.length > 0 ? apiKeys[0].key : null) ||
        (!cloudEnabled ? "sk_9router" : null) ||
        "sk_9router";

      const url = currentCustomBaseUrl || getLocalBaseUrl();
      const effectiveBaseUrl = url.endsWith("/v1") ? url : `${url}/v1`;

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: effectiveBaseUrl,
          apiKey: keyToUse,
          models: allModels,
          activeModel: effectivePrimaryModel,
          smolModel: currentSmolModel || undefined,
          slowModel: currentSlowModel || undefined,
          planModel: currentPlanModel || undefined,
          subagentModels: mappedSubagents,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings saved successfully!" });
        checkOmpStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const debouncedSave = (overrides) => {
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      handleApplySettings(overrides);
    }, 600);
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSmolModel("");
        setSlowModel("");
        setPlanModel("");
        setSubagentModels({});
        setSelectedApiKey("");
        checkOmpStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleModelSelect = (model) => {
    const val = model.value;
    let nextOverrides = {};
    if (modalTarget === "default") {
      setSelectedModel(val);
      nextOverrides = { selectedModel: val };
    } else if (modalTarget === "smol") {
      setSmolModel(val);
      nextOverrides = { smolModel: val };
    } else if (modalTarget === "slow") {
      setSlowModel(val);
      nextOverrides = { slowModel: val };
    } else if (modalTarget === "plan") {
      setPlanModel(val);
      nextOverrides = { planModel: val };
    } else if (modalTarget) {
      const nextSubs = { ...subagentModels, [modalTarget]: val };
      setSubagentModels(nextSubs);
      nextOverrides = { subagentModels: nextSubs };
    }
    setModalTarget(null);
    handleApplySettings(nextOverrides);
  };

  const getTargetTitle = () => {
    if (modalTarget === "default") return "Primary Model";
    if (modalTarget === "smol") return "Smol Model";
    if (modalTarget === "slow") return "Slow Model";
    if (modalTarget === "plan") return "Plan Model";
    const sub = OMP_SUBAGENT_TYPES.find((s) => s.id === modalTarget);
    if (sub) return `${sub.label} Subagent`;
    return "Model";
  };

  const getTargetCurrentValue = () => {
    if (modalTarget === "default") return selectedModel;
    if (modalTarget === "smol") return smolModel;
    if (modalTarget === "slow") return slowModel;
    if (modalTarget === "plan") return planModel;
    if (modalTarget) return subagentModels[modalTarget] || "";
    return "";
  };

  const getManualConfigs = () => {
    const keyToUse =
      selectedApiKey && selectedApiKey.trim()
        ? selectedApiKey
        : !cloudEnabled
        ? "sk_9router"
        : "<API_KEY_FROM_DASHBOARD>";

    const activeM = selectedModel || "claude-sonnet-4-6";
    const smolM = smolModel || "claude-haiku-4-5";
    const slowM = slowModel || "claude-opus-4-6";

    const allModelsList = Array.from(
      new Set([
        activeM,
        smolM,
        slowM,
        planModel,
        ...Object.values(subagentModels).map((m) => m?.trim()).filter(Boolean),
      ].filter(Boolean))
    );

    const modelEntries = allModelsList
      .map(
        (m) => `      - id: "${m}"
        name: "${m}"
        contextWindow: 200000
        maxTokens: 8192
        reasoning: true
        input: ["text", "image"]`
      )
      .join("\n");

    const modelsYaml = `providers:
  9router:
    baseUrl: "${getEffectiveBaseUrl()}"
    apiKey: "${keyToUse}"
    api: "openai-completions"
    models:
${modelEntries}`;

    const subagentLines = [];
    for (const type of OMP_SUBAGENT_TYPES) {
      const m = subagentModels[type.id]?.trim();
      if (m) {
        subagentLines.push(`  ${type.id}: "9router/${m}"`);
      }
    }

    const configYaml = `modelRoles:
  default: "9router/${activeM}"
  smol: "9router/${smolM}"
  slow: "9router/${slowM}"${planModel ? `\n  plan: "9router/${planModel}"` : ""}${
      subagentLines.length > 0
        ? `\n\ntask.agentModelOverrides:\n${subagentLines.join("\n")}`
        : ""
    }`;

    return [
      {
        filename: "~/.omp/agent/models.yml",
        content: modelsYaml,
      },
      {
        filename: "~/.omp/agent/config.yml",
        content: configYaml,
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div
        className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center"
        onClick={onToggle}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image
              src={tool.image || "/providers/omp.png"}
              alt={tool.name}
              width={32}
              height={32}
              className="size-8 object-contain rounded-lg"
              sizes="32px"
              onError={(e) => {
                e.target.style.display = "none";
              }}
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
                  Connected
                </span>
              )}
              {configStatus === "not_configured" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">
                  Not configured
                </span>
              )}
              {configStatus === "other" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
                  Other
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span
          className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checkingOmp && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Oh My Pi (OMP) CLI...</span>
            </div>
          )}

          {!checkingOmp && ompStatus && !ompStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">
                      Oh My Pi (OMP) CLI not detected locally
                    </p>
                    <p className="text-sm text-text-muted mt-1">
                      Install Oh My Pi to enable automatic configuration:
                    </p>
                    <code className="block mt-2 p-2 bg-black/20 rounded text-xs font-mono">
                      npm install -g @oh-my-pi/pi-coding-agent
                    </code>
                    <p className="text-sm text-text-muted mt-2">
                      Manual configuration is still available if 9router is deployed on a remote server.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <BashSetupButton
                    tool="omp"
                    baseUrl={getEffectiveBaseUrl()}
                    apiKey={selectedApiKey}
                    model={selectedModel || "claude-sonnet-4-6"}
                    smolModel={smolModel}
                    slowModel={slowModel}
                    planModel={planModel}
                    subagentModels={subagentModels}
                    className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowManualConfigModal(true)}
                    className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30"
                  >
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!checkingOmp && ompStatus && (
            <>
              <div className="flex flex-col gap-2">
                {/* Info notes */}
                {tool.notes && tool.notes.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2">
                    {tool.notes.map((note, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 p-2 rounded text-xs ${
                          note.type === "info"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            : note.type === "warning"
                            ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                            : "bg-gray-500/10 text-text-muted"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px] mt-0.5">
                          {note.type === "info" ? "info" : note.type === "warning" ? "warning" : "help"}
                        </span>
                        <span>{note.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8.5rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    Select Endpoint
                  </span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
                    arrow_forward
                  </span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={(url) => {
                      setCustomBaseUrl(url);
                      handleApplySettings({ customBaseUrl: url });
                    }}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                {/* Current configured */}
                {(ompStatus?.omp?.baseUrl || ompStatus?.settings?.provider?.baseUrl) && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8.5rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                      Current
                    </span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
                      arrow_forward
                    </span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {ompStatus.omp?.baseUrl || ompStatus.settings?.provider?.baseUrl}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8.5rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    API Key
                  </span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
                    arrow_forward
                  </span>
                  <ApiKeySelect
                    value={selectedApiKey}
                    onChange={(key) => {
                      setSelectedApiKey(key);
                      handleApplySettings({ selectedApiKey: key });
                    }}
                    apiKeys={apiKeys}
                    cloudEnabled={cloudEnabled}
                  />
                </div>

                {/* Primary (Default) Model */}
                <ModelField
                  label="Primary Model"
                  value={selectedModel}
                  placeholder="claude-sonnet-4-6"
                  onChange={(val) => {
                    setSelectedModel(val);
                    debouncedSave({ selectedModel: val });
                  }}
                  onSelect={() => setModalTarget("default")}
                  onClear={() => {
                    setSelectedModel("");
                    handleApplySettings({ selectedModel: "" });
                  }}
                  disabled={!hasActiveProviders}
                  help="Default model role used for main conversation and coding"
                />

                {/* Smol Model */}
                <ModelField
                  label="Smol Model"
                  value={smolModel}
                  placeholder={`${selectedModel || "Primary Model"} (inherit)`}
                  onChange={(val) => {
                    setSmolModel(val);
                    debouncedSave({ smolModel: val });
                  }}
                  onSelect={() => setModalTarget("smol")}
                  onClear={() => {
                    setSmolModel("");
                    handleApplySettings({ smolModel: "" });
                  }}
                  disabled={!hasActiveProviders}
                  help="Fast model for lightweight tasks, prewalk handoff, and summaries"
                />

                {/* Slow Model */}
                <ModelField
                  label="Slow Model"
                  value={slowModel}
                  placeholder={`${selectedModel || "Primary Model"} (inherit)`}
                  onChange={(val) => {
                    setSlowModel(val);
                    debouncedSave({ slowModel: val });
                  }}
                  onSelect={() => setModalTarget("slow")}
                  onClear={() => {
                    setSlowModel("");
                    handleApplySettings({ slowModel: "" });
                  }}
                  disabled={!hasActiveProviders}
                  help="Deep reasoning model for complex architectural & bug analysis"
                />

                {/* Plan Model */}
                <ModelField
                  label="Plan Model"
                  value={planModel}
                  placeholder={`${selectedModel || "Primary Model"} (inherit)`}
                  onChange={(val) => {
                    setPlanModel(val);
                    debouncedSave({ planModel: val });
                  }}
                  onSelect={() => setModalTarget("plan")}
                  onClear={() => {
                    setPlanModel("");
                    handleApplySettings({ planModel: "" });
                  }}
                  disabled={!hasActiveProviders}
                  help="Planning model for plan mode and task decomposition"
                />

                {/* Subagents Section */}
                <div className="my-1 border-t border-border pt-3">
                  <div className="mb-2 flex items-start gap-2">
                    <span className="material-symbols-outlined text-primary text-[18px]">
                      account_tree
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-text-main">
                        Subagent model overrides
                      </p>
                      <p className="text-[10px] text-text-muted">
                        Override models for specific task agents. Leave blank to inherit Primary / Smol default.
                      </p>
                    </div>
                  </div>
                </div>

                {OMP_SUBAGENT_TYPES.map((type) => (
                  <ModelField
                    key={type.id}
                    label={type.label}
                    help={type.help}
                    value={subagentModels[type.id] || ""}
                    onChange={(val) => {
                      const nextSubs = { ...subagentModels, [type.id]: val };
                      setSubagentModels(nextSubs);
                      debouncedSave({ subagentModels: nextSubs });
                    }}
                    placeholder={`${selectedModel || "Primary Model"} (inherit)`}
                    onSelect={() => setModalTarget(type.id)}
                    onClear={() => {
                      const nextSubs = { ...subagentModels, [type.id]: "" };
                      setSubagentModels(nextSubs);
                      handleApplySettings({ subagentModels: nextSubs });
                    }}
                    disabled={!hasActiveProviders}
                  />
                ))}

                {/* Usage hint */}
                <div className="flex flex-col gap-1 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">CLI Usage:</p>
                  <code className="text-xs font-mono text-text-muted">omp</code>
                  <code className="text-xs font-mono text-text-muted">
                    omp --model 9router/{selectedModel || "claude-sonnet-4-6"}
                  </code>
                  <code className="text-xs font-mono text-text-muted">
                    omp models 9router
                  </code>
                </div>
              </div>

              {message && (
                <div
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                    message.type === "success"
                      ? "bg-green-500/10 text-green-600"
                      : "bg-red-500/10 text-red-600"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {message.type === "success" ? "check_circle" : "error"}
                  </span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApplySettings}
                  disabled={!selectedModel}
                  loading={applying}
                >
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetSettings}
                  disabled={!ompStatus?.has9Router}
                  loading={restoring}
                >
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>
                  Manual Config
                </Button>
                <BashSetupButton
                  tool="omp"
                  baseUrl={getEffectiveBaseUrl()}
                  apiKey={selectedApiKey}
                  model={selectedModel || "claude-sonnet-4-6"}
                  smolModel={smolModel}
                  slowModel={slowModel}
                  planModel={planModel}
                  subagentModels={subagentModels}
                  variant="ghost"
                />
              </div>
            </>
          )}
        </div>
      )}

      {modalTarget && (
        <ModelSelectModal
          isOpen={Boolean(modalTarget)}
          onClose={() => setModalTarget(null)}
          onSelect={handleModelSelect}
          selectedModel={getTargetCurrentValue()}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={`Select ${getTargetTitle()} for Oh My Pi`}
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Oh My Pi (OMP) - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
