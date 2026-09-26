/**
 * Resolves the callback URL OAuth providers must redirect back to.
 *
 * The dashboard is often hosted behind a reverse proxy on a public domain, while
 * BASE_URL still points at the loopback address used by the local CLI. A
 * hardcoded (or loopback-derived) redirect therefore sends the authorization
 * code to the user's own machine instead of the hosted dashboard.
 *
 * Priority:
 *   1. explicit `redirect_uri` — clients that need a fixed loopback port (codex/xai)
 *   2. OAUTH_REDIRECT_URI — runtime override for hosted / HTTPS deployments
 *   3. BASE_URL / NEXT_PUBLIC_BASE_URL — same convention as the OIDC and SAML flows
 *   4. origin derived from the request (x-forwarded-proto/host, then Host)
 *   5. http://localhost:8080/callback (legacy default)
 */

const CALLBACK_PATH = "/callback";
const LEGACY_FALLBACK = `http://localhost:8080${CALLBACK_PATH}`;

function trimTrailingSlashes(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

/**
 * Normalizes a configured base URL into a callback URL.
 * A bare origin (or trailing "/") gets `/callback` appended; an explicit path is
 * kept as-is so custom callback routes can be configured.
 * @param {string} value
 * @returns {string} callback URL, or "" when the value is unusable
 */
export function toCallbackUrl(value) {
  const base = trimTrailingSlashes(value);
  if (!base) return "";
  try {
    const url = new URL(base);
    if (url.pathname === "" || url.pathname === "/") url.pathname = CALLBACK_PATH;
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * @param {Request} request - incoming authorize request (may be undefined for CLI callers)
 * @param {string|null} explicitRedirectUri - `redirect_uri` query param, when the client sends one
 * @returns {string} absolute callback URL
 */
export function resolveOAuthRedirectUri(request, explicitRedirectUri) {
  const explicit = trimTrailingSlashes(explicitRedirectUri);
  if (explicit) return explicit;

  const override = toCallbackUrl(process.env.OAUTH_REDIRECT_URI);
  if (override) return override;

  const configured = toCallbackUrl(process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL);
  if (configured) return configured;

  const host = request?.headers?.get?.("x-forwarded-host") || request?.headers?.get?.("host") || "";
  if (host) {
    const protocol = (request?.headers?.get?.("x-forwarded-proto") || new URL(request.url).protocol || "http:")
      .replace(/:$/, "");
    return `${protocol}://${host}${CALLBACK_PATH}`;
  }

  return LEGACY_FALLBACK;
}
