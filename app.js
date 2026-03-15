// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY     = 'gizmo-health-log-v1';
const INFO_KEY        = 'gizmo-info-v1';
const CONFIG_KEY      = 'gizmo-config-v1';
const GIST_FILE       = 'gizmo-log.json';
const INFO_FILE       = 'gizmo-info.json';
const DEFAULT_GIST_ID = '0373bd12fe6f428a93b3e69e05d46e13';

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CHECK_IDS = ['pimo_am','pimo_pm','enalapril','furo_am','furo_pm','coughing','collapse','wet_topper','fish_oil','sardines','vomiting','blood_urine'];
const TEXT_IDS  = ['rr','rr_time','breathing_quality','appetite','food_am','food_mid','food_pm','water_intake','urination_count','urine_color','urination_quality','straining','bowel_count','stool_quality','energy','gum_color','weight','notes','cough_desc'];
const MED_IDS   = ['pimo_am','pimo_pm','enalapril','furo_am','furo_pm'];

const DEFAULT_MEDS = [
  { name: 'Pimobendan', dose: '', freq: 'twice daily' },
  { name: 'Enalapril',  dose: '', freq: 'once daily'  },
  { name: 'Furosemide', dose: '', freq: 'twice daily' },
];

const DEFAULT_VET_INFO = {
  medications: DEFAULT_MEDS,
  vetNotes: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let log     = [];
let vetInfo = {};
let cfg     = { gistId: '', token: '' };

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function el(id) {
  return document.getElementById(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config & persistence
// ─────────────────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    const s = localStorage.getItem(CONFIG_KEY);
    if (s) cfg = { ...cfg, ...JSON.parse(s) };
  } catch (e) {}

  const urlGist = new URLSearchParams(window.location.search).get('gist');
  if (urlGist) cfg.gistId = urlGist;
  else if (!cfg.gistId && DEFAULT_GIST_ID) cfg.gistId = DEFAULT_GIST_ID;
}

function persistConfig() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
}

function localCacheWrite() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); } catch (e) {}
}

function localInfoWrite() {
  try { localStorage.setItem(INFO_KEY, JSON.stringify(vetInfo)); } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Gist API
// ─────────────────────────────────────────────────────────────────────────────

async function gistFetchAll() {
  if (!cfg.gistId) return null;
  try {
    const headers = cfg.token ? { 'Authorization': `token ${cfg.token}` } : {};
    const r = await fetch(`https://api.github.com/gists/${cfg.gistId}`, { headers });
    if (!r.ok) return null;
    const g = await r.json();
    return {
      log:  g.files[GIST_FILE]?.content  ? JSON.parse(g.files[GIST_FILE].content)  : null,
      info: g.files[INFO_FILE]?.content  ? JSON.parse(g.files[INFO_FILE].content)  : null,
    };
  } catch (e) { return null; }
}

async function gistPatch() {
  if (!cfg.gistId || !cfg.token) return false;
  try {
    const r = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `token ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: {
          [GIST_FILE]: { content: JSON.stringify(log) },
          [INFO_FILE]:  { content: JSON.stringify(vetInfo) },
        },
      }),
    });
    return r.ok;
  } catch (e) { return false; }
}

async function gistCreate(token) {
  try {
    const r = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: "Gizmo's Health Log",
        public: false,
        files: {
          [GIST_FILE]: { content: '[]' },
          [INFO_FILE]:  { content: '{}' },
        },
      }),
    });
    if (!r.ok) return null;
    const g = await r.json();
    return g.id;
  } catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Load & save
// ─────────────────────────────────────────────────────────────────────────────

async function loadLog() {
  loadConfig();
  setSyncStatus('loading');

  if (cfg.gistId) {
    const data = await gistFetchAll();
    if (data !== null) {
      if (data.log  !== null) { log     = data.log;  localCacheWrite(); }
      if (data.info !== null) { vetInfo = data.info; localInfoWrite();  }
      el('hist-count').textContent = log.length;
      setSyncStatus(cfg.token ? 'synced' : 'readonly');
      return;
    }
    setSyncStatus('error');
  } else {
    setSyncStatus('local');
  }

  try { const s = localStorage.getItem(STORAGE_KEY); if (s) log     = JSON.parse(s); } catch (e) { log     = []; }
  try { const s = localStorage.getItem(INFO_KEY);    if (s) vetInfo = JSON.parse(s); } catch (e) { vetInfo = {}; }
  el('hist-count').textContent = log.length;
}

async function saveLog() {
  localCacheWrite();
  if (!cfg.gistId || !cfg.token) { setSyncStatus('local'); return true; }
  setSyncStatus('loading');
  const ok = await gistPatch();
  setSyncStatus(ok ? 'synced' : 'error');
  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync status badge
// ─────────────────────────────────────────────────────────────────────────────

function setSyncStatus(state) {
  const badge = el('sync-status');
  if (!badge) return;
  const map = {
    loading:  ['⟳', 'Syncing…',   'var(--dim)'],
    synced:   ['☁', 'Synced',     'var(--green)'],
    readonly: ['👁', 'View-only',  'var(--blue)'],
    local:    ['💾', 'Local only', 'var(--yellow)'],
    error:    ['⚠', 'Sync error', 'var(--red)'],
  };
  const [icon, text, color] = map[state] || map.local;
  badge.innerHTML = `<span style="color:${color}">${icon} ${text}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form — read & write
// ─────────────────────────────────────────────────────────────────────────────

function getFormData() {
  const data = { date: el('f-date').value };
  TEXT_IDS.forEach(id  => { data[id] = el('f-' + id)?.value   || ''; });
  CHECK_IDS.forEach(id => { data[id] = el('f-' + id)?.checked || false; });
  return data;
}

function setFormData(data) {
  if (!data) return;
  const allTextIds = ['date', ...TEXT_IDS];
  allTextIds.forEach(id => { const input = el('f-' + id); if (input) input.value = data[id] || ''; });
  CHECK_IDS.forEach(id => {
    const input = el('f-' + id);
    if (input) { input.checked = !!data[id]; syncCheckLabel(id, !!data[id]); }
  });
  checkRR();
  checkGums();
  checkBlood();
  checkStraining();
  checkCollapse();
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkbox helpers
// ─────────────────────────────────────────────────────────────────────────────

function syncCheckLabel(id, checked) {
  const lbl = el('lbl-' + id);
  if (!lbl) return;
  const dot    = lbl.querySelector('.check-dot');
  const isWarn = ['blood_urine', 'collapse'].includes(id);
  lbl.className = 'check-label' + (checked ? (isWarn ? ' checked-warn' : ' checked') : '');
  if (dot) dot.textContent = checked ? '✓' : '○';
}

function updateCheck(id) {
  syncCheckLabel(id, el('f-' + id)?.checked);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline alert checks
// ─────────────────────────────────────────────────────────────────────────────

function checkRR() {
  const val   = parseFloat(el('f-rr').value);
  const alert = el('rr-alert');
  if (val >= 40)      alert.innerHTML = '<div class="alert alert-danger">🚨 RR ≥ 40 — Go to ER immediately</div>';
  else if (val >= 30) alert.innerHTML = '<div class="alert alert-warn">⚠️ RR ≥ 30 — Call your vet today</div>';
  else                alert.innerHTML = '';
}

function checkGums() {
  const val = el('f-gum_color').value;
  el('gum-alert').innerHTML = (val.includes('White') || val.includes('Blue'))
    ? '<div class="alert alert-danger">🚨 Abnormal gum color — Emergency vet immediately</div>'
    : '';
}

function checkBlood() {
  el('blood-alert').innerHTML = el('f-blood_urine').checked
    ? '<div class="alert alert-danger">🚨 Blood in urine — call vet today</div>'
    : '';
}

function checkStraining() {
  el('strain-alert').innerHTML = el('f-straining').value === 'Significant'
    ? '<div class="alert alert-warn">⚠️ Significant straining — mention to vet (prostate concern)</div>'
    : '';
}

function checkCollapse() {
  el('collapse-field').style.display = el('f-collapse').checked ? 'block' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Date change — populate form from existing entry
// ─────────────────────────────────────────────────────────────────────────────

function onDateChange() {
  const date     = el('f-date').value;
  const existing = log.find(e => e.date === date);
  setFormData(existing ?? { date });
}

// ─────────────────────────────────────────────────────────────────────────────
// Save daily entry
// ─────────────────────────────────────────────────────────────────────────────

async function saveEntry() {
  const data = getFormData();
  if (!data.date) { alert('Please set a date before saving.'); return; }

  log = log.filter(e => e.date !== data.date);
  log.push(data);
  log.sort((a, b) => b.date.localeCompare(a.date));

  const btn = el('save-btn');
  btn.textContent = '⟳ Saving…';
  btn.classList.add('saving');
  btn.disabled = true;

  await saveLog();

  el('hist-count').textContent = log.length;
  btn.textContent = '✓ Saved!';
  btn.classList.remove('saving');
  btn.classList.add('saved');
  btn.disabled = false;
  setTimeout(() => { btn.textContent = "Save Today's Log"; btn.classList.remove('saved'); }, 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  ['today', 'history', 'vetinfo', 'vetnotes', 'careguide'].forEach(t => {
    el('pane-' + t).style.display = tab === t ? 'block' : 'none';
    el('tab-'  + t).className     = 'tab ' + (tab === t ? 'active' : 'inactive');
  });
  if (tab === 'history')  renderHistory();
  if (tab === 'vetinfo')  populateVetInfoForm();
  if (tab === 'vetnotes') { renderVetNotes(); el('vn-date').value = today(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// History pane
// ─────────────────────────────────────────────────────────────────────────────

function renderHistory() {
  const container = el('history-list');
  if (!log.length) {
    container.innerHTML = '<div class="empty">No entries yet — start logging today!</div>';
    return;
  }

  container.innerHTML = log.map(e => {
    const rrNum    = parseFloat(e.rr);
    const rrBadge  = e.rr     ? `<span class="badge ${rrNum >= 30 ? 'badge-rr-warn' : 'badge-rr-ok'}">RR ${e.rr} bpm</span>` : '';
    const wtBadge  = e.weight ? `<span class="badge badge-weight">${e.weight} lbs</span>` : '';
    const medCount = MED_IDS.filter(k => e[k]).length;

    const rows = [
      e.appetite          ? ['😋 Appetite',  e.appetite.split('—')[0].trim()]  : null,
      e.energy            ? ['⚡ Energy',     e.energy.split('—')[0].trim()]    : null,
      e.urination_count   ? ['💧 Urination',  e.urination_count + 'x']          : null,
      e.urination_quality ? ['🚿 Stream',     e.urination_quality]              : null,
      e.straining         ? ['⚠ Straining',  e.straining]                      : null,
      e.gum_color         ? ['🦷 Gums',       e.gum_color]                      : null,
      e.stool_quality     ? ['🌿 Stool',      e.stool_quality]                  : null,
      ['💊 Meds', `${medCount}/5 given`],
    ].filter(Boolean);

    return `
      <div class="history-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div class="history-date">${formatDate(e.date)}</div>
        </div>
        <div class="history-badges">${rrBadge}${wtBadge}</div>
        <div class="history-grid">
          ${rows.map(([k, v]) => `<div><span style="color:var(--text)">${k}:</span> ${v}</div>`).join('')}
        </div>
        ${e.notes ? `<div class="history-notes">${e.notes}</div>` : ''}
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────────────────────────────────────

function exportCSV() {
  if (!log.length) { alert('No entries to export yet.'); return; }
  const keys = ['date','pimo_am','pimo_pm','enalapril','furo_am','furo_pm','rr','rr_time','breathing_quality','coughing','collapse','cough_desc','appetite','food_am','food_mid','food_pm','water_intake','wet_topper','fish_oil','sardines','vomiting','urination_count','urine_color','urination_quality','straining','blood_urine','bowel_count','stool_quality','energy','gum_color','weight','notes'];
  const rows  = log.map(e => keys.map(k => {
    const v = e[k] ?? '';
    return String(v).includes(',') ? `"${v}"` : v;
  }).join(','));
  const csv  = [keys.join(','), ...rows].join('\n');
  const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a    = Object.assign(document.createElement('a'), { href: url, download: `gizmo-log-${today()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings modal
// ─────────────────────────────────────────────────────────────────────────────

function openSettings() {
  el('cfg-token').value   = cfg.token   || '';
  el('cfg-gist-id').value = cfg.gistId  || '';
  refreshGistUI();
  el('settings-modal').classList.add('open');
}

function closeSettings() {
  el('settings-modal').classList.remove('open');
}

function refreshGistUI() {
  const hasId = !!cfg.gistId;
  el('gist-no-id').style.display    = hasId ? 'none'  : 'block';
  el('gist-has-id').style.display   = hasId ? 'block' : 'none';
  el('share-section').style.display = hasId ? 'block' : 'none';
  if (hasId) {
    el('gist-id-display').textContent = cfg.gistId;
    el('share-link-box').textContent  = buildShareLink();
  }
}

function buildShareLink() {
  return `${window.location.origin}${window.location.pathname}?gist=${cfg.gistId}`;
}

async function handleCreateGist() {
  const token = el('cfg-token').value.trim();
  if (!token) { showGistMsg('Enter your GitHub token first.', 'var(--red)'); return; }
  showGistMsg('Creating Gist…', 'var(--dim)');
  const id = await gistCreate(token);
  if (!id) { showGistMsg('Failed — check your token has the gist scope.', 'var(--red)'); return; }
  cfg.token  = token;
  cfg.gistId = id;
  persistConfig();
  showGistMsg('Gist created!', 'var(--green)');
  refreshGistUI();
}

async function handleLinkGist() {
  const token = el('cfg-token').value.trim();
  const id    = el('cfg-gist-id').value.trim();
  if (!id) { showGistMsg('Enter a Gist ID.', 'var(--red)'); return; }
  cfg.token  = token;
  cfg.gistId = id;
  persistConfig();
  refreshGistUI();
  showGistMsg('Gist linked!', 'var(--green)');
}

function handleUnlinkGist() {
  if (!confirm('Unlink this Gist? Local cache is kept. You can re-link anytime.')) return;
  cfg.gistId = '';
  persistConfig();
  refreshGistUI();
  setSyncStatus('local');
}

function saveSettings() {
  cfg.token = el('cfg-token').value.trim();
  persistConfig();
  closeSettings();
  loadLog();
}

function showGistMsg(msg, color) {
  const msgEl = el('gist-msg');
  msgEl.textContent = msg;
  msgEl.style.color = color;
}

function copyShareLink() {
  navigator.clipboard.writeText(buildShareLink()).then(() => {
    const msgEl = el('copy-msg');
    msgEl.textContent = '✓ Copied to clipboard!';
    msgEl.style.color = 'var(--green)';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vet info — medications table
// ─────────────────────────────────────────────────────────────────────────────

function populateVetInfoForm() {
  renderMedsTable(vetInfo.medications?.length ? vetInfo.medications : DEFAULT_MEDS);
}

function collectVetInfoForm() {
  return {
    medications: collectMeds(),
    vetNotes: vetInfo.vetNotes || [],
  };
}

function renderMedsTable(meds) {
  const body = el('meds-table-body');
  if (!body) return;
  body.innerHTML = (meds || []).map((m, i) => `
    <div class="med-row" data-idx="${i}">
      <div class="med-col-name"><input type="text" class="med-name" value="${escHtml(m.name)}" placeholder="Medication name"></div>
      <div class="med-col-dose"><input type="text" class="med-dose" value="${escHtml(m.dose)}" placeholder="e.g. 1.25mg"></div>
      <div class="med-col-freq"><input type="text" class="med-freq" value="${escHtml(m.freq)}" placeholder="e.g. twice daily"></div>
      <div class="med-col-del"><button class="med-del" onclick="delMedRow(this)" title="Remove">✕</button></div>
    </div>`).join('');
}

function addMedRow() {
  const body = el('meds-table-body');
  const div  = document.createElement('div');
  div.className = 'med-row';
  div.innerHTML = `
    <div class="med-col-name"><input type="text" class="med-name" placeholder="Medication name"></div>
    <div class="med-col-dose"><input type="text" class="med-dose" placeholder="e.g. 1.25mg"></div>
    <div class="med-col-freq"><input type="text" class="med-freq" placeholder="e.g. twice daily"></div>
    <div class="med-col-del"><button class="med-del" onclick="delMedRow(this)" title="Remove">✕</button></div>`;
  body.appendChild(div);
  div.querySelector('.med-name').focus();
}

function delMedRow(btn) {
  btn.closest('.med-row').remove();
}

function collectMeds() {
  return Array.from(document.querySelectorAll('#meds-table-body .med-row')).map(row => ({
    name: row.querySelector('.med-name').value.trim(),
    dose: row.querySelector('.med-dose').value.trim(),
    freq: row.querySelector('.med-freq').value.trim(),
  })).filter(m => m.name);
}

async function saveVetInfo() {
  vetInfo = collectVetInfoForm();
  localInfoWrite();

  const btn = el('vi-save-btn');
  btn.textContent = '⟳ Saving…';
  btn.classList.add('saving');
  btn.disabled = true;

  await saveLog();

  btn.textContent = '✓ Saved!';
  btn.classList.remove('saving');
  btn.classList.add('saved');
  btn.disabled = false;
  setTimeout(() => { btn.textContent = 'Save Vet Info'; btn.classList.remove('saved'); }, 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vet notes
// ─────────────────────────────────────────────────────────────────────────────

function renderVetNotes() {
  const container = el('vetnotes-list');
  if (!container) return;

  const notes = (vetInfo.vetNotes || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!notes.length) {
    container.innerHTML = '<div class="empty">No vet visit notes yet.</div>';
    return;
  }

  container.innerHTML = notes.map(n => `
    <div class="history-card">
      <div class="history-date">${formatDate(n.date)}</div>
      <div style="margin-top:10px;font-size:13px;color:var(--muted);line-height:1.7;white-space:pre-wrap;">${escHtml(n.text)}</div>
    </div>`).join('');
}

async function saveVetNote() {
  const date = el('vn-date').value;
  const text = el('vn-text').value.trim();
  if (!date) { alert('Please set a visit date.'); return; }
  if (!text)  { alert('Please enter a note.'); return; }

  if (!vetInfo.vetNotes) vetInfo.vetNotes = [];
  vetInfo.vetNotes = vetInfo.vetNotes.filter(n => n.date !== date);
  vetInfo.vetNotes.push({ date, text });

  const btn = el('vn-save-btn');
  btn.textContent = '⟳ Saving…';
  btn.classList.add('saving');
  btn.disabled = true;

  await saveLog();

  el('vn-text').value = '';
  renderVetNotes();
  btn.textContent = '✓ Saved!';
  btn.classList.remove('saving');
  btn.classList.add('saved');
  btn.disabled = false;
  setTimeout(() => { btn.textContent = 'Save Note'; btn.classList.remove('saved'); }, 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  el('f-date').value = today();
  await loadLog();
  if (!Object.keys(vetInfo).length) vetInfo = { ...DEFAULT_VET_INFO };
  const todayEntry = log.find(e => e.date === today());
  if (todayEntry) setFormData(todayEntry);
})();
