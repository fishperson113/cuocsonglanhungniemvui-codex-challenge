import { api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import log from "encore.dev/log";

const n8nWebhookUrl = secret("N8nWebhookUrl");

// ── Circuit breaker & timeout config ──────────────────────────────────────────

/** Max consecutive failures before circuit opens. */
const FAILURE_THRESHOLD = 5;

/** How long the circuit stays open before allowing a probe request. */
const RESET_TIMEOUT_MS = 30_000; // 30 s

/** Per-request timeout for the n8n fetch call. */
const REQUEST_TIMEOUT_MS = 15_000; // 15 s

// In-memory circuit-breaker state.
let failures = 0;
let openedAt = 0;

function isCircuitOpen(): boolean {
  if (openedAt === 0) return false;
  // After RESET_TIMEOUT_MS transition to half-open (let one request through).
  if (Date.now() - openedAt >= RESET_TIMEOUT_MS) {
    openedAt = 0;
    failures = 0;
    return false;
  }
  return true;
}

function onError() {
  failures++;
  if (failures >= FAILURE_THRESHOLD) {
    openedAt = Date.now();
    log.warn("n8n circuit breaker opened — rejecting requests", { failures });
  }
}

function onSuccess() {
  if (openedAt !== 0 || failures > 0) {
    failures = 0;
    openedAt = 0;
    log.info("n8n circuit breaker closed");
  }
}

// ── API ────────────────────────────────────────────────────────────────────────

export interface AIRequest {
  message: string;
}

export interface AIResponse {
  reply: unknown;
}

export const send = api<AIRequest, AIResponse>(
  { method: "POST" },
  async ({ message }) => {
    if (isCircuitOpen()) {
      throw new Error("n8n temporarily unavailable — too many recent failures");
    }

    const url = n8nWebhookUrl();
    log.info("forwarding to n8n ai engine", { url });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.status >= 400) {
        const body = await resp.text();
        log.error("n8n error", { status: resp.status, body });
        onError();
        throw new Error(`n8n error: ${resp.status}: ${body}`);
      }

      onSuccess();
      const reply = await resp.json();
      return { reply };
    } catch (err) {
      clearTimeout(timeout);

      if ((err as Error).name === "AbortError") {
        log.error("n8n request timed out", { timeout_ms: REQUEST_TIMEOUT_MS });
        onError();
        throw new Error("n8n request timed out");
      }

      // Already-logged n8n application errors just propagate.
      if (String(err).includes("n8n error:")) throw err;

      // Network-level failures.
      log.error("n8n request failed", { error: String(err) });
      onError();
      throw err;
    }
  },
);
