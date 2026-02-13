import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { cpp } from '@codemirror/lang-cpp';
import { StreamLanguage } from '@codemirror/language';

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
    if (stream.match(/^(true|false)\b/)) return 'bool';
    if (stream.match(/^\d+/)) return 'number';
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) return 'variableName';
    if (stream.match(/^[^"'#\s$`{|]+/)) return 'operator';
    stream.next();
    return null;
  }
});

const languageMap = {
  javascript: () => javascript().language,
  js: () => javascript().language,
  jsx: () => javascript({ jsx: true }).language,
  typescript: () => javascript({ typescript: true }).language,
  ts: () => javascript({ typescript: true }).language,
  tsx: () => javascript({ typescript: true, jsx: true }).language,
  python: () => python().language,
  py: () => python().language,
  css: () => css().language,
  html: () => html().language,
  htm: () => html().language,
  json: () => json().language,
  swift: () => cpp().language,
  shell: () => shellLanguage,
  bash: () => shellLanguage,
  sh: () => shellLanguage,
  zsh: () => shellLanguage
};

export function resolveCodeLanguage(info) {
  if (!info) {
    return null;
  }

  const normalized = info.toLowerCase().trim();

  const factory = languageMap[normalized];
  if (factory) {
    return factory();
  }

  return null;
}
