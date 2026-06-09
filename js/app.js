/**
 * 即時雙向翻譯 — 主程式
 *
 * 流程：按住說話 → STT 辨識 → 顯示原文 → 翻譯 → 顯示譯文
 */

import { isSpeechSupported, createSpeechSession } from './speech.js';
import { translate } from './translate.js';
import { addEntry, getEntries, clearHistory } from './history.js';

// -- Register Service Worker ------------------------------------------------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => console.log('SW registered:', reg.scope))
    .catch((err) => console.warn('SW registration failed:', err));
}

// -- Language definitions ---------------------------------------------------

const LANGUAGES = [
  { code: 'zh-CN', name: '中文（簡體）' },
  { code: 'zh-TW', name: '中文（繁體）' },
  { code: 'en-US', name: 'English' },
  { code: 'ja-JP', name: '日本語' },
  { code: 'ko-KR', name: '한국어' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'es-ES', name: 'Español' },
  { code: 'th-TH', name: 'ภาษาไทย' },
  { code: 'vi-VN', name: 'Tiếng Việt' },
];

// -- Application state ------------------------------------------------------

const state = {
  panelA: { lang: 'zh-CN', mode: 'voice', status: 'idle' },
  panelB: { lang: 'en-US', mode: 'voice', status: 'idle' },
  activePanel: null, // 'A' | 'B' | null
};

// Session handles (created per recording)
const sessions = { A: null, B: null };

// -- DOM helpers ------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// -- Initialization ---------------------------------------------------------

function init() {
  if (!isSpeechSupported()) {
    state.panelA.mode = 'text';
    state.panelB.mode = 'text';
    document.body.classList.add('no-speech');
  }

  populateLanguageSelectors();
  bindEvents();
  updateAllUI();
  renderHistory();
}

// -- Language selectors -----------------------------------------------------

function populateLanguageSelectors() {
  for (const id of ['A', 'B']) {
    const sel = $(`#lang${id}`);
    LANGUAGES.forEach((l) => {
      sel.add(new Option(l.name, l.code));
    });
    sel.value = state[`panel${id}`].lang;
  }
}

// -- Event binding ----------------------------------------------------------

function bindEvents() {
  // Mic buttons — hold to speak
  bindMic('A');
  bindMic('B');

  // Language change
  $('#langA').addEventListener('change', (e) => {
    state.panelA.lang = e.target.value;
  });
  $('#langB').addEventListener('change', (e) => {
    state.panelB.lang = e.target.value;
  });

  // Swap languages
  $('#btnSwap').addEventListener('click', swapLanguages);

  // Mode toggle (voice ↔ text)
  $('#modeA').addEventListener('click', () => toggleMode('A'));
  $('#modeB').addEventListener('click', () => toggleMode('B'));

  // Text input — Enter to translate
  $('#textInputA').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextTranslate('A');
    }
  });
  $('#textInputB').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextTranslate('B');
    }
  });

  // History drawer
  $('#btnHistory').addEventListener('click', openHistory);
  $('#btnCloseHistory').addEventListener('click', closeHistory);
  $('#overlay').addEventListener('click', closeHistory);
  $('#btnClearHistory').addEventListener('click', () => {
    clearHistory();
    renderHistory();
  });
}

// -- Mic button interaction -------------------------------------------------

function bindMic(panelId) {
  const btn = $(`#mic${panelId}`);
  let pressStart = 0;

  const onStart = (e) => {
    e.preventDefault();
    if (state.activePanel || state[`panel${panelId}`].status !== 'idle') return;
    pressStart = performance.now();
    startListening(panelId);
  };

  const onEnd = (e) => {
    e.preventDefault();
    const panel = state[`panel${panelId}`];
    if (panel.status !== 'listening') return;

    // Require minimum 400ms hold to avoid accidental taps
    if (performance.now() - pressStart < 400) {
      cancelListening(panelId);
      return;
    }

    stopListening(panelId);
  };

  btn.addEventListener('pointerdown', onStart);
  btn.addEventListener('pointerup', onEnd);
  btn.addEventListener('pointerleave', onEnd);
  btn.addEventListener('pointercancel', onEnd);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// -- Speech flow ------------------------------------------------------------

function startListening(panelId) {
  const panel = state[`panel${panelId}`];
  state.activePanel = panelId;
  panel.status = 'listening';
  updatePanelUI(panelId);

  sessions[panelId] = createSpeechSession({
    lang: panel.lang,
    onResult: (text) => {
      setTranscript(panelId, 'original', text);
    },
    onError: (msg) => {
      showError(panelId, msg);
      resetPanel(panelId);
    },
    onStateChange: () => {
      // Handled via status machine
    },
  });

  sessions[panelId].start();
}

function stopListening(panelId) {
  const panel = state[`panel${panelId}`];
  const session = sessions[panelId];
  if (!session) return;

  session.stop();
  panel.status = 'processing';
  updatePanelUI(panelId);

  const originalText = getTranscript(panelId, 'original');
  if (!originalText.trim()) {
    resetPanel(panelId);
    return;
  }

  const targetId = panelId === 'A' ? 'B' : 'A';
  const targetPanel = state[`panel${targetId}`];

  translate(originalText, panel.lang, targetPanel.lang)
    .then((translated) => {
      setTranscript(targetId, 'translated', translated);
      setTranscript(panelId, 'translated', translated); // Show translation on both sides

      addEntry({
        fromLang: panel.lang,
        toLang: targetPanel.lang,
        fromText: originalText,
        toText: translated,
        direction: panelId === 'A' ? 'A→B' : 'B→A',
      });
    })
    .catch((err) => {
      showError(panelId, err.message);
    })
    .finally(() => {
      resetPanel(panelId);
    });
}

function cancelListening(panelId) {
  const session = sessions[panelId];
  if (session) session.abort();
  resetPanel(panelId);
  setTranscript(panelId, 'original', '');
}

function resetPanel(panelId) {
  state[`panel${panelId}`].status = 'idle';
  sessions[panelId] = null;
  state.activePanel = null;
  updatePanelUI(panelId);
}

// -- Text mode translation --------------------------------------------------

async function handleTextTranslate(panelId) {
  const panel = state[`panel${panelId}`];
  const input = $(`#textInput${panelId}`);
  const text = input.value.trim();
  if (!text) return;

  panel.status = 'processing';
  updatePanelUI(panelId);

  const targetId = panelId === 'A' ? 'B' : 'A';
  const targetPanel = state[`panel${targetId}`];

  try {
    const translated = await translate(text, panel.lang, targetPanel.lang);

    setTranscript(panelId, 'original', text);
    setTranscript(targetId, 'translated', translated);
    setTranscript(panelId, 'translated', translated);

    addEntry({
      fromLang: panel.lang,
      toLang: targetPanel.lang,
      fromText: text,
      toText: translated,
      direction: panelId === 'A' ? 'A→B' : 'B→A',
    });

    input.value = '';
  } catch (err) {
    showError(panelId, err.message);
  }

  panel.status = 'idle';
  updatePanelUI(panelId);
}

// -- UI helpers -------------------------------------------------------------

function updateAllUI() {
  updatePanelUI('A');
  updatePanelUI('B');
}

function updatePanelUI(panelId) {
  const panel = state[`panel${panelId}`];
  const el = $(`#panel${panelId}`);
  el.dataset.status = panel.status;
  el.dataset.mode = panel.mode;

  const micBtn = $(`#mic${panelId}`);
  micBtn.disabled = panel.status !== 'idle';
}

function setTranscript(panelId, field, text) {
  const el = $(`#transcript${panelId} .transcript-${field}`);
  if (el) el.textContent = text;
}

function getTranscript(panelId, field) {
  const el = $(`#transcript${panelId} .transcript-${field}`);
  return el ? el.textContent : '';
}

function showError(panelId, msg) {
  setTranscript(panelId, 'original', '');
  setTranscript(panelId, 'translated', `⚠️ ${msg}`);
  // Auto-clear error after 5s
  setTimeout(() => {
    if (getTranscript(panelId, 'translated').startsWith('⚠️')) {
      setTranscript(panelId, 'translated', '');
    }
  }, 5000);
}

// -- Swap languages ---------------------------------------------------------

function swapLanguages() {
  // Swap state
  [state.panelA.lang, state.panelB.lang] = [state.panelB.lang, state.panelA.lang];
  $('#langA').value = state.panelA.lang;
  $('#langB').value = state.panelB.lang;

  // Swap displayed transcripts
  const aOrig = getTranscript('A', 'original');
  const aTrans = getTranscript('A', 'translated');
  const bOrig = getTranscript('B', 'original');
  const bTrans = getTranscript('B', 'translated');

  setTranscript('A', 'original', bOrig);
  setTranscript('A', 'translated', bTrans);
  setTranscript('B', 'original', aOrig);
  setTranscript('B', 'translated', aTrans);
}

// -- Mode toggle ------------------------------------------------------------

function toggleMode(panelId) {
  const panel = state[`panel${panelId}`];
  panel.mode = panel.mode === 'voice' ? 'text' : 'voice';
  updatePanelUI(panelId);
}

// -- History drawer ---------------------------------------------------------

function openHistory() {
  $('#historyDrawer').classList.add('open');
  $('#overlay').classList.add('show');
  renderHistory();
}

function closeHistory() {
  $('#historyDrawer').classList.remove('open');
  $('#overlay').classList.remove('show');
}

function renderHistory() {
  const entries = getEntries();
  const list = $('#historyList');

  if (entries.length === 0) {
    list.innerHTML = '<div class="history-empty">尚無對話記錄</div>';
    return;
  }

  list.innerHTML = entries
    .map(
      ({ timestamp, fromText, toText, fromLang, toLang }) => `
    <div class="history-item">
      <div class="history-time">${fmtTime(timestamp)}</div>
      <div class="history-text original">${esc(fromText)}</div>
      <div class="history-text translated">${esc(toText)}</div>
      <div class="history-meta">${langName(fromLang)} → ${langName(toLang)}</div>
    </div>`,
    )
    .join('');
}

// -- Formatting helpers -----------------------------------------------------

function fmtTime(ts) {
  const d = new Date(ts);
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function p(n) {
  return String(n).padStart(2, '0');
}

function langName(code) {
  return LANGUAGES.find((l) => l.code === code)?.name || code;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// -- Boot -------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', init);
