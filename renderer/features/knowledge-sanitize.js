// ══ KNOWLEDGE HUB — ARTICLE HTML SANITIZER ═════════════════════════════════
// Wraps vendored DOMPurify with a fixed allowlist matching the vocabulary of
// the rich editor that older notes were written with (Notes are plain text
// since Phase 2). Used before rendering stored HTML and before converting it to
// plain text, so it must stay independent of any single call site's trust level.
const KNOWLEDGE_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'span'],
  ALLOWED_ATTR: ['href', 'class', 'target', 'rel', 'spellcheck'],
  ALLOW_DATA_ATTR: false,
};
function sanitizeKnowledgeHtml(html) {
  return window.DOMPurify.sanitize(String(html || ''), KNOWLEDGE_SANITIZE_CONFIG);
}
