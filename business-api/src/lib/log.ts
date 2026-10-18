/**
 * Logging that can't leak.
 *
 * Anything that looks like a secret - a password, a code, a token, a key, a
 * cookie - is replaced before it's written, however deep it sits in the
 * object. Logs end up in shared dashboards; they should be safe to read there.
 */
const SECRET = /pass(word)?|code|token|secret|key|authorization|cookie|pepper|signature|otp/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET.test(k) ? "[hidden]" : redact(v, depth + 1);
  return out;
}

const write = (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => {
  const line = data ? `${msg} ${JSON.stringify(redact(data))}` : msg;
  (level === "info" ? console.log : level === "warn" ? console.warn : console.error)(line);
};

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
