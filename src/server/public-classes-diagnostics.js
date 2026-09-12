export function reportPublicClassesFailure(event) {
  console.error("public_classes_read_failed", event);
}

const TABLES = new Set(["classes", "textbooks", "progress_logs"]);

function queryTable(input, init) {
  try {
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    if (method !== "GET") return null;
    const url = new URL(input instanceof Request ? input.url : input);
    const table = url.pathname.startsWith("/rest/v1/") ? url.pathname.slice(9) : null;
    return TABLES.has(table) ? table : null;
  } catch {
    return null;
  }
}

// Read only a bounded error response copy. Never retain messages, details,
// hints, request URLs/headers, or successful data. Diagnostics must not wait
// indefinitely for a malformed/stalled upstream body or consume the SDK body.
async function responseCode(response) {
  if (!response.headers.get("content-type")?.includes("application/json")) return null;
  if (Number(response.headers.get("content-length")) > 8_192) return null;
  const reader = response.clone().body?.getReader();
  if (!reader) return null;
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder();
        let text = "";
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8_192) return null;
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        const code = JSON.parse(text)?.code;
        return typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code) ? code : null;
      })(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 50); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    // A tee branch's cancellation may wait for the SDK's branch to finish.
    void reader.cancel().catch(() => {});
  }
}

export function createPublicClassesDiagnosticFetch(fetchImpl, onFailure = reportPublicClassesFailure) {
  function report(fields, started) {
    try {
      const event = { event: "public_classes_read_failed", ...fields, durationMs: Math.max(0, Math.round(performance.now() - started)) };
      Promise.resolve(onFailure(event)).catch(() => {});
    } catch {
      // A logging sink must never change the data or fallback result.
    }
  }
  return {
    unconfigured() {
      report({ phase: "config", table: null, status: null, code: null, kind: "unconfigured" }, performance.now());
    },
    async fetch(input, init) {
      const table = queryTable(input, init);
      if (!table) return fetchImpl(input, init);
      const started = performance.now();
      let response;
      try {
        response = await fetchImpl(input, init);
      } catch (error) {
        const kind = error?.name === "TimeoutError" ? "timeout" : error?.name === "AbortError" ? "aborted" : "network";
        report({ phase: "query", table, status: null, code: null, kind }, started);
        throw error;
      }
      if (!response.ok) {
        report({ phase: "query", table, status: response.status, code: await responseCode(response), kind: "upstream" }, started);
      }
      return response;
    },
  };
}
