// ══ KNOWLEDGE HUB — ARTICLE HTML SANITIZER ═════════════════════════════════
// Wraps vendored DOMPurify with a fixed allowlist matching the Knowledge Hub
// Quill toolbar's vocabulary. Used before persisting editor output and again
// before rendering stored HTML, so it must stay independent of any single
// call site's trust level.
const KNOWLEDGE_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'span'],
  ALLOWED_ATTR: ['href', 'class', 'target', 'rel', 'spellcheck'],
  ALLOW_DATA_ATTR: false,
};
function sanitizeKnowledgeHtml(html) {
  return window.DOMPurify.sanitize(String(html || ''), KNOWLEDGE_SANITIZE_CONFIG);
}
