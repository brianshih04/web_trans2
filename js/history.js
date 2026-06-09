/**
 * Conversation history — localStorage-backed.
 *
 * Entry shape:
 * {
 *   id: string,         // unique id
 *   timestamp: number,   // ms since epoch
 *   fromLang: string,    // source language code
 *   toLang: string,      // target language code
 *   fromText: string,    // original text
 *   toText: string,      // translated text
 *   direction: string    // "A→B" or "B→A"
 * }
 */

const STORAGE_KEY = 'web_trans_history';
const MAX_ENTRIES = 500;

/**
 * Add a new entry to the top of the history.
 * @param {Omit<Entry, 'id'|'timestamp'>} entry
 * @returns {Entry[]} Updated entries array
 */
export function addEntry(entry) {
  const entries = getEntries();
  entries.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    ...entry,
  });

  // Trim to max
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  persist(entries);
  return entries;
}

/**
 * Get all history entries (newest first).
 * @returns {Entry[]}
 */
export function getEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clear all history.
 */
export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

// -- Internal ---------------------------------------------------------------

function persist(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full — trim older entries
    const half = entries.slice(0, Math.floor(entries.length / 2));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(half));
  }
}
