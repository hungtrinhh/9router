#!/usr/bin/env bash

set -euo pipefail

PROGRAM_NAME="${0##*/}"
TOOL=""
BASE_URL="${NINEROUTER_URL:-}"
API_KEY="${NINEROUTER_KEY:-}"
MODEL="${NINEROUTER_MODEL:-}"
SMOL_MODEL="${NINEROUTER_SMOL_MODEL:-}"
SLOW_MODEL="${NINEROUTER_SLOW_MODEL:-}"
PLAN_MODEL="${NINEROUTER_PLAN_MODEL:-}"
SUBAGENTS="${NINEROUTER_SUBAGENTS:-}"
MODELS_LIST="${NINEROUTER_MODELS:-}"
ALLOW_HTTP=0
SKIP_CHECK=0
NO_PROMPT=0
usage() {
  cat <<EOF
Configure a local AI CLI to use a remote 9Router server.

Usage:
  $PROGRAM_NAME --tool <claude|codex|opencode|omp> --url <url> --model <model> [options]

Options:
  --tool <name>       CLI tool to configure
  --url <url>         Public 9Router URL, with or without /v1
  --api-key <key>     9Router API key (hidden prompt when omitted)
  --model <model>     9Router model or combo ID (prompted when omitted)
  --allow-http        Allow plain HTTP for a non-local server
  --skip-check        Do not validate the key/model against /v1/models
  --no-prompt         Never prompt; missing required values fail instead
  -h, --help          Show this help

Environment alternatives:
  NINEROUTER_URL, NINEROUTER_KEY, NINEROUTER_MODEL
  NINEROUTER_HOME (optional config-home override, primarily for automation)

Examples:
  $PROGRAM_NAME --tool claude --url https://router.example.com --model combo/auto
  NINEROUTER_KEY=sk_... $PROGRAM_NAME --tool opencode \\
    --url https://router.example.com/v1 --model kr/claude-sonnet-4.5
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

need_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tool)
      need_value "$@"
      TOOL="$2"
      shift 2
      ;;
    --url)
      need_value "$@"
      BASE_URL="$2"
      shift 2
      ;;
    --api-key)
      need_value "$@"
      API_KEY="$2"
      shift 2
      ;;
    --model)
      need_value "$@"
      MODEL="$2"
      shift 2
      ;;
    --smol-model)
      need_value "$@"
      SMOL_MODEL="$2"
      shift 2
      ;;
    --slow-model)
      need_value "$@"
      SLOW_MODEL="$2"
      shift 2
      ;;
    --plan-model)
      need_value "$@"
      PLAN_MODEL="$2"
      shift 2
      ;;
    --subagents)
      need_value "$@"
      SUBAGENTS="$2"
      shift 2
      ;;
    --models)
      need_value "$@"
      MODELS_LIST="$2"
      shift 2
      ;;
    --allow-http)
      ALLOW_HTTP=1
      shift
      ;;
    --skip-check)
      SKIP_CHECK=1
      shift
      ;;
    --no-prompt)
      NO_PROMPT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

case "$TOOL" in
  claude|codex|opencode|omp) ;;
  "") die "--tool is required" ;;
  *) die "unsupported tool '$TOOL' (use claude, codex, opencode, or omp)" ;;
esac

[ -n "$BASE_URL" ] || die "--url or NINEROUTER_URL is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required to preserve existing CLI settings"

BASE_URL="${BASE_URL%/}"
case "$BASE_URL" in
  */v1) API_URL="$BASE_URL" ;;
  *) API_URL="$BASE_URL/v1" ;;
esac

case "$API_URL" in
  https://*) ;;
  http://localhost:*|http://localhost/*|http://127.0.0.1:*|http://127.0.0.1/*|http://\[::1\]:*|http://\[::1\]/*) ;;
  http://*) [ "$ALLOW_HTTP" -eq 1 ] || die "remote URL must use HTTPS (or pass --allow-http for a trusted network)" ;;
  *) die "--url must start with http:// or https://" ;;
esac

if [ -z "$API_KEY" ]; then
  if [ "$NO_PROMPT" -eq 1 ]; then
    die "API key is required; set NINEROUTER_KEY when running non-interactively"
  fi
  [ -t 0 ] || die "API key is required; set NINEROUTER_KEY when running non-interactively"
  printf '9Router API key: ' >&2
  IFS= read -r -s API_KEY
  printf '\n' >&2
fi
[ -n "$API_KEY" ] || die "API key cannot be empty"

if [ -z "$MODEL" ] && [ "$NO_PROMPT" -eq 0 ]; then
  [ -t 0 ] || die "model is required; set NINEROUTER_MODEL when running non-interactively"
  printf '9Router model or combo ID: ' >&2
  IFS= read -r MODEL
fi

# Mirror the dashboard Apply behavior: when no model is configured, write the
# connection without model fields instead of prompting for one.
if [ "$SKIP_CHECK" -eq 0 ] && [ -n "$MODEL" ]; then
  command -v curl >/dev/null 2>&1 || die "curl is required to validate the remote server"
  RESPONSE_FILE="$(mktemp "${TMPDIR:-/tmp}/9router-models.XXXXXX")"
  trap 'rm -f "$RESPONSE_FILE"' EXIT
  HTTP_STATUS="$(printf 'Authorization: Bearer %s\n' "$API_KEY" | \
    curl --silent --show-error --location \
      --output "$RESPONSE_FILE" --write-out '%{http_code}' \
      --header @- "$API_URL/models")" || die "could not connect to $API_URL"
  [ "$HTTP_STATUS" = "200" ] || die "server returned HTTP $HTTP_STATUS for $API_URL/models"
  python3 - "$RESPONSE_FILE" "$MODEL" <<'PY'
import json
import sys

path, requested = sys.argv[1:]
try:
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"Error: /v1/models returned invalid JSON: {error}")

models = {item.get("id") for item in payload.get("data", []) if isinstance(item, dict)}
if requested not in models:
    raise SystemExit(f"Error: model '{requested}' was not returned by /v1/models")
PY
fi

export NINEROUTER_CONNECT_URL="$API_URL"
export NINEROUTER_CONNECT_KEY="$API_KEY"
export NINEROUTER_CONNECT_MODEL="$MODEL"
export NINEROUTER_CONNECT_SMOL_MODEL="$SMOL_MODEL"
export NINEROUTER_CONNECT_SLOW_MODEL="$SLOW_MODEL"
export NINEROUTER_CONNECT_PLAN_MODEL="$PLAN_MODEL"
export NINEROUTER_CONNECT_SUBAGENTS="$SUBAGENTS"
export NINEROUTER_CONNECT_MODELS="$MODELS_LIST"
export NINEROUTER_CONNECT_HOME="${NINEROUTER_HOME:-$HOME}"
python3 - "$TOOL" <<'PY'
import json
import os
import re
import shutil
import stat
import sys
from datetime import datetime
from pathlib import Path

tool = sys.argv[1]
base_url = os.environ["NINEROUTER_CONNECT_URL"]
api_key = os.environ["NINEROUTER_CONNECT_KEY"]
model = os.environ["NINEROUTER_CONNECT_MODEL"]
home = Path(os.environ["NINEROUTER_CONNECT_HOME"]).expanduser()
stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def backup(path):
    if not path.exists():
        return None
    destination = path.with_name(f"{path.name}.9router-backup-{stamp}")
    shutil.copy2(path, destination)
    destination.chmod(stat.S_IRUSR | stat.S_IWUSR)
    return destination


def load_json(path):
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"Error: cannot safely update invalid JSON in {path}: {error}")
    if not isinstance(value, dict):
        raise SystemExit(f"Error: expected a JSON object in {path}")
    return value


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)


backups = []
if tool == "claude":
    path = home / ".claude" / "settings.json"
    config = load_json(path)
    saved = backup(path)
    if saved:
        backups.append(saved)
    env = config.setdefault("env", {})
    if not isinstance(env, dict):
        raise SystemExit(f"Error: expected 'env' to be an object in {path}")
    env.update({
        "ANTHROPIC_BASE_URL": base_url,
        "ANTHROPIC_AUTH_TOKEN": api_key,
        "API_TIMEOUT_MS": "600000",
    })
    if model:
        env.update({
            "ANTHROPIC_DEFAULT_OPUS_MODEL": model,
            "ANTHROPIC_DEFAULT_SONNET_MODEL": model,
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": model,
        })
    config["hasCompletedOnboarding"] = True
    write_json(path, config)

elif tool == "opencode":
    path = home / ".config" / "opencode" / "opencode.json"
    config = load_json(path)
    saved = backup(path)
    if saved:
        backups.append(saved)
    providers = config.setdefault("provider", {})
    if not isinstance(providers, dict):
        raise SystemExit(f"Error: expected 'provider' to be an object in {path}")
    provider = providers.setdefault("9router", {})
    provider.setdefault("npm", "@ai-sdk/openai-compatible")
    provider["options"] = {**provider.get("options", {}), "baseURL": base_url, "apiKey": api_key}
    if model:
        models = provider.setdefault("models", {})
        models[model] = {
            "name": model,
            "modalities": {"input": ["text", "image"], "output": ["text"]},
        }
        config["model"] = f"9router/{model}"
    write_json(path, config)

elif tool == "omp":
    directory = home / ".omp" / "agent"
    directory.mkdir(parents=True, exist_ok=True)
    models_path = directory / "models.yml"
    config_path = directory / "config.yml"
    for p in (models_path, config_path):
        saved = backup(p)
        if saved:
            backups.append(saved)

    default_model = model.strip() if model and model.strip() else "claude-sonnet-4-6"
    smol_model = os.environ.get("NINEROUTER_CONNECT_SMOL_MODEL", "").strip()
    slow_model = os.environ.get("NINEROUTER_CONNECT_SLOW_MODEL", "").strip()
    plan_model = os.environ.get("NINEROUTER_CONNECT_PLAN_MODEL", "").strip()
    subagents_raw = os.environ.get("NINEROUTER_CONNECT_SUBAGENTS", "").strip()
    models_raw = os.environ.get("NINEROUTER_CONNECT_MODELS", "").strip()

    subagents = {}
    if subagents_raw:
        try:
            subagents = json.loads(subagents_raw)
            if not isinstance(subagents, dict):
                subagents = {}
        except Exception:
            subagents = {}

    all_models = [default_model]
    if smol_model:
        all_models.append(smol_model)
    if slow_model:
        all_models.append(slow_model)
    if plan_model:
        all_models.append(plan_model)
    for v in subagents.values():
        if isinstance(v, str) and v.strip():
            clean_v = v.strip().replace("9router/", "")
            if clean_v:
                all_models.append(clean_v)
    if models_raw:
        for m in models_raw.split(","):
            if m.strip():
                all_models.append(m.strip())

    # Include catalog models if available
    try:
        import urllib.request
        req = urllib.request.Request(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for item in data.get("data", []):
                mid = item.get("id")
                if mid and mid not in all_models:
                    all_models.append(mid)
    except Exception:
        pass

    # Deduplicate preserving order
    seen = set()
    unique_models = []
    for m in all_models:
        if m not in seen:
            seen.add(m)
            unique_models.append(m)

    escaped_url = base_url.replace("\\", "\\\\").replace('"', '\\"')
    escaped_key = api_key.replace("\\", "\\\\").replace('"', '\\"')

    model_entries = []
    for mid in unique_models:
        esc_mid = mid.replace("\\", "\\\\").replace('"', '\\"')
        model_entries.append(
            f'      - id: "{esc_mid}"\n'
            f'        name: "{esc_mid}"\n'
            f'        contextWindow: 200000\n'
            f'        maxTokens: 8192\n'
            f'        reasoning: true\n'
            f'        input:\n'
            f'          - "text"\n'
            f'          - "image"'
        )
    models_entries_str = "\n".join(model_entries)

    nine_router_block = (
        "  9router:\n"
        f'    baseUrl: "{escaped_url}"\n'
        f'    apiKey: "{escaped_key}"\n'
        '    api: "openai-completions"\n'
        "    models:\n"
        f"{models_entries_str}\n"
    )

    esc_default = default_model.replace("\\", "\\\\").replace('"', '\\"')
    esc_smol = smol_model.replace("\\", "\\\\").replace('"', '\\"') if smol_model else esc_default
    esc_slow = slow_model.replace("\\", "\\\\").replace('"', '\\"') if slow_model else esc_default
    esc_plan = plan_model.replace("\\", "\\\\").replace('"', '\\"') if plan_model else ""

    role_lines = [
        "modelRoles:",
        f'  default: "9router/{esc_default}"',
        f'  smol: "9router/{esc_smol}"',
        f'  slow: "9router/{esc_slow}"',
    ]
    if esc_plan:
        role_lines.append(f'  plan: "9router/{esc_plan}"')
    roles_block = "\n".join(role_lines)

    subagent_lines = []
    for agent_name, agent_val in subagents.items():
        if isinstance(agent_val, str) and agent_val.strip():
            clean_val = agent_val.strip().replace("9router/", "")
            esc_val = clean_val.replace("\\", "\\\\").replace('"', '\\"')
            subagent_lines.append(f'  {agent_name}: "9router/{esc_val}"')

    subagents_block = ""
    if subagent_lines:
        subagents_block = "task.agentModelOverrides:\n" + "\n".join(subagent_lines)

    models_content = models_path.read_text(encoding="utf-8") if models_path.exists() else ""
    trimmed_models = models_content.strip()
    if not trimmed_models or trimmed_models in ("{}", "null", "providers: {}", "providers:"):
        new_models_content = f"providers:\n{nine_router_block}\n"
    else:
        cleaned_models = re.sub(r"(?m)^\s*\{\}\s*$", "", models_content)
        cleaned_models = re.sub(
            r"(?ms)^\s\s9router:\s*.*?(?=^\s\s[a-zA-Z0-9_-]+:|^[a-zA-Z0-9_-]+:|\Z)",
            "",
            cleaned_models,
        )
        if re.search(r"(?m)^providers:\s*$", cleaned_models):
            new_models_content = re.sub(
                r"(?m)^providers:\s*$",
                f"providers:\n{nine_router_block}".rstrip(),
                cleaned_models,
                count=1,
            ).strip() + "\n"
        else:
            new_models_content = f"providers:\n{nine_router_block}\n"

    config_content = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    trimmed_cfg = config_content.strip()
    if not trimmed_cfg or trimmed_cfg in ("{}", "null"):
        parts = [roles_block]
        if subagents_block:
            parts.append(subagents_block)
        new_config_content = "\n\n".join(parts) + "\n"
    else:
        cleaned_cfg = re.sub(r"(?m)^\s*\{\}\s*$", "", config_content)
        cleaned_cfg = re.sub(r"(?ms)^modelRoles:\s*.*?(?=^[a-zA-Z0-9_.-]+:|\Z)", "", cleaned_cfg).strip()
        if subagents_block:
            cleaned_cfg = re.sub(r"(?ms)^task\.agentModelOverrides:\s*.*?(?=^[a-zA-Z0-9_.-]+:|\Z)", "", cleaned_cfg).strip()
        parts = [roles_block]
        if subagents_block:
            parts.append(subagents_block)
        if cleaned_cfg:
            parts.append(cleaned_cfg)
        new_config_content = "\n\n".join(parts) + "\n"
    models_path.write_text(new_models_content.rstrip() + "\n", encoding="utf-8")
    models_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    config_path.write_text(new_config_content.rstrip() + "\n", encoding="utf-8")
    config_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    path = models_path
else:
    directory = home / ".codex"
    config_path = directory / "config.toml"
    auth_path = directory / "auth.json"
    directory.mkdir(parents=True, exist_ok=True)
    for path in (config_path, auth_path):
        saved = backup(path)
        if saved:
            backups.append(saved)

    content = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    lines = content.splitlines()
    output = []
    section = None
    skip_section = False
    for line in lines:
        match = re.match(r"^\s*\[([^]]+)\]\s*(?:#.*)?$", line)
        if match:
            section = match.group(1).strip()
            skip_section = section in {"model_providers.9router", "agents.subagent"}
            if skip_section:
                continue
        if skip_section:
            continue
        if section is None and re.match(r'^\s*(model|model_provider)\s*=', line):
            continue
        output.append(line)

    escaped_model = model.replace("\\", "\\\\").replace('"', '\\"')
    escaped_url = base_url.replace("\\", "\\\\").replace('"', '\\"')
    top = [f'model = "{escaped_model}"', 'model_provider = "9router"', ""] if model else []
    block = [
        "[model_providers.9router]",
        'name = "9Router"',
        f'base_url = "{escaped_url}"',
        'wire_api = "responses"',
    ]
    if model:
        block += ["", "[agents.subagent]", f'model = "{escaped_model}"']
    config_path.write_text("\n".join(top + output).rstrip() + "\n\n" + "\n".join(block) + "\n", encoding="utf-8")
    config_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    auth = load_json(auth_path)
    auth.update({"OPENAI_API_KEY": api_key, "auth_mode": "apikey"})
    write_json(auth_path, auth)
    path = config_path

print(f"Configured {tool}: {path}")
for saved in backups:
    print(f"Backup: {saved}")
PY

printf 'Remote endpoint: %s\n' "$API_URL"
if [ -n "$MODEL" ]; then
  printf 'Model: %s\n' "$MODEL"
fi
