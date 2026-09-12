/**
 * Bulk enable/disable for provider connections.
 *
 * Callers used to fire `Promise.allSettled` and ignore the outcome: a failed PUT
 * (expired session, network blip, 5xx) left rows disabled on the server while the
 * UI showed them enabled. This reports what actually succeeded so the caller can
 * re-read state from the server and tell the user about the failed rows.
 *
 * @param {Array<{id: string}>} connections - connections to flip
 * @param {boolean} isActive - target state
 * @returns {Promise<{ total: number, updated: number, failed: number }>}
 */
export async function setConnectionsActive(connections, isActive) {
  const results = await Promise.all(
    connections.map(async (connection) => {
      try {
        const res = await fetch(`/api/providers/${connection.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        });
        return res.ok;
      } catch {
        return false;
      }
    }),
  );

  const failed = results.filter((ok) => !ok).length;
  return { total: results.length, updated: results.length - failed, failed };
}
