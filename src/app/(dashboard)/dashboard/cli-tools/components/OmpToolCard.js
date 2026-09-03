"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import BashSetupButton from "./BashSetupButton";
import { matchKnownEndpoint } from "./cliEndpointMatch";
const ENDPOINT = "/api/cli-tools/omp-settings";

const OMP_MODEL_ROLES = [
  { id: "default", label: "Default", help: "Primary model for main chat and coding" },
  { id: "smol", label: "Smol", help: "Fast model for lightweight tasks, prewalk handoff, and summaries" },
  { id: "slow", label: "Slow", help: "Thinking model for deep reasoning & bug analysis" },
  { id: "vision", label: "Vision", help: "Multimodal image understanding and analysis" },
  { id: "plan", label: "Plan", help: "Architect model for planning and task decomposition" },
  { id: "designer", label: "Designer", help: "UI/UX design specialist" },
  { id: "commit", label: "Commit", help: "Commit message and changelog generation" },
  { id: "tiny", label: "Tiny", help: "Tiny fast model for session titles, memory & lightweight metadata" },
  { id: "task", label: "Task", help: "Subtask & general-purpose delegation" },
  { id: "advisor", label: "Advisor", help: "Passive turn-by-turn code review and advice" },
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
  const { getCaps } = useModelCaps();
  const [ompStatus, setOmpStatus] = useState(initialStatus || null);
  const [checkingOmp, setCheckingOmp] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);

  const [selectedApiKey, setSelectedApiKey] = useState(
    initialStatus?.omp?.apiKey || apiKeys?.[0]?.key || ""
  );
  const [selectedModels, setSelectedModels] = useState(
    initialStatus?.omp?.models || initialStatus?.savedConfig?.models || []
  );
  const [modelRoles, setModelRoles] = useState(
    initialStatus?.omp?.modelRoles || {
      default: initialStatus?.omp?.activeModel || initialStatus?.omp?.models?.[0] || initialStatus?.savedConfig?.activeModel || initialStatus?.savedConfig?.model || "",
      smol: initialStatus?.omp?.smolModel || "",
      slow: initialStatus?.omp?.slowModel || "",
      plan: initialStatus?.omp?.planModel || "",
      vision: initialStatus?.omp?.visionModel || "",
      designer: initialStatus?.omp?.designerModel || "",
      commit: initialStatus?.omp?.commitModel || "",
      tiny: initialStatus?.omp?.tinyModel || "",
      task: initialStatus?.omp?.taskModel || "",
      advisor: initialStatus?.omp?.advisorModel || "",
    }
  );
  const selectedModel = modelRoles.default || "";
  const smolModel = modelRoles.smol || "";
  const slowModel = modelRoles.slow || "";
  const planModel = modelRoles.plan || "";

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState(null); // role ID
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasFetchedStatus = useRef(Boolean(initialStatus));
  const hasHydratedOnce = useRef(false);
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
      const models = status?.omp?.models || status?.savedConfig?.models || [];
      if (Array.isArray(models)) {
        setSelectedModels(models);
      }
      const roles = status?.omp?.modelRoles || {};
      const active = roles.default || status?.omp?.activeModel || status?.omp?.models?.[0] || status?.savedConfig?.activeModel || status?.savedConfig?.model || "";
      setModelRoles({
        default: active,
        smol: roles.smol || status?.omp?.smolModel || status?.savedConfig?.smolModel || "",
        slow: roles.slow || status?.omp?.slowModel || status?.savedConfig?.slowModel || "",
        plan: roles.plan || status?.omp?.planModel || status?.savedConfig?.planModel || "",
        vision: roles.vision || status?.omp?.visionModel || status?.savedConfig?.visionModel || "",
        designer: roles.designer || status?.omp?.designerModel || status?.savedConfig?.designerModel || "",
        commit: roles.commit || status?.omp?.commitModel || status?.savedConfig?.commitModel || "",
        tiny: roles.tiny || status?.omp?.tinyModel || status?.savedConfig?.tinyModel || "",
        task: roles.task || status?.omp?.taskModel || status?.savedConfig?.taskModel || "",
        advisor: roles.advisor || status?.omp?.advisorModel || status?.savedConfig?.advisorModel || "",
      });
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
      if (!hasFetchedStatus.current) {
        checkOmpStatus({ hydrate: true });
      } else if (!hasHydratedOnce.current && initialStatus) {
        hasHydratedOnce.current = true;
        hydrateForm(initialStatus);
      }
      fetchModelAliases();
    }
  }, [isExpanded, checkOmpStatus, fetchModelAliases, initialStatus, hydrateForm]);
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
    const currentSelectedModels = "selectedModels" in overrides ? overrides.selectedModels : selectedModels;
    const currentModelRoles = "modelRoles" in overrides ? overrides.modelRoles : modelRoles;
    const currentApiKey = "selectedApiKey" in overrides ? overrides.selectedApiKey : selectedApiKey;
    const currentCustomBaseUrl = "customBaseUrl" in overrides ? overrides.customBaseUrl : customBaseUrl;


    const effectivePrimaryModel =
      currentModelRoles.default?.trim() ||
      currentSelectedModels?.[0] ||
      currentModelRoles.smol?.trim() ||
      currentModelRoles.slow?.trim() ||
      "";

    // Collect all distinct models selected across models array, roles & subagents
    const allModels = Array.from(
      new Set([
        ...(Array.isArray(currentSelectedModels) ? currentSelectedModels : []),
        ...Object.values(currentModelRoles).map((m) => m?.trim()).filter(Boolean),
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
          modelRoles: currentModelRoles,
          smolModel: currentModelRoles.smol || undefined,
          slowModel: currentModelRoles.slow || undefined,
          planModel: currentModelRoles.plan || undefined,
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
        setSelectedModels([]);
        setModelRoles({
          default: "", smol: "", slow: "", plan: "", vision: "",
          designer: "", commit: "", tiny: "", task: "", advisor: ""
        });
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
    if (OMP_MODEL_ROLES.some((r) => r.id === modalTarget)) {
      const nextRoles = { ...modelRoles, [modalTarget]: val };
      setModelRoles(nextRoles);
      nextOverrides = { modelRoles: nextRoles };
    }
    setModalTarget(null);
    handleApplySettings(nextOverrides);
  };

  const getTargetTitle = () => {
    const role = OMP_MODEL_ROLES.find((r) => r.id === modalTarget);
    if (role) return `${role.label} Model`;
    return "Model";
  };

  const getTargetCurrentValue = () => {
    if (OMP_MODEL_ROLES.some((r) => r.id === modalTarget)) {
      return modelRoles[modalTarget] || "";
    }
    return "";
  };

  const getManualConfigs = () => {
    const keyToUse =
      selectedApiKey && selectedApiKey.trim()
        ? selectedApiKey
        : !cloudEnabled
        ? "sk_9router"
        : "<API_KEY_FROM_DASHBOARD>";

    const activeM = modelRoles.default || selectedModels[0] || "claude-sonnet-4-6";
    const allModelsList = Array.from(
      new Set([
        ...selectedModels,
        ...Object.values(modelRoles).map((m) => m?.trim()).filter(Boolean),
      ].filter(Boolean))
    );
    const modelEntries = allModelsList
      .map((m) => {
        const caps = getCaps(m);
        const ctx = caps?.contextWindow || 200000;
        const maxOut = Math.min(caps?.maxOutput || 8192, 32768);
        const isReasoning = Boolean(caps?.reasoning);
        const inputs = caps?.vision ? '["text", "image"]' : '["text"]';
        return `      - id: "${m}"
        name: "${m}"
        contextWindow: ${ctx}
        maxTokens: ${maxOut}
        reasoning: ${isReasoning}
        input: ${inputs}`;
      })
      .join("\n");

    const modelsYaml = `providers:
  9router:
    baseUrl: "${getEffectiveBaseUrl()}"
    apiKey: "${keyToUse}"
    api: "openai-completions"
    models:
${modelEntries}`;

    const roleLines = [];
    for (const r of OMP_MODEL_ROLES) {
      const val = modelRoles[r.id]?.trim() || (r.id === "default" ? activeM : "");
      if (val) {
        roleLines.push(`  ${r.id}: "9router/${val}"`);
      }
    }

    const configYaml = `modelRoles:\n${roleLines.join("\n")}`;

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
          {checkingOmp && !ompStatus && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Oh My Pi (OMP) CLI...</span>
            </div>
          )}

          {ompStatus && !ompStatus.installed && (
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
                    model={modelRoles.default || selectedModels[0] || "claude-sonnet-4-6"}
                    models={selectedModels}
                    smolModel={modelRoles.smol}
                    slowModel={modelRoles.slow}
                    planModel={modelRoles.plan}
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

          {ompStatus && (
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
                {/* Models Section */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8.5rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-34 shrink-0 text-sm font-semibold text-text-main text-right pt-1">
                    Models
                  </span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">
                    arrow_forward
                  </span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span
                            key={model}
                            onClick={() => {
                              if (model === modelRoles.default) {
                                const nextRoles = { ...modelRoles, default: "" };
                                setModelRoles(nextRoles);
                                handleApplySettings({ modelRoles: nextRoles });
                              } else {
                                const nextRoles = { ...modelRoles, default: model };
                                setModelRoles(nextRoles);
                                handleApplySettings({ modelRoles: nextRoles });
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                              model === modelRoles.default
                                ? "bg-primary/10 text-primary border border-primary"
                                : "bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border"
                            }`}
                            title={
                              model === modelRoles.default
                                ? "Click to clear active model"
                                : "Click to set as primary active model"
                            }
                          >
                            {model === modelRoles.default && (
                              <span className="material-symbols-outlined text-[10px]">star</span>
                            )}
                            {model}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newModels = selectedModels.filter((m) => m !== model);
                                const nextActive = modelRoles.default === model ? (newModels[0] || "") : modelRoles.default;
                                setSelectedModels(newModels);
                                const nextRoles = { ...modelRoles, default: nextActive };
                                setModelRoles(nextRoles);
                                handleApplySettings({ selectedModels: newModels, modelRoles: nextRoles });
                              }}
                              className="ml-0.5 hover:text-red-500"
                            >
                              <span className="material-symbols-outlined text-[12px]">close</span>
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8.5rem_auto_1fr_auto] sm:items-center sm:gap-2">
                      <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        disabled={!hasActiveProviders}
                        className={`px-2 py-1 rounded border text-xs transition-colors ${
                          hasActiveProviders
                            ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
                            : "opacity-50 cursor-not-allowed border-border"
                        }`}
                      >
                        Add Model
                      </button>
                      <span className="text-xs text-text-muted">
                        {selectedModels.length > 0 && modelRoles.default ? (
                          <>
                            Active: <span className="text-primary">{modelRoles.default}</span>
                          </>
                        ) : selectedModels.length > 0 ? (
                          <span className="text-yellow-500">Click a model to set/clear active</span>
                        ) : (
                          "Select models to add"
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 10 OMP Model Roles */}
                {OMP_MODEL_ROLES.map((role) => (
                  <ModelField
                    key={role.id}
                    label={`${role.label} Model`}
                    value={modelRoles[role.id] || ""}
                    placeholder={
                      role.id === "default"
                        ? selectedModels[0] || "claude-sonnet-4-6"
                        : `${modelRoles.default || "Primary Model"} (inherit)`
                    }
                    onChange={(val) => {
                      const nextRoles = { ...modelRoles, [role.id]: val };
                      setModelRoles(nextRoles);
                      debouncedSave({ modelRoles: nextRoles });
                    }}
                    onSelect={() => setModalTarget(role.id)}
                    onClear={() => {
                      const nextRoles = { ...modelRoles, [role.id]: "" };
                      setModelRoles(nextRoles);
                      handleApplySettings({ modelRoles: nextRoles });
                    }}
                    disabled={!hasActiveProviders}
                    help={role.help}
                  />
                ))}

                {/* Usage hint */}
                <div className="flex flex-col gap-1 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">CLI Usage:</p>
                  <code className="text-xs font-mono text-text-muted">omp</code>
                  <code className="text-xs font-mono text-text-muted">
                    omp --model 9router/${modelRoles.default || selectedModels[0] || "claude-sonnet-4-6"}
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
                  disabled={!modelRoles.default && selectedModels.length === 0}
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
                  model={modelRoles.default || selectedModels[0] || "claude-sonnet-4-6"}
                  models={selectedModels}
                  smolModel={modelRoles.smol}
                  slowModel={modelRoles.slow}
                  planModel={modelRoles.plan}
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

      {modalOpen && (
        <ModelSelectModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelect={(model) => {
            if (!selectedModels.includes(model.value)) {
              const next = [...selectedModels, model.value];
              const nextActive = modelRoles.default || model.value;
              setSelectedModels(next);
              const nextRoles = { ...modelRoles, default: nextActive };
              setModelRoles(nextRoles);
              handleApplySettings({ selectedModels: next, modelRoles: nextRoles });
            }
          }}
          onDeselect={(model) => {
            const remaining = selectedModels.filter((m) => m !== model.value);
            const nextActive = modelRoles.default === model.value ? (remaining[0] || "") : modelRoles.default;
            setSelectedModels(remaining);
            const nextRoles = { ...modelRoles, default: nextActive };
            setModelRoles(nextRoles);
            handleApplySettings({ selectedModels: remaining, modelRoles: nextRoles });
          }}
          selectedModel={null}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          addedModelValues={selectedModels}
          closeOnSelect={false}
          title="Add Model for Oh My Pi"
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
