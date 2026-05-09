// PlainOrder — client-side controller. Pure DOM, no framework.
//
// Wires up the textarea, char counter, translate button, status messages,
// result rendering, and the .ics download. Talks to /api/translate, which
// is served by the Cloudflare Worker (worker/src/index.ts).

(function () {
  const $ = (id) => document.getElementById(id);
  const docInput = $('docInput');
  const translateBtn = $('translateBtn');
  const charCount = $('charCount');
  const statusBox = $('statusBox');
  const resultSection = $('resultSection');
  const summaryBlock = $('summaryBlock');
  const actionsList = $('actionsList');
  const deadlinesList = $('deadlinesList');
  const icsBlock = $('icsBlock');
  const downloadIcsBtn = $('downloadIcsBtn');

  const MIN_CHARS = 50;
  const MAX_CHARS = 30000;

  let lastIcs = '';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(level, message) {
    if (!message) {
      statusBox.classList.add('hidden');
      statusBox.textContent = '';
      return;
    }
    const palettes = {
      info: 'bg-blue-50 border border-blue-300 text-blue-900',
      error: 'bg-red-50 border border-red-300 text-red-900',
      loading: 'bg-gray-50 border border-gray-300 text-gray-700',
    };
    statusBox.className = `mt-6 rounded-md p-3 text-sm ${palettes[level] || palettes.info}`;
    statusBox.textContent = message;
    statusBox.classList.remove('hidden');
  }

  function updateCharCount() {
    const n = docInput.value.length;
    charCount.textContent = `${n.toLocaleString()} character${n === 1 ? '' : 's'}`;
    translateBtn.disabled = n < MIN_CHARS || n > MAX_CHARS;
    if (n > MAX_CHARS) {
      charCount.className = 'text-xs text-red-600';
      charCount.textContent += ` · max ${MAX_CHARS.toLocaleString()}`;
    } else {
      charCount.className = 'text-xs text-gray-500';
    }
  }

  function renderResult(payload) {
    summaryBlock.innerHTML = (payload.plainEnglish || '')
      .split(/\n\s*\n/)
      .map((p) => `<p class="mb-3">${escapeHtml(p.trim())}</p>`)
      .join('');

    const actions = Array.isArray(payload.actionItems) ? payload.actionItems : [];
    actionsList.innerHTML = actions.length
      ? actions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')
      : '<li class="text-gray-500 list-none">No specific action items detected.</li>';

    const deadlines = Array.isArray(payload.deadlines) ? payload.deadlines : [];
    if (!deadlines.length) {
      deadlinesList.innerHTML = '<li class="text-gray-500">No deadlines detected. Read the document carefully — there may be implicit deadlines the AI missed.</li>';
      icsBlock.classList.add('hidden');
    } else {
      deadlinesList.innerHTML = deadlines
        .map(
          (d) => `
        <li class="deadline-pill rounded-md p-3">
          <div class="font-medium">${escapeHtml(d.what || 'Deadline')}</div>
          <div class="text-sm text-gray-700">
            <strong>${escapeHtml(d.dateDisplay || d.date || 'Date unspecified')}</strong>
            ${d.notes ? ` · ${escapeHtml(d.notes)}` : ''}
          </div>
        </li>`,
        )
        .join('');
      lastIcs = payload.ics || '';
      if (lastIcs) icsBlock.classList.remove('hidden');
      else icsBlock.classList.add('hidden');
    }

    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function translate() {
    const text = docInput.value.trim();
    if (text.length < MIN_CHARS) return;
    translateBtn.disabled = true;
    resultSection.classList.add('hidden');
    setStatus('loading', 'Translating… this usually takes 8–20 seconds.');
    try {
      const resp = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (resp.status === 429) {
        const data = await resp.json().catch(() => ({}));
        setStatus('error', data.message || 'You have used your 5 free translations for today. Come back tomorrow.');
        return;
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setStatus('error', data.message || `Server error (${resp.status}). Try again in a minute.`);
        return;
      }
      const payload = await resp.json();
      setStatus(null);
      renderResult(payload);
    } catch (err) {
      setStatus('error', `Network error: ${err && err.message ? err.message : err}`);
    } finally {
      translateBtn.disabled = docInput.value.length < MIN_CHARS || docInput.value.length > MAX_CHARS;
    }
  }

  function downloadIcs() {
    if (!lastIcs) return;
    const blob = new Blob([lastIcs], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plainorder-deadlines.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  docInput.addEventListener('input', updateCharCount);
  translateBtn.addEventListener('click', translate);
  downloadIcsBtn.addEventListener('click', downloadIcs);
  updateCharCount();
})();
