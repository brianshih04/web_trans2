/**
 * Translation service module.
 *
 * Default backend: MyMemory (free, no API key required).
 * Easily extensible to other backends (Google, DeepL, LibreTranslate, etc.).
 */

// -- Backend registry -------------------------------------------------------

const backends = {};

/**
 * Register a translation backend.
 *
 * @param {string} name
 * @param {(text: string, from: string, to: string) => Promise<string>} fn
 */
export function registerBackend(name, fn) {
  backends[name] = fn;
}

// -- Built-in: MyMemory -----------------------------------------------------

registerBackend('mymemory', async (text, from, to) => {
  const fromCode = mapToMyMemory(from);
  const toCode = mapToMyMemory(to);

  const url =
    'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(text)}` +
    `&langpair=${fromCode}|${toCode}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.responseStatus !== 200) {
    throw new Error(data.responseDetails || '翻譯失敗');
  }

  return data.responseData.translatedText;
});

// -- Public API -------------------------------------------------------------

let activeBackend = 'mymemory';

/**
 * Set the active translation backend by name.
 * @param {'mymemory' | string} name
 */
export function setBackend(name) {
  if (!backends[name]) {
    console.warn(`Unknown backend "${name}", keeping "${activeBackend}"`);
    return;
  }
  activeBackend = name;
}

/**
 * Translate text between two languages.
 *
 * @param {string} text  - Source text
 * @param {string} from  - Source language code (BCP-47, e.g. "zh-CN", "en-US")
 * @param {string} to    - Target language code
 * @returns {Promise<string>} Translated text
 */
export async function translate(text, from, to) {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Same language — no translation needed
  if (normalizeCode(from) === normalizeCode(to)) {
    return trimmed;
  }

  const backend = backends[activeBackend];
  if (!backend) {
    throw new Error(`未註冊的翻譯後端：${activeBackend}`);
  }

  try {
    return await backend(trimmed, from, to);
  } catch (err) {
    console.error('Translation error:', err);
    throw new Error('翻譯服務暫時無法使用，請稍後再試');
  }
}

// -- Helpers ----------------------------------------------------------------

/** Map a BCP-47 code to the format MyMemory expects. */
function mapToMyMemory(code) {
  const overrides = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en-US': 'en',
    'en-GB': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
    'fr-FR': 'fr',
    'de-DE': 'de',
    'es-ES': 'es',
    'th-TH': 'th',
    'vi-VN': 'vi',
  };

  if (overrides[code]) return overrides[code];

  // Fallback: strip region, keep language
  const lang = code.split('-')[0];
  return lang || code;
}

/** Extract the base language from a BCP-47 tag for same-language detection. */
function normalizeCode(code) {
  const parts = code.split('-');
  // For zh, keep the region (zh-CN ≠ zh-TW)
  if (parts[0] === 'zh') return code;
  return parts[0];
}
