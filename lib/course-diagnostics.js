'use strict';

const MAX_PUBLIC_TEXT_LENGTH = 320;
const VALID_SEVERITIES = new Set(['info', 'warning', 'error']);

function sanitizePublicText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  let text = value
    .replace(/\r?\n[\s\S]*/u, '')
    .replace(/\b(token|api[_-]?key|password|secret|authorization)=[^&\s]+/giu, '$1=[redacted]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'?)]*/gu, '[private path]')
    .replace(/\\\\[^\\\s]+\\[^\s"'?)]*/gu, '[private path]')
    .replace(/\/(?:Users|home)\/[^\s"'?)]*/gu, '[private path]')
    .replace(/(^|[\s("'=])\/(?!api(?:\/|$))[^\s"'?)]*/gu, '$1[private path]')
    .replace(/\.\.[\\/][^\s"'?)]*/gu, '[private path]')
    .trim();
  if (!text) text = fallback;
  return text.slice(0, MAX_PUBLIC_TEXT_LENGTH);
}

function sanitizeIdentifier(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const sanitized = value.trim().replace(/[^A-Za-z0-9:._-]/gu, '');
  return sanitized.slice(0, 160) || fallback;
}

function createCourseDiagnostic({
  code,
  severity = 'warning',
  stage = 'course',
  courseId = null,
  message = 'Course processing could not be completed.',
  recovery = 'Retry the course activation.',
} = {}) {
  const record = {
    code: sanitizeIdentifier(code, 'COURSE_UNKNOWN'),
    severity: VALID_SEVERITIES.has(severity) ? severity : 'warning',
    stage: sanitizeIdentifier(stage, 'course'),
    courseId: courseId == null ? null : sanitizeIdentifier(courseId, null),
    message: sanitizePublicText(message, 'Course processing could not be completed.'),
    recovery: sanitizePublicText(recovery, 'Retry the course activation.'),
  };
  return Object.freeze(record);
}

function dedupeCourseDiagnostics(diagnostics = []) {
  const unique = new Map();
  for (const input of Array.isArray(diagnostics) ? diagnostics : []) {
    if (!input || typeof input !== 'object') continue;
    const diagnostic = createCourseDiagnostic(input);
    const key = `${diagnostic.code}\u0000${diagnostic.stage}\u0000${diagnostic.courseId || ''}`;
    if (!unique.has(key)) unique.set(key, diagnostic);
  }
  return Object.freeze([...unique.values()]);
}

module.exports = {
  createCourseDiagnostic,
  dedupeCourseDiagnostics,
  sanitizePublicText,
};
