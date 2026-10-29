import { messages, aliases } from './locales.js';
export { messages };
export const locales = ['ja', 'en', 'zh-CN', 'zh-TW', 'ko', 'es', 'fr', 'de', 'pt', 'hi', 'ar'];
export const localeNames = [
  '日本語',
  'English',
  '简体中文',
  '繁體中文',
  '한국어',
  'Español',
  'Français',
  'Deutsch',
  'Português',
  'हिन्दी',
  'العربية',
];
let locale = 'ja';
const bindings = new Map();
export function resolveLocale(preferences = [], saved) {
  if (locales.includes(saved)) return saved;
  for (const preference of preferences) {
    if (typeof preference !== 'string') continue;
    const parts = preference.toLowerCase().replaceAll('_', '-').split('-');
    if (parts[0] === 'zh') {
      if (parts.includes('hant')) return 'zh-TW';
      if (parts.includes('hans')) return 'zh-CN';
      return parts.some((p) => ['tw', 'hk', 'mo'].includes(p)) ? 'zh-TW' : 'zh-CN';
    }
    if (locales.includes(parts[0])) return parts[0];
  }
  return 'en';
}
function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
export function readLocale(preferences = [], storage = browserStorage()) {
  let saved;
  try {
    saved = storage?.getItem('fumi-locale');
  } catch {
    /* Storage is optional. */
  }
  return resolveLocale(preferences, saved);
}
export const getLocale = () => locale;
export function setLocale(next, storage = browserStorage()) {
  if (!locales.includes(next)) throw new RangeError('Unsupported locale');
  locale = next;
  try {
    storage?.setItem('fumi-locale', locale);
  } catch {
    /* Storage is optional. */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    const select = document.getElementById('language-select');
    if (select) select.value = locale;
    for (const [node, binding] of bindings) {
      if (!node.isConnected) {
        bindings.delete(node);
        continue;
      }
      binding();
    }
    document.dispatchEvent(new Event('fumi:localechange'));
  }
}
export function t(source, params = {}) {
  const key = Object.hasOwn(aliases, source) ? aliases[source] : source;
  const translated = Object.hasOwn(messages, key) ? messages[key][locales.indexOf(locale)] : source;
  return translated.replace(/\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(params, key) ? String(params[key]) : match,
  );
}
// Only interface nodes are registered. User content, filenames and keys never pass here.
export function setText(node, source, params = {}) {
  const render = () => {
    node.textContent = typeof source === 'function' ? source() : t(source, params);
  };
  // Refresh computed text after the interface nodes it reads.
  bindings.delete(node);
  bindings.set(node, render);
  render();
}
export function clearText(node) {
  bindings.delete(node);
  node.textContent = '';
}
export function setError(node, source) {
  setText(node, () => localizeError(source));
}
export function localizeError(source) {
  if (!source) return '';
  if (Object.hasOwn(messages, source) || Object.hasOwn(aliases, source))
    return locale === 'ja' ? source : t(source);
  const size = source.match(/^ファイルは([\d.]+) MB以下にしてください。$/);
  if (size) return t('ファイルは{limit} MB以下にしてください。', { limit: size[1] });
  const retry = source.match(
    /^GitHubの取得上限に達しました。再取得の目安は(\d{1,2}):(\d{2})です。$/,
  );
  if (retry) {
    const date = new Date();
    date.setHours(Number(retry[1]), Number(retry[2]), 0, 0);
    return t('GitHubの取得上限に達しました。再取得の目安は{time}です。', {
      time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    });
  }
  if (/^(OpenPGP|SSH): /.test(source))
    return source
      .split(/ (?=(?:OpenPGP|SSH): )/)
      .map((part) => {
        const [, type, text] = part.match(/^(OpenPGP|SSH): (.*)$/s);
        return type + ': ' + localizeError(text);
      })
      .join(' ');
  if (source.startsWith('GitHubとの照合が完了していません。 '))
    return (
      t('GitHubとの照合が完了していません。') +
      ' ' +
      localizeError(source.slice('GitHubとの照合が完了していません。 '.length))
    );
  const missing = source.match(/^(暗号文|秘密鍵)を入力するか、ファイルを選択してください。$/);
  if (missing)
    return t('{label}を入力するか、ファイルを選択してください。', {
      label: t(missing[1]).toLocaleLowerCase(locale),
    });
  if (
    /^(?:暗号文|秘密鍵|公開鍵|SSH 公開鍵|SSH 秘密鍵|age 暗号文|平文|復号結果)(?:は|の合計は).*?(?:MB|MiB).*以下にしてください。$/.test(
      source,
    )
  )
    return t(
      '入力サイズが上限を超えています。内容は50 MB、暗号文は72 MB、鍵は合計1 MB・100件以下にしてください。',
    );
  if (/^(?:SSH 公開鍵|SSH 秘密鍵|age 暗号文)の形式を確認してください。$/.test(source))
    return t(
      source.startsWith('SSH 秘密鍵')
        ? '秘密鍵を読み込めません。OpenPGP・OpenSSH・PEM形式の対応する秘密鍵を確認してください。'
        : source.startsWith('SSH 公開鍵')
          ? '暗号化に使える公開鍵がありません。GPGまたはSSHの公開鍵を確認してください。'
          : '暗号文の形式を確認してください。OpenPGPまたはage形式に対応しています。',
    );
  return t('処理できませんでした。入力を確認して、もう一度試してください。');
}
export function initLocale() {
  const select = document.getElementById('language-select');
  locales.forEach((value, index) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = localeNames[index];
    option.lang = value;
    option.dir = value === 'ar' ? 'rtl' : 'ltr';
    select.append(option);
  });
  const description = document.querySelector('[data-key-description]');
  if (description) setText(description, description.textContent.trim());
  for (const node of document.querySelectorAll('[data-i18n]')) setText(node, node.dataset.i18n);
  for (const attribute of ['aria-label', 'placeholder', 'content'])
    for (const node of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      const source = node.getAttribute(`data-i18n-${attribute}`);
      // Attribute and text bindings can coexist on the same element.
      const prior = bindings.get(node);
      const render = () => {
        prior?.();
        node.setAttribute(attribute, t(source));
      };
      bindings.set(node, render);
    }
  setLocale(readLocale(navigator.languages || [navigator.language]), null);
  select.value = locale;
  select.addEventListener('change', () => setLocale(select.value));
}
