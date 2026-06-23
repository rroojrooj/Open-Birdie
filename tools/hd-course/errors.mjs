// Strict, stage-coded errors for the HD course compiler.
//
// Every compiler failure throws an HdCompileError carrying a named pipeline
// `stage` and a machine-readable `code`, so the orchestrator can report exactly
// where and why a build stopped. Provider query tokens must never reach a log:
// redactUrl/sanitizeContext scrub them from both the message and the context.

const SECRET_QUERY_KEYS = new Set([
  'token', 'sig', 'signature', 'api_key', 'apikey', 'credential', 'credentials',
  'sas', 'password', 'access_token',
]);

const SECRET_CONTEXT_KEYS = new Set([
  'token', 'sig', 'signature', 'api_key', 'apikey', 'credential', 'credentials',
  'sas', 'password', 'authorization', 'access_token', 'secret',
]);

const EMBEDDED_SECRET = /\b(token|sig|signature|api_key|apikey|credential|credentials|sas|password|access_token)=[^&\s]+/gi;

// Mask sensitive query-string values while preserving everything else. Exact key
// match (case-insensitive) so `design=ok` is left alone even though it contains
// "sig". Never throws — an unparseable string is scrubbed by regex instead.
export function redactUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const u = new URL(value);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        u.searchParams.set(key, 'REDACTED');
        changed = true;
      }
    }
    return changed ? u.href : value;
  } catch {
    return value.replace(EMBEDDED_SECRET, '$1=REDACTED');
  }
}

// Shallow-scrub a context object: redact secret-named keys outright and strip
// tokens out of any string value (URL or free text).
export function sanitizeContext(context = {}) {
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_CONTEXT_KEYS.has(key.toLowerCase())) {
      out[key] = 'REDACTED';
    } else if (typeof value === 'string') {
      out[key] = redactUrl(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export class HdCompileError extends Error {
  constructor(stage, code, context = {}, cause) {
    const tail = cause && cause.message ? `: ${cause.message}` : '';
    super(`${stage}: ${code}${tail}`, cause ? { cause } : undefined);
    this.name = 'HdCompileError';
    this.stage = stage;
    this.code = code;
    this.context = sanitizeContext(context);
  }
}
