import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { cpp } from '@codemirror/lang-cpp';
import { StreamLanguage } from '@codemirror/language';

// Custom shell language support using StreamLanguage
const shellLanguage = StreamLanguage.define({
  name: 'shell',
  startState: () => ({}),
  token: (stream) => {
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.match(/^"[^$"]*"/)) return 'string';
    if (stream.match(/^'[^']*'/)) return 'string';
    if (stream.match(/^\$\{[^}]+\}/)) return 'variableName';
    if (stream.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/)) return 'variableName';
    if (stream.match(/^(if|then|else|elif|fi|for|do|done|while|case|esac|in|function|return|exit|echo|export|source|alias|unalias|cd|pwd|ls|grep|sed|awk|cat|printf|read|eval|local|declare|typeset|readonly|unset|shift|exec)\b/)) return 'keyword';
    if (stream.match(/^(true|false)\b/)) return 'atom';
    if (stream.match(/^\d+/)) return 'number';
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) return 'variable-2';
    if (stream.match(/^[^"'#\s$`{|]+/)) return 'operator';
    stream.next();
    return null;
  }
});

// Language mapping for common aliases - returns Language objects (not LanguageSupport)
const languageMap = {
  // JavaScript
  javascript: () => javascript().language,
  js: () => javascript().language,
  jsx: () => javascript({ jsx: true }).language,

  // TypeScript
  typescript: () => javascript({ typescript: true }).language,
  ts: () => javascript({ typescript: true }).language,
  tsx: () => javascript({ typescript: true, jsx: true }).language,

  // Python
  python: () => python().language,
  py: () => python().language,

  // CSS
  css: () => css().language,

  // HTML
  html: () => html().language,
  htm: () => html().language,

  // JSON
  json: () => json().language,

  // Swift (using C++ as fallback - similar C-family syntax)
  swift: () => cpp().language,

  // Shell/Bash
  shell: () => shellLanguage,
  bash: () => shellLanguage,
  sh: () => shellLanguage,
  zsh: () => shellLanguage
};

/**
 * Resolves a code block info string to a CodeMirror Language object.
 * @param {string} info - The info string from a fenced code block (e.g., "javascript", "py")
 * @returns {Language|null} Language object or null if not found
 */
export function resolveCodeLanguage(info) {
  if (!info) {
    return null;
  }

  // Normalize: lowercase and strip whitespace
  const normalized = info.toLowerCase().trim();

  // Direct match
  const factory = languageMap[normalized];
  if (factory) {
    return factory();
  }

  return null;
}
