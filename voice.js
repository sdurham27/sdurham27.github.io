/**
 * BuildOps Voice Assistant
 *
 * Flow: idle → (mic click) → listening → (speech ends) → thinking
 *       → (Glean responds) → speaking → idle
 *
 * Requires:
 *  - Chrome / Edge (WebkitSpeechRecognition or SpeechRecognition)
 *  - A Glean API token stored in settings
 *  - The jira-proxy Cloudflare Worker (updated to route /glean/* to Glean)
 */

const PROXY_URL   = 'https://jira-proxy.shrimpwheels.workers.dev';
const STORAGE_KEY = 'buildopsVoiceSettings';
const DEFAULT_BACKEND = 'buildops-be.glean.com';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const orb             = document.getElementById('orb');
const statusText      = document.getElementById('status-text');
const transcriptArea  = document.getElementById('transcript-area');
const transcriptText  = document.getElementById('transcript-text');
const responseArea    = document.getElementById('response-area');
const responseText    = document.getElementById('response-text');
const followUps       = document.getElementById('follow-ups');
const followUpList    = document.getElementById('follow-up-list');
const errorArea       = document.getElementById('error-area');
const micBtn          = document.getElementById('mic-btn');
const stopBtn         = document.getElementById('stop-btn');
const hintText        = document.getElementById('hint-text');
const settingsToggle  = document.getElementById('settings-toggle');
const settingsPanel   = document.getElementById('settings-panel');
const gleanEmailInput   = document.getElementById('glean-email');
const gleanTokenInput   = document.getElementById('glean-token');
const gleanBackendInput = document.getElementById('glean-backend');
const voiceSelect     = document.getElementById('voice-select');
const saveSettingsBtn = document.getElementById('save-settings');
const settingsStatus  = document.getElementById('settings-status');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let appState           = 'idle';      // idle | listening | thinking | speaking
let recognition        = null;
let currentUtterance   = null;
let chatSessionToken   = null;        // kept across turns for follow-ups
let finalTranscript    = '';
let abortController    = null;        // lets us cancel in-flight Glean fetch

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function loadSettings() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  gleanEmailInput.value   = saved.gleanEmail   || '';
  gleanTokenInput.value   = saved.gleanToken   || '';
  gleanBackendInput.value = saved.gleanBackend || DEFAULT_BACKEND;
  return saved;
}

function getSettings() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

saveSettingsBtn.addEventListener('click', () => {
  const settings = {
    gleanEmail:   gleanEmailInput.value.trim(),
    gleanToken:   gleanTokenInput.value.trim(),
    gleanBackend: gleanBackendInput.value.trim() || DEFAULT_BACKEND,
    voiceName:    voiceSelect.value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  settingsStatus.textContent = 'Saved!';
  settingsStatus.className   = 'settings-status success';
  setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
});

settingsToggle.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
function setState(newState) {
  appState           = newState;
  orb.dataset.state  = newState;

  switch (newState) {
    case 'idle':
      statusText.textContent = 'Tap the mic to ask a question';
      micBtn.hidden  = false;
      stopBtn.hidden = true;
      hintText.hidden = false;
      break;

    case 'listening':
      statusText.textContent = 'Listening…';
      micBtn.hidden  = true;
      stopBtn.hidden = false;
      hintText.hidden = true;
      break;

    case 'thinking':
      statusText.textContent = 'Thinking…';
      micBtn.hidden  = true;
      stopBtn.hidden = false;
      hintText.hidden = true;
      break;

    case 'speaking':
      statusText.textContent = 'Speaking…';
      micBtn.hidden  = true;
      stopBtn.hidden = false;
      hintText.hidden = true;
      break;
  }
}

// ---------------------------------------------------------------------------
// Speech Recognition
// ---------------------------------------------------------------------------
function createRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.lang             = 'en-US';
  rec.continuous       = false;
  rec.interimResults   = true;
  rec.maxAlternatives  = 1;

  rec.onstart = () => {
    finalTranscript = '';
    setState('listening');
    hideError();
    transcriptText.textContent = '';
    transcriptArea.hidden = false;
  };

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += chunk;
      } else {
        interim += chunk;
      }
    }
    transcriptText.textContent = (finalTranscript + (interim ? ` ${interim}` : '')).trim();
  };

  rec.onerror = (event) => {
    const msgs = {
      'no-speech':   'No speech detected. Please try again.',
      'not-allowed': 'Microphone access denied. Please allow access in your browser settings.',
      'network':     'Network error during speech recognition. Check your connection.',
    };
    showError(msgs[event.error] || `Speech recognition error: ${event.error}`);
    setState('idle');
  };

  rec.onend = () => {
    const question = finalTranscript.trim();
    if (question && appState === 'listening') {
      askGlean(question);
    } else if (appState === 'listening') {
      setState('idle');
    }
  };

  return rec;
}

// ---------------------------------------------------------------------------
// Glean Chat API
// ---------------------------------------------------------------------------
async function askGlean(question) {
  setState('thinking');

  const settings = getSettings();

  if (!settings.gleanToken) {
    showError('No Glean API token found. Open settings and paste your token.');
    setState('idle');
    settingsPanel.hidden = false;
    return;
  }

  const backend = settings.gleanBackend || DEFAULT_BACKEND;

  const payload = {
    messages: [
      {
        author:    'USER',
        fragments: [{ text: question }],
      },
    ],
    stream:    true,
    saveChat:  false,
  };

  // Carry forward session token so Glean has conversation context
  if (chatSessionToken) {
    payload.chatSessionTrackingToken = chatSessionToken;
  }

  abortController = new AbortController();

  try {
    const res = await fetch(`${PROXY_URL}/glean/rest/api/v1/chat`, {
      method:  'POST',
      signal:  abortController.signal,
      headers: {
        'Authorization':   `Bearer ${settings.gleanToken}`,
        'Content-Type':    'application/json',
        'Accept':          'application/json',
        'X-Glean-Backend': backend,
        ...(settings.gleanEmail ? { 'X-Glean-ActAs': settings.gleanEmail } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try { detail = JSON.parse(body).message || body; } catch (_) {}
      throw new Error(`Glean returned ${res.status}: ${detail}`);
    }

    // Read the NDJSON stream: Glean sends one JSON object per line.
    // Each chunk is a cumulative snapshot of the response so far, so we
    // display the latest text immediately and speak after the stream ends.
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';
    let lastData  = null;
    let lastText  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();   // keep any partial line for the next chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed);
          lastData = chunk;

          // Extract the latest AI text from this chunk
          const msgs   = chunk.messages || [];
          const aiMsg  = msgs.slice().reverse().find(m => m.author === 'GLEAN_AI')
                      || msgs[msgs.length - 1];
          if (aiMsg) {
            const chunkText = (aiMsg.fragments || [])
              .filter(f => typeof f.text === 'string')
              .map(f => f.text)
              .join(' ')
              .trim();
            if (chunkText) {
              lastText = chunkText;
              responseText.textContent = lastText;
              responseArea.hidden = false;
            }
          }
        } catch (_) { /* partial / non-JSON line — skip */ }
      }
    }

    if (!lastData) {
      throw new Error('Glean returned no response. Check your token and backend URL.');
    }
    if (!lastText) {
      throw new Error('Glean response was empty.');
    }

    // Persist session for follow-up questions
    if (lastData.chatSessionTrackingToken) {
      chatSessionToken = lastData.chatSessionTrackingToken;
    }

    // Show suggested follow-up prompts from final chunk
    const finalMsgs   = lastData.messages || [];
    const finalAiMsg  = finalMsgs.slice().reverse().find(m => m.author === 'GLEAN_AI')
                     || finalMsgs[finalMsgs.length - 1];
    const prompts = (finalAiMsg && finalAiMsg.followUpPrompts)
                 || lastData.followUpPrompts
                 || [];
    if (prompts.length > 0) {
      followUpList.innerHTML = '';
      prompts.slice(0, 3).forEach(p => {
        const li  = document.createElement('li');
        const btn = document.createElement('button');
        btn.textContent = p;
        btn.className   = 'follow-up-btn';
        btn.addEventListener('click', () => {
          transcriptText.textContent = p;
          transcriptArea.hidden = false;
          responseArea.hidden   = true;
          followUps.hidden      = true;
          askGlean(p);
        });
        li.appendChild(btn);
        followUpList.appendChild(li);
      });
      followUps.hidden = false;
    } else {
      followUps.hidden = true;
    }

    // Strip markdown for clean text-to-speech (speak full answer at the end)
    speak(stripMarkdown(lastText));

  } catch (err) {
    if (err.name === 'AbortError') return;   // user cancelled
    showError(err.message);
    setState('idle');
  }
}

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------
function speak(text) {
  setState('speaking');

  if (currentUtterance) {
    window.speechSynthesis.cancel();
  }

  const utterance  = new SpeechSynthesisUtterance(text);
  utterance.rate   = 1.0;
  utterance.pitch  = 1.0;
  utterance.volume = 1.0;

  // Use selected voice or a natural en-US voice
  const settings = getSettings();
  const voices   = window.speechSynthesis.getVoices();
  if (settings.voiceName) {
    const match = voices.find(v => v.name === settings.voiceName);
    if (match) utterance.voice = match;
  } else {
    // Prefer Google or natural voices over the robotic defaults
    const preferred =
      voices.find(v => v.lang.startsWith('en') && /google/i.test(v.name))  ||
      voices.find(v => v.lang === 'en-US' && v.localService)               ||
      voices.find(v => v.lang === 'en-US')                                  ||
      voices[0];
    if (preferred) utterance.voice = preferred;
  }

  utterance.onend = () => { currentUtterance = null; setState('idle'); };
  utterance.onerror = () => { currentUtterance = null; setState('idle'); };

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

/**
 * Remove common markdown so the TTS engine doesn't read symbols aloud.
 */
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s*/g, '')              // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')        // bold
    .replace(/\*(.+?)\*/g, '$1')            // italic
    .replace(/__(.+?)__/g, '$1')            // bold alt
    .replace(/_(.+?)_/g, '$1')              // italic alt
    .replace(/`{1,3}[^`]*`{1,3}/g, '')      // inline code / code blocks
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')     // links → anchor text
    .replace(/!\[.*?\]\(.*?\)/g, '')        // images
    .replace(/^\s*[-*+]\s+/gm, '')          // bullet points
    .replace(/^\s*\d+\.\s+/gm, '')          // numbered lists
    .replace(/\n{2,}/g, '. ')              // paragraph breaks → pause
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
micBtn.addEventListener('click', () => {
  if (appState !== 'idle') return;

  if (!recognition) {
    recognition = createRecognition();
  }

  if (!recognition) {
    showError(
      'Speech recognition is not supported in this browser. ' +
      'Please use Chrome or Edge.'
    );
    return;
  }

  // Reset UI for a fresh question
  responseArea.hidden  = true;
  followUps.hidden     = true;
  hideError();

  recognition.start();
});

stopBtn.addEventListener('click', () => {
  switch (appState) {
    case 'listening':
      recognition && recognition.stop();
      break;
    case 'speaking':
      window.speechSynthesis.cancel();
      setState('idle');
      break;
    case 'thinking':
      if (abortController) abortController.abort();
      setState('idle');
      break;
  }
});

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------
function showError(msg) {
  errorArea.textContent = msg;
  errorArea.hidden      = false;
}

function hideError() {
  errorArea.hidden = true;
}

// ---------------------------------------------------------------------------
// Populate voice selector once voices are available
// ---------------------------------------------------------------------------
function populateVoices() {
  const voices   = window.speechSynthesis.getVoices();
  const saved    = getSettings().voiceName || '';

  // Clear all except the default option
  voiceSelect.length = 1;

  voices
    .filter(v => v.lang.startsWith('en'))
    .forEach(v => {
      const opt      = document.createElement('option');
      opt.value      = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      opt.selected   = v.name === saved;
      voiceSelect.appendChild(opt);
    });
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = populateVoices;
  populateVoices();  // may already be loaded
} else {
  showError('Text-to-speech is not supported in this browser.');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadSettings();
setState('idle');
