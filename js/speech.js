/**
 * Web Speech API — SpeechRecognition wrapper
 *
 * Handles:
 * - Browser prefix (webkitSpeechRecognition on iOS/Safari)
 * - Continuous listening with auto-restart on silence
 * - Interim + final result distinction
 * - Error recovery for common transient errors
 */

/**
 * Check if SpeechRecognition is available in this browser.
 */
export function isSpeechSupported() {
  return !!(
    window.SpeechRecognition ||
    window.webkitSpeechRecognition
  );
}

/**
 * Create a speech recognition session.
 *
 * @param {Object} opts
 * @param {string} opts.lang        - BCP-47 language tag (e.g. "zh-CN", "en-US")
 * @param {Function} opts.onResult  - Called with (text: string, isFinal: boolean)
 * @param {Function} opts.onError   - Called with (errorMessage: string)
 * @param {Function} opts.onStateChange - Called with (state: 'listening' | 'idle' | 'error')
 * @returns {{ start: Function, stop: Function, abort: Function, stop: () => string }}
 */
export function createSpeechSession({ lang, onResult, onError, onStateChange }) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    onError('此瀏覽器不支援語音辨識');
    return { start() {}, stop() { return ''; }, abort() {} };
  }

  const recognition = new SpeechRecognition();

  recognition.lang = lang;
  recognition.continuous = true;        // Keep mic open
  recognition.interimResults = true;    // Show partial results
  recognition.maxAlternatives = 1;

  let isActive = false;
  let finalTranscript = '';
  let latestText = '';                  // Most recent transcript (interim or final)

  recognition.onresult = (event) => {
    let interim = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }

    latestText = finalTranscript + interim;
    onResult(latestText, false);
  };

  recognition.onerror = (event) => {
    // Transient errors — ignore, let auto-restart handle them
    if (event.error === 'no-speech' || event.error === 'audio-capture') {
      return;
    }

    // Aborted by us — not an error
    if (event.error === 'aborted' && !isActive) {
      return;
    }

    const messages = {
      'not-allowed': '請允許麥克風權限以使用語音辨識',
      'network': '網路連線異常，請檢查網路後重試',
      'service-not-allowed': '語音辨識服務暫時無法使用',
      'language-not-supported': `不支援的語言：${lang}`,
    };

    const msg = messages[event.error] || `語音辨識錯誤：${event.error}`;
    isActive = false;
    onStateChange('error');
    onError(msg);
  };

  recognition.onend = () => {
    if (isActive) {
      // Auto-restart for continuous listening (Chrome stops after silence)
      try {
        recognition.start();
      } catch (e) {
        // Ignore — may already be started
      }
    } else {
      // Stopped intentionally — deliver final result
      onResult(finalTranscript, true);
      onStateChange('idle');
    }
  };

  return {
    /** Begin (or resume) listening */
    start() {
      finalTranscript = '';
      latestText = '';
      isActive = true;
      onStateChange('listening');
      try {
        recognition.start();
      } catch (e) {
        // Already started — harmless
      }
    },

    /**
     * Stop listening gracefully.
     * @returns {string} The latest captured transcript text
     */
    stop() {
      isActive = false;
      try {
        recognition.stop();
      } catch (e) {
        // May already be stopped
      }
      return latestText;
    },

    /** Abort immediately, discard any pending result */
    abort() {
      isActive = false;
      try {
        recognition.abort();
      } catch (e) {
        // May already be stopped
      }
    },
  };
}
