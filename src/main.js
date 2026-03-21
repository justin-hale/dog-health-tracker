import './style.css'
import {
  Chart,
  LineController, LineElement, PointElement,
  BarController, BarElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
} from 'chart.js'

Chart.register(
  LineController, LineElement, PointElement,
  BarController, BarElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
)

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY     = 'gizmo-health-log-v1'
const INFO_KEY        = 'gizmo-info-v1'
const CONFIG_KEY      = 'gizmo-config-v1'
const GIST_FILE       = 'gizmo-log.json'
const INFO_FILE       = 'gizmo-info.json'
const DEFAULT_GIST_ID = '0373bd12fe6f428a93b3e69e05d46e13'

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const CHECK_IDS = ['pimo_am','pimo_pm','enalapril','furo_am','furo_pm','coughing','collapse','wet_topper','vomiting','blood_urine']
const TEXT_IDS  = ['rr','rr_time','breathing_quality','appetite','food_am','food_pm','water_intake','urination_count','urine_color','urination_quality','straining','bowel_count','stool_quality','energy','gum_color','weight','notes','collapse_trigger','collapse_duration','collapse_behavior','collapse_consciousness','collapse_recovery']
const MED_IDS   = ['pimo_am','pimo_pm','enalapril','furo_am','furo_pm']

const DEFAULT_MEDS = [
  { name: 'Pimobendan', dose: '', freq: 'twice daily' },
  { name: 'Enalapril',  dose: '', freq: 'once daily'  },
  { name: 'Furosemide', dose: '', freq: 'twice daily' },
]

const DEFAULT_VET_INFO = {
  medications: DEFAULT_MEDS,
  vetNotes: [],
}

const DEFAULT_ENTRY = {
  breathing_quality: 'Normal',
  appetite:          'Great — ate everything',
  water_intake:      'Normal',
  wet_topper:        true,
  urine_color:       'Clear / pale yellow',
  urination_quality: 'Normal stream',
  straining:         'None',
  energy:            'Normal for Gizmo',
  gum_color:         'Pink & moist',
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let log           = []
let vetInfo       = {}
let cfg           = { gistId: '', token: '' }
let coughEpisodes = []   // episodes for the currently-displayed date
const charts = {}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function el(id) {
  return document.getElementById(id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Config & persistence
// ─────────────────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    const s = localStorage.getItem(CONFIG_KEY)
    if (s) cfg = { ...cfg, ...JSON.parse(s) }
  } catch (e) {}

  const urlGist = new URLSearchParams(window.location.search).get('gist')
  if (urlGist) cfg.gistId = urlGist
  else if (!cfg.gistId && DEFAULT_GIST_ID) cfg.gistId = DEFAULT_GIST_ID
}

function persistConfig() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)) } catch (e) {}
}

function localCacheWrite() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)) } catch (e) {}
}

function localInfoWrite() {
  try { localStorage.setItem(INFO_KEY, JSON.stringify(vetInfo)) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Gist API
// ─────────────────────────────────────────────────────────────────────────────

async function gistFetchAll() {
  if (!cfg.gistId) return null
  try {
    const headers = cfg.token ? { 'Authorization': `token ${cfg.token}` } : {}
    const r = await fetch(`https://api.github.com/gists/${cfg.gistId}`, { headers })
    if (!r.ok) return null
    const g = await r.json()
    return {
      log:  g.files[GIST_FILE]?.content ? JSON.parse(g.files[GIST_FILE].content) : null,
      info: g.files[INFO_FILE]?.content ? JSON.parse(g.files[INFO_FILE].content) : null,
    }
  } catch (e) { return null }
}

async function gistPatch() {
  if (!cfg.gistId || !cfg.token) return false
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
    })
    return r.ok
  } catch (e) { return false }
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
    })
    if (!r.ok) return null
    const g = await r.json()
    return g.id
  } catch (e) { return null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Load & save
// ─────────────────────────────────────────────────────────────────────────────

async function loadLog() {
  loadConfig()
  setSyncStatus('loading')

  if (cfg.gistId) {
    const data = await gistFetchAll()
    if (data !== null) {
      if (data.log  !== null) { log     = data.log;  localCacheWrite() }
      if (data.info !== null) { vetInfo = data.info; localInfoWrite()  }
      el('hist-count').textContent = log.length
      setSyncStatus(cfg.token ? 'synced' : 'readonly')
      return
    }
    setSyncStatus('error')
  } else {
    setSyncStatus('local')
  }

  try { const s = localStorage.getItem(STORAGE_KEY); if (s) log     = JSON.parse(s) } catch (e) { log     = [] }
  try { const s = localStorage.getItem(INFO_KEY);    if (s) vetInfo = JSON.parse(s) } catch (e) { vetInfo = {} }
  el('hist-count').textContent = log.length
}

async function saveLog() {
  localCacheWrite()
  if (!cfg.gistId || !cfg.token) { setSyncStatus('local'); return true }
  setSyncStatus('loading')
  const ok = await gistPatch()
  setSyncStatus(ok ? 'synced' : 'error')
  return ok
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync status badge
// ─────────────────────────────────────────────────────────────────────────────

function setSyncStatus(state) {
  const badge = el('sync-status')
  if (!badge) return
  const map = {
    loading:  ['fa-rotate fa-spin',      'Syncing…',   'text-gray-400'],
    synced:   ['fa-cloud-arrow-up',       'Synced',     'text-green-600'],
    readonly: ['fa-eye',                  'View-only',  'text-blue-500'],
    local:    ['fa-floppy-disk',          'Local only', 'text-amber-500'],
    error:    ['fa-triangle-exclamation', 'Sync error', 'text-red-500'],
  }
  const [icon, text, color] = map[state] || map.local
  badge.innerHTML = `<i class="fa-solid ${icon} ${color} text-xs"></i><span class="${color} text-xs font-medium">${text}</span>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Form — read & write
// ─────────────────────────────────────────────────────────────────────────────

function getFormData() {
  const data = { date: el('f-date').value }
  TEXT_IDS.forEach(id  => { data[id] = el('f-' + id)?.value   || '' })
  CHECK_IDS.forEach(id => { data[id] = el('f-' + id)?.checked || false })
  // Don't persist rr_time unless an actual RR reading was entered
  if (!data.rr) data.rr_time = ''
  // Only save food section if at least one meal is populated
  if (!data.food_am && !data.food_pm) {
    data.food_am = data.food_pm = data.appetite = data.water_intake = ''
    data.wet_topper = data.vomiting = false
  }
  // Only save urination section if count >= 1
  if (!(parseInt(data.urination_count) >= 1)) {
    data.urination_count = data.urine_color = data.urination_quality = data.straining = ''
    data.blood_urine = false
  }
  // Only save bowel section if count >= 1
  if (!(parseInt(data.bowel_count) >= 1)) {
    data.bowel_count = data.stool_quality = ''
  }
  // Include cough episodes only if coughing was checked
  data.cough_episodes = data.coughing ? [...coughEpisodes] : []
  return data
}

function setFormData(data) {
  if (!data) return
  const allTextIds = ['date', ...TEXT_IDS]
  allTextIds.forEach(id => { const input = el('f-' + id); if (input) input.value = data[id] || '' })
  // Default rr_time to now when no RR has been recorded for this entry
  if (!data.rr) el('f-rr_time').value = currentTime()
  CHECK_IDS.forEach(id => {
    const input = el('f-' + id)
    if (input) { input.checked = !!data[id]; syncCheckLabel(id, !!data[id]) }
  })
  coughEpisodes = Array.isArray(data?.cough_episodes) ? [...data.cough_episodes] : []
  checkRR()
  checkGums()
  checkBlood()
  checkStraining()
  checkCollapse()
  checkCoughing()
  syncSteppers()
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkbox helpers
// ─────────────────────────────────────────────────────────────────────────────

function syncCheckLabel(id, checked) {
  const lbl = el('lbl-' + id)
  if (!lbl) return
  const dot    = lbl.querySelector('.check-dot')
  const isWarn = ['blood_urine', 'collapse'].includes(id)
  lbl.className = 'check-label' + (checked ? (isWarn ? ' checked-warn' : ' checked') : '')
  if (dot) dot.textContent = checked ? '✓' : '○'
}

function updateCheck(id) {
  syncCheckLabel(id, el('f-' + id)?.checked)
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline alert checks
// ─────────────────────────────────────────────────────────────────────────────

function checkRR() {
  const val   = parseFloat(el('f-rr').value)
  const alert = el('rr-alert')
  if (val >= 40)
    alert.innerHTML = '<div class="alert-danger"><i class="fa-solid fa-circle-exclamation shrink-0"></i>RR ≥ 40 — Go to ER immediately</div>'
  else if (val >= 30)
    alert.innerHTML = '<div class="alert-warn"><i class="fa-solid fa-triangle-exclamation shrink-0"></i>RR ≥ 30 — Call your vet today</div>'
  else
    alert.innerHTML = ''
}

function checkGums() {
  const val = el('f-gum_color').value
  el('gum-alert').innerHTML = (val.includes('White') || val.includes('Blue'))
    ? '<div class="alert-danger"><i class="fa-solid fa-circle-exclamation shrink-0"></i>Abnormal gum color — Emergency vet immediately</div>'
    : ''
}

function checkBlood() {
  el('blood-alert').innerHTML = el('f-blood_urine').checked
    ? '<div class="alert-danger"><i class="fa-solid fa-circle-exclamation shrink-0"></i>Blood in urine — call vet today</div>'
    : ''
}

function checkStraining() {
  el('strain-alert').innerHTML = el('f-straining').value === 'Significant'
    ? '<div class="alert-warn"><i class="fa-solid fa-triangle-exclamation shrink-0"></i>Significant straining — mention to vet (prostate concern)</div>'
    : ''
}

function checkCollapse() {
  el('collapse-field').style.display = el('f-collapse').checked ? 'block' : 'none'
}

// ─────────────────────────────────────────────────────────────────────────────
// Cough episode logging
// ─────────────────────────────────────────────────────────────────────────────

function checkCoughing() {
  const checked = el('f-coughing').checked
  el('cough-log-section').style.display = checked ? 'block' : 'none'
  renderCoughEpisodesList()
  updateCoughBadge()
}

function updateCoughBadge() {
  const badge = el('cough-episode-badge')
  if (!badge) return
  const count = coughEpisodes.length
  if (count > 0 && el('f-coughing').checked) {
    badge.textContent = count
    badge.classList.remove('hidden')
    badge.classList.add('inline-flex')
  } else {
    badge.classList.add('hidden')
    badge.classList.remove('inline-flex')
  }
}

function renderCoughEpisodesList() {
  const list = el('cough-episodes-list')
  if (!list) return
  if (!coughEpisodes.length) { list.innerHTML = ''; return }
  list.innerHTML = coughEpisodes.map((ep, i) => {
    const pills = [ep.type, ep.context, ep.severity].filter(Boolean)
    return `
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
        <span class="font-medium text-gray-500 shrink-0">${ep.time || '—'}</span>
        <span class="flex flex-wrap gap-1 flex-1">
          ${pills.map(p => `<span class="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">${escHtml(p)}</span>`).join('')}
        </span>
        <button onclick="removeCoughEpisode(${i})" class="shrink-0 text-gray-300 hover:text-red-400 transition-colors">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`
  }).join('')
}

function removeCoughEpisode(index) {
  coughEpisodes.splice(index, 1)
  renderCoughEpisodesList()
  updateCoughBadge()
}

function openCoughSheet() {
  el('cough-time').value = currentTime()
  // Clear all selections
  document.querySelectorAll('#cough-sheet .cough-toggle-btn, #cough-sheet .cough-pill-btn')
    .forEach(b => b.classList.remove('selected'))
  el('cough-sheet').style.display = 'block'
}

function closeCoughSheet() {
  el('cough-sheet').style.display = 'none'
}

function selectCoughToggle(btn) {
  const group = btn.dataset.group
  document.querySelectorAll(`[data-group="${group}"]`).forEach(b => b.classList.remove('selected'))
  btn.classList.add('selected')
}

function logCoughEpisode() {
  const time     = el('cough-time').value
  const typeEl   = document.querySelector('[data-group="cough-type"].selected')
  const ctxEl    = document.querySelector('[data-group="cough-context"].selected')
  const sevEl    = document.querySelector('[data-group="cough-severity"].selected')
  if (!typeEl) { alert('Please select a cough type.'); return }
  coughEpisodes.push({
    time:     time     || currentTime(),
    type:     typeEl?.dataset.value  || '',
    context:  ctxEl?.dataset.value   || '',
    severity: sevEl?.dataset.value   || '',
  })
  renderCoughEpisodesList()
  updateCoughBadge()
  closeCoughSheet()
}

function stepCount(id, delta) {
  const hidden  = el('f-' + id)
  const display = el('f-' + id + '-display')
  const next    = Math.max(0, (parseInt(hidden.value) || 0) + delta)
  hidden.value  = next
  if (display) display.textContent = next
}

function syncSteppers() {
  ;['urination_count', 'bowel_count'].forEach(id => {
    const hidden  = el('f-' + id)
    const display = el('f-' + id + '-display')
    if (hidden && display) display.textContent = hidden.value || '0'
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Date change — populate form from existing entry
// ─────────────────────────────────────────────────────────────────────────────

function onDateChange() {
  const date     = el('f-date').value
  const existing = log.find(e => e.date === date)
  setFormData(existing ?? { date, ...DEFAULT_ENTRY })
}

// ─────────────────────────────────────────────────────────────────────────────
// Save daily entry
// ─────────────────────────────────────────────────────────────────────────────

async function saveEntry() {
  const data = getFormData()
  if (!data.date) { alert('Please set a date before saving.'); return }

  log = log.filter(e => e.date !== data.date)
  log.push(data)
  log.sort((a, b) => b.date.localeCompare(a.date))

  const btn = el('save-btn')
  btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin mr-2"></i>Saving…'
  btn.disabled = true

  await saveLog()

  el('hist-count').textContent = log.length
  btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Saved!'
  btn.classList.add('saved')
  btn.disabled = false
  setTimeout(() => {
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Save Today\'s Log'
    btn.classList.remove('saved')
  }, 2500)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  ;['today', 'trends', 'history', 'vetinfo', 'vetnotes', 'careguide'].forEach(t => {
    el('pane-' + t).style.display = tab === t ? 'block' : 'none'
    el('tab-'  + t).className     = 'tab ' + (tab === t ? 'active' : 'inactive')
  })
  el('save-footer').style.display = tab === 'today' ? 'block' : 'none'
  if (tab === 'trends')   renderTrends()
  if (tab === 'history')  renderHistory()
  if (tab === 'vetinfo')  populateVetInfoForm()
  if (tab === 'vetnotes') { renderVetNotes(); el('vn-date').value = today() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit entry from history
// ─────────────────────────────────────────────────────────────────────────────

function editEntry(date) {
  const entry = log.find(e => e.date === date)
  if (!entry) return
  setFormData(entry)
  switchTab('today')
  el('pane-today').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Trends — Chart.js
// ─────────────────────────────────────────────────────────────────────────────

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id] }
}

function renderTrends() {
  const DAYS_BACK = 30
  const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date))
  const recent = sorted.slice(-DAYS_BACK)

  const emptyHtml = '<p class="text-center text-gray-400 text-sm py-8 col-span-full">No entries yet — start logging today to see trends.</p>'

  if (!recent.length) {
    document.querySelectorAll('[id^="chart-"][id$="-wrap"]').forEach(w => {
      w.innerHTML = emptyHtml
    })
    return
  }

  const labels = recent.map(e => {
    const d = new Date(e.date + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })

  const scaleX = {
    ticks: { maxTicksLimit: 8, color: '#9ca3af', font: { size: 11 } },
    grid:  { color: '#f3f4f6' },
  }
  const scaleY = {
    ticks: { color: '#9ca3af', font: { size: 11 } },
    grid:  { color: '#f3f4f6' },
  }
  const commonLine = { tension: 0.35, spanGaps: true, pointRadius: 3, pointHoverRadius: 5, fill: true }
  const chartOpts  = (extra = {}) => ({
    responsive: true,
    maintainAspectRatio: true,
    interaction: { intersect: false, mode: 'index' },
    plugins: { legend: { display: false } },
    scales: { x: scaleX, y: { ...scaleY, ...extra } },
  })

  // ── 0. Collapse Episodes calendar ────────────────────────────────────────
  const collapseSummaryEl = el('collapse-summary-content')
  if (collapseSummaryEl) {
    const todayStr = today()
    const calEnd   = new Date(todayStr + 'T12:00:00')
    const calStart = new Date(calEnd)
    calStart.setDate(calStart.getDate() - 29)

    const logMap = {}
    log.forEach(e => { logMap[e.date] = e })

    const calDays = []
    for (let d = new Date(calStart); d <= calEnd; d.setDate(d.getDate() + 1)) {
      const y   = d.getFullYear()
      const m   = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      calDays.push({ dateStr: `${y}-${m}-${day}`, num: d.getDate(), dow: d.getDay() })
    }

    const totalCollapse = calDays.filter(d => logMap[d.dateStr]?.collapse).length
    const startPad = calDays[0].dow

    const headers = ['S','M','T','W','T','F','S']
      .map(h => `<div class="text-center text-xs font-medium text-gray-400 pb-1">${h}</div>`)
      .join('')

    const pads = Array(startPad).fill('<div></div>').join('')

    const cells = calDays.map(({ dateStr, num }) => {
      const entry      = logMap[dateStr]
      const isCollapse = entry?.collapse
      const isToday    = dateStr === todayStr
      if (isCollapse) {
        return `<div class="aspect-video flex items-center justify-center rounded-md bg-red-600 text-white text-xs font-bold cursor-pointer hover:bg-red-700 transition-colors" onclick="showCollapseDay('${dateStr}')" title="Collapse — tap for details">${num}</div>`
      } else if (entry) {
        return `<div class="aspect-video flex items-center justify-center rounded-md ${isToday ? 'bg-blue-100 text-blue-700 font-semibold' : 'bg-gray-100 text-gray-500'} text-xs cursor-pointer hover:bg-gray-200 transition-colors" onclick="showCollapseDay('${dateStr}')">${num}</div>`
      } else {
        return `<div class="aspect-video flex items-center justify-center text-xs text-gray-300">${num}</div>`
      }
    }).join('')

    const titleEl = el('collapse-card-title')
    if (titleEl) {
      titleEl.innerHTML = totalCollapse > 0
        ? `${totalCollapse} Collapse Episode${totalCollapse !== 1 ? 's' : ''} <span class="section-subtitle">in last 30 days</span>`
        : 'Collapse Episodes'
    }

    collapseSummaryEl.innerHTML = `
      <div class="grid grid-cols-7 gap-1">
        ${headers}${pads}${cells}
      </div>
      <div class="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded bg-red-600"></span>Collapse</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded bg-gray-100 border border-gray-200"></span>Logged</span>
        <span class="flex items-center gap-1.5 text-gray-300">· No entry</span>
      </div>
      <div id="collapse-day-detail" class="mt-3"></div>`
  }

  // ── 1. Respiratory Rate ──────────────────────────────────────────────────
  destroyChart('chart-rr')
  el('chart-rr-wrap').innerHTML = '<canvas id="chart-rr"></canvas>'
  charts['chart-rr'] = new Chart(el('chart-rr'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'RR (bpm)',
          data: recent.map(e => parseFloat(e.rr) || null),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.07)',
          ...commonLine,
        },
        {
          label: 'ER (40)',
          data: recent.map(() => 40),
          borderColor: 'rgba(239,68,68,0.45)',
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
        {
          label: 'Vet call (30)',
          data: recent.map(() => 30),
          borderColor: 'rgba(234,179,8,0.6)',
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
        {
          label: 'Collapse',
          data: recent.map(e => e.collapse ? (parseFloat(e.rr) || 12) : null),
          borderColor: '#dc2626',
          backgroundColor: '#dc2626',
          pointStyle: 'crossRot',
          pointRadius: 9,
          pointHoverRadius: 11,
          showLine: false,
          fill: false,
        },
      ],
    },
    options: {
      ...chartOpts({ min: 10, max: 55 }),
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { boxWidth: 14, font: { size: 11 }, color: '#6b7280' },
        },
      },
    },
  })

  // ── 1b. Cough Episodes (stacked bar by type) ─────────────────────────────
  destroyChart('chart-cough')
  el('chart-cough-wrap').innerHTML = '<canvas id="chart-cough"></canvas>'
  const hasCoughData = recent.some(e => (e.cough_episodes || []).length > 0)
  if (hasCoughData) {
    charts['chart-cough'] = new Chart(el('chart-cough'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Dry',
            data: recent.map(e => (e.cough_episodes || []).filter(ep => ep.type === 'Dry').length),
            backgroundColor: 'rgba(59,130,246,0.85)',
          },
          {
            label: 'Productive',
            data: recent.map(e => (e.cough_episodes || []).filter(ep => ep.type === 'Productive').length),
            backgroundColor: 'rgba(245,158,11,0.85)',
          },
          {
            label: 'Post-drink',
            data: recent.map(e => (e.cough_episodes || []).filter(ep => ep.type === 'Post-drink').length),
            backgroundColor: 'rgba(16,185,129,0.85)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: { ...scaleX, stacked: true },
          y: { ...scaleY, stacked: true, min: 0, ticks: { ...scaleY.ticks, stepSize: 1 } },
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { boxWidth: 14, font: { size: 11 }, color: '#6b7280' },
          },
        },
      },
    })
  } else {
    el('chart-cough-wrap').innerHTML = '<p class="text-center text-gray-400 text-sm py-8">No cough episodes recorded yet</p>'
  }

  // ── 2. Weight ────────────────────────────────────────────────────────────
  destroyChart('chart-weight')
  const weightData = recent.map(e => parseFloat(e.weight) || null)
  el('chart-weight-wrap').innerHTML = '<canvas id="chart-weight"></canvas>'
  if (weightData.some(v => v !== null)) {
    charts['chart-weight'] = new Chart(el('chart-weight'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Weight (lbs)',
          data: weightData,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.07)',
          ...commonLine,
        }],
      },
      options: chartOpts(),
    })
  } else {
    el('chart-weight-wrap').innerHTML = '<p class="text-center text-gray-400 text-sm py-8">No weight data recorded yet</p>'
  }

  // ── 3. Daily Food Intake ─────────────────────────────────────────────────
  destroyChart('chart-food')
  el('chart-food-wrap').innerHTML = '<canvas id="chart-food"></canvas>'
  const appetiteColor = a => {
    if (!a)                    return 'rgba(16,185,129,0.35)'
    if (a.startsWith('Great')) return 'rgba(5,150,105,0.90)'
    if (a.startsWith('Good'))  return 'rgba(16,185,129,0.70)'
    if (a.startsWith('Fair'))  return 'rgba(52,211,153,0.50)'
    return                            'rgba(110,231,183,0.35)'
  }
  charts['chart-food'] = new Chart(el('chart-food'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total food (cups)',
        data: recent.map(e => {
          const t = (parseFloat(e.food_am) || 0) + (parseFloat(e.food_pm) || 0)
          return t || null
        }),
        backgroundColor: recent.map(e => appetiteColor(e.appetite)),
        borderColor:     recent.map(e => appetiteColor(e.appetite).replace(/[\d.]+\)$/, '1)')),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...chartOpts({ min: 0 }),
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: ctx => {
              const appetite = recent[ctx.dataIndex]?.appetite
              return appetite ? `Appetite: ${appetite.split('—')[0].trim()}` : ''
            },
          },
        },
      },
    },
  })

  // ── 4. Urination Count ───────────────────────────────────────────────────
  destroyChart('chart-urination')
  el('chart-urination-wrap').innerHTML = '<canvas id="chart-urination"></canvas>'
  const strainingColor = s => {
    if (s === 'Significant') return 'rgba(154,52,18,0.80)'
    if (s === 'Mild')        return 'rgba(245,158,11,0.85)'
    return                          'rgba(245,158,11,0.50)'
  }
  charts['chart-urination'] = new Chart(el('chart-urination'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Times urinated',
        data: recent.map(e => parseInt(e.urination_count) || null),
        backgroundColor: recent.map(e => strainingColor(e.straining)),
        borderColor:     recent.map(e => strainingColor(e.straining).replace(/[\d.]+\)$/, '1)')),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...chartOpts({ min: 0, ticks: { stepSize: 1, color: '#9ca3af', font: { size: 11 } } }),
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: ctx => {
              const straining = recent[ctx.dataIndex]?.straining
              return straining ? `Straining: ${straining}` : ''
            },
          },
        },
      },
    },
  })

  // ── 5. Energy Level ──────────────────────────────────────────────────────
  destroyChart('chart-energy')
  el('chart-energy-wrap').innerHTML = '<canvas id="chart-energy"></canvas>'
  const energyData = recent.map(e => {
    if (!e.energy) return null
    if (e.energy.startsWith('High'))     return 5
    if (e.energy.startsWith('Normal'))   return 4
    if (e.energy.startsWith('Lower'))    return 3
    if (e.energy.startsWith('Lethargic') || e.energy === 'Lethargic') return 2
    if (e.energy.startsWith('Very let')) return 1
    return null
  })
  charts['chart-energy'] = new Chart(el('chart-energy'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Energy',
        data: energyData,
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139,92,246,0.07)',
        ...commonLine,
      }],
    },
    options: {
      ...chartOpts(),
      scales: {
        x: scaleX,
        y: {
          ...scaleY,
          min: 0,
          max: 6,
          ticks: {
            stepSize: 1,
            color: '#9ca3af',
            font: { size: 10 },
            callback: v => ({ 1: 'Very low', 2: 'Lethargic', 3: 'Lower', 4: 'Normal', 5: 'High' }[v] || ''),
          },
        },
      },
    },
  })

  // ── 6. Medication Compliance ─────────────────────────────────────────────
  destroyChart('chart-meds')
  el('chart-meds-wrap').innerHTML = '<canvas id="chart-meds"></canvas>'
  charts['chart-meds'] = new Chart(el('chart-meds'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Meds given (%)',
        data: recent.map(e => Math.round((MED_IDS.filter(k => e[k]).length / 5) * 100)),
        backgroundColor: recent.map(e => {
          const pct = MED_IDS.filter(k => e[k]).length / 5
          return pct >= 1 ? 'rgba(22,163,74,0.7)' : pct >= 0.6 ? 'rgba(234,179,8,0.7)' : 'rgba(239,68,68,0.7)'
        }),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: chartOpts({ min: 0, max: 100, ticks: { callback: v => v + '%', color: '#9ca3af', font: { size: 11 } } }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// History pane
// ─────────────────────────────────────────────────────────────────────────────

function renderHistory() {
  const container = el('history-list')
  if (!log.length) {
    container.innerHTML = '<p class="text-center text-gray-400 py-10">No entries yet — start logging today!</p>'
    return
  }

  container.innerHTML = log.map(e => {
    const rrNum   = parseFloat(e.rr)
    const rrBadge       = e.rr       ? `<span class="badge ${rrNum >= 30 ? 'badge-rr-warn' : 'badge-rr-ok'}">RR ${e.rr} bpm</span>` : ''
    const wtBadge       = e.weight   ? `<span class="badge badge-weight">${e.weight} lbs</span>` : ''
    const collapseBadge = e.collapse ? `<span class="badge badge-collapse"><i class="fa-solid fa-person-falling mr-1"></i>Collapse</span>` : ''
    const medCount = MED_IDS.filter(k => e[k]).length

    const rows = [
      e.appetite          ? ['Appetite',  e.appetite.split('—')[0].trim()]  : null,
      e.energy            ? ['Energy',    e.energy.split('—')[0].trim()]    : null,
      e.urination_count   ? ['Urinated',  e.urination_count + 'x']          : null,
      e.urination_quality ? ['Stream',    e.urination_quality]              : null,
      e.straining         ? ['Straining', e.straining]                      : null,
      e.gum_color         ? ['Gums',      e.gum_color]                      : null,
      e.stool_quality     ? ['Stool',     e.stool_quality]                  : null,
      ['Meds', `${medCount}/5`],
    ].filter(Boolean)

    return `
      <div class="section-card">
        <div class="flex items-start justify-between mb-1.5">
          <div class="font-semibold text-gray-900">${formatDate(e.date)}</div>
          <button onclick="editEntry('${e.date}')" class="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-colors" title="Edit this entry">
            <i class="fa-solid fa-pen-to-square"></i>Edit
          </button>
        </div>
        ${(collapseBadge || rrBadge || wtBadge) ? `<div class="flex gap-1.5 flex-wrap mb-2">${collapseBadge}${rrBadge}${wtBadge}</div>` : ''}
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-2">
          ${rows.map(([k, v]) => `
            <div class="flex justify-between gap-2">
              <span class="text-gray-400 shrink-0">${k}</span>
              <span class="text-gray-800 font-medium text-right truncate">${escHtml(v)}</span>
            </div>`).join('')}
        </div>
        ${e.notes ? `<div class="mt-2 pt-2 border-t border-gray-100 text-sm text-gray-500 leading-relaxed">${escHtml(e.notes)}</div>` : ''}
      </div>`
  }).join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────────────────────────────────────

function exportCSV() {
  if (!log.length) { alert('No entries to export yet.'); return }
  const keys = ['date','pimo_am','pimo_pm','enalapril','furo_am','furo_pm','rr','rr_time','breathing_quality','coughing','collapse','collapse_trigger','collapse_duration','collapse_behavior','collapse_consciousness','collapse_recovery','appetite','food_am','food_mid','food_pm','water_intake','wet_topper','fish_oil','sardines','vomiting','urination_count','urine_color','urination_quality','straining','blood_urine','bowel_count','stool_quality','energy','gum_color','weight','notes']
  const rows = log.map(e => keys.map(k => {
    const v = e[k] ?? ''
    return String(v).includes(',') ? `"${v}"` : v
  }).join(','))
  const csv = [keys.join(','), ...rows].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a   = Object.assign(document.createElement('a'), { href: url, download: `gizmo-log-${today()}.csv` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings modal
// ─────────────────────────────────────────────────────────────────────────────

function openSettings() {
  el('cfg-token').value   = cfg.token  || ''
  el('cfg-gist-id').value = cfg.gistId || ''
  refreshGistUI()
  el('settings-modal').style.display = 'flex'
}

function closeSettings() {
  el('settings-modal').style.display = 'none'
}

function refreshGistUI() {
  const hasId = !!cfg.gistId
  el('gist-no-id').style.display    = hasId ? 'none'  : 'block'
  el('gist-has-id').style.display   = hasId ? 'block' : 'none'
  el('share-section').style.display = hasId ? 'block' : 'none'
  if (hasId) {
    el('gist-id-display').textContent = cfg.gistId
    el('share-link-box').textContent  = buildShareLink()
  }
}

function buildShareLink() {
  return `${window.location.origin}${window.location.pathname}?gist=${cfg.gistId}`
}

async function handleCreateGist() {
  const token = el('cfg-token').value.trim()
  if (!token) { showGistMsg('Enter your GitHub token first.', 'text-red-500'); return }
  showGistMsg('Creating Gist…', 'text-gray-400')
  const id = await gistCreate(token)
  if (!id) { showGistMsg('Failed — check your token has the gist scope.', 'text-red-500'); return }
  cfg.token  = token
  cfg.gistId = id
  persistConfig()
  showGistMsg('Gist created!', 'text-green-600')
  refreshGistUI()
}

async function handleLinkGist() {
  const token = el('cfg-token').value.trim()
  const id    = el('cfg-gist-id').value.trim()
  if (!id) { showGistMsg('Enter a Gist ID.', 'text-red-500'); return }
  cfg.token  = token
  cfg.gistId = id
  persistConfig()
  refreshGistUI()
  showGistMsg('Gist linked!', 'text-green-600')
}

function handleUnlinkGist() {
  if (!confirm('Unlink this Gist? Local cache is kept. You can re-link anytime.')) return
  cfg.gistId = ''
  persistConfig()
  refreshGistUI()
  setSyncStatus('local')
}

function saveSettings() {
  cfg.token = el('cfg-token').value.trim()
  persistConfig()
  closeSettings()
  loadLog()
}

function showGistMsg(msg, colorClass) {
  const msgEl = el('gist-msg')
  msgEl.textContent = msg
  msgEl.className = `text-sm mt-2 ${colorClass}`
}

function copyShareLink() {
  navigator.clipboard.writeText(buildShareLink()).then(() => {
    const msgEl = el('copy-msg')
    msgEl.textContent = 'Copied to clipboard!'
    setTimeout(() => { msgEl.textContent = '' }, 3000)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Vet info — medications table
// ─────────────────────────────────────────────────────────────────────────────

function populateVetInfoForm() {
  renderMedsTable(vetInfo.medications?.length ? vetInfo.medications : DEFAULT_MEDS)
}

function collectVetInfoForm() {
  return {
    medications: collectMeds(),
    vetNotes: vetInfo.vetNotes || [],
  }
}

function renderMedsTable(meds) {
  const body = el('meds-table-body')
  if (!body) return
  body.innerHTML = (meds || []).map((m, i) => `
    <div class="med-row flex gap-2 items-center mb-2" data-idx="${i}">
      <input type="text" class="med-name form-input flex-1 min-w-0" value="${escHtml(m.name)}" placeholder="Medication name">
      <input type="text" class="med-dose form-input w-24 shrink-0" value="${escHtml(m.dose)}" placeholder="Dose">
      <input type="text" class="med-freq form-input w-28 shrink-0" value="${escHtml(m.freq)}" placeholder="Frequency">
      <button class="p-2 text-gray-400 hover:text-red-500 transition-colors shrink-0" onclick="delMedRow(this)" title="Remove">
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    </div>`).join('')
}

function addMedRow() {
  const body = el('meds-table-body')
  const div  = document.createElement('div')
  div.className = 'med-row flex gap-2 items-center mb-2'
  div.innerHTML = `
    <input type="text" class="med-name form-input flex-1 min-w-0" placeholder="Medication name">
    <input type="text" class="med-dose form-input w-24 shrink-0" placeholder="Dose">
    <input type="text" class="med-freq form-input w-28 shrink-0" placeholder="Frequency">
    <button class="p-2 text-gray-400 hover:text-red-500 transition-colors shrink-0" onclick="delMedRow(this)" title="Remove">
      <i class="fa-solid fa-trash-can text-xs"></i>
    </button>`
  body.appendChild(div)
  div.querySelector('.med-name').focus()
}

function delMedRow(btn) {
  btn.closest('.med-row').remove()
}

function collectMeds() {
  return Array.from(document.querySelectorAll('#meds-table-body .med-row')).map(row => ({
    name: row.querySelector('.med-name').value.trim(),
    dose: row.querySelector('.med-dose').value.trim(),
    freq: row.querySelector('.med-freq').value.trim(),
  })).filter(m => m.name)
}

async function saveVetInfo() {
  vetInfo = collectVetInfoForm()
  localInfoWrite()

  const btn = el('vi-save-btn')
  btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin mr-2"></i>Saving…'
  btn.classList.add('saving')
  btn.disabled = true

  await saveLog()

  btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Saved!'
  btn.classList.remove('saving')
  btn.classList.add('saved')
  btn.disabled = false
  setTimeout(() => {
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Save Vet Info'
    btn.classList.remove('saved')
  }, 2500)
}

// ─────────────────────────────────────────────────────────────────────────────
// Vet notes
// ─────────────────────────────────────────────────────────────────────────────

function renderVetNotes() {
  const container = el('vetnotes-list')
  if (!container) return

  const notes = (vetInfo.vetNotes || []).slice().sort((a, b) => b.date.localeCompare(a.date))
  if (!notes.length) {
    container.innerHTML = '<p class="text-center text-gray-400 py-8">No vet visit notes yet.</p>'
    return
  }

  container.innerHTML = notes.map(n => `
    <div class="section-card">
      <div class="font-semibold text-gray-900 mb-2">${formatDate(n.date)}</div>
      <div class="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">${escHtml(n.text)}</div>
    </div>`).join('')
}

async function saveVetNote() {
  const date = el('vn-date').value
  const text = el('vn-text').value.trim()
  if (!date) { alert('Please set a visit date.'); return }
  if (!text)  { alert('Please enter a note.'); return }

  if (!vetInfo.vetNotes) vetInfo.vetNotes = []
  vetInfo.vetNotes = vetInfo.vetNotes.filter(n => n.date !== date)
  vetInfo.vetNotes.push({ date, text })

  const btn = el('vn-save-btn')
  btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin mr-2"></i>Saving…'
  btn.classList.add('saving')
  btn.disabled = true

  await saveLog()

  el('vn-text').value = ''
  renderVetNotes()
  btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Saved!'
  btn.classList.remove('saving')
  btn.classList.add('saved')
  btn.disabled = false
  setTimeout(() => {
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Save Note'
    btn.classList.remove('saved')
  }, 2500)
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapse calendar day detail
// ─────────────────────────────────────────────────────────────────────────────

function showCollapseDay(dateStr) {
  const detailEl = el('collapse-day-detail')
  if (!detailEl) return

  const entry = log.find(e => e.date === dateStr)
  if (!entry) return

  // Toggle off if same day clicked again
  if (detailEl.dataset.date === dateStr && detailEl.innerHTML) {
    detailEl.innerHTML = ''
    detailEl.dataset.date = ''
    return
  }
  detailEl.dataset.date = dateStr

  const collapseFields = [
    entry.collapse_trigger      ? ['Trigger',       entry.collapse_trigger]      : null,
    entry.collapse_duration     ? ['Duration',      entry.collapse_duration]     : null,
    entry.collapse_behavior     ? ['What happened', entry.collapse_behavior]     : null,
    entry.collapse_consciousness ? ['Consciousness', entry.collapse_consciousness] : null,
    entry.collapse_recovery     ? ['Recovery',      entry.collapse_recovery]     : null,
  ].filter(Boolean)

  const isCollapse = entry.collapse
  detailEl.innerHTML = `
    <div class="pt-3 border-t ${isCollapse ? 'border-red-200' : 'border-gray-100'}">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold ${isCollapse ? 'text-red-700' : 'text-gray-600'}">${formatDate(dateStr)}</span>
        ${isCollapse ? '<span class="badge badge-collapse text-xs"><i class="fa-solid fa-person-falling mr-1"></i>Collapse</span>' : ''}
      </div>
      ${collapseFields.length ? `
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-2">
          ${collapseFields.map(([k, v]) => `
            <div>
              <div class="text-gray-400 mb-0.5">${k}</div>
              <div class="text-gray-700 font-medium">${escHtml(v)}</div>
            </div>`).join('')}
        </div>` : ''}
      ${entry.notes ? `
        <div class="text-xs">
          <div class="text-gray-400 mb-0.5">Notes</div>
          <div class="text-gray-700">${escHtml(entry.notes)}</div>
        </div>` : ''}
    </div>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

;(async () => {
  el('f-date').value = today()
  await loadLog()
  if (!Object.keys(vetInfo).length) vetInfo = { ...DEFAULT_VET_INFO }
  const todayEntry = log.find(e => e.date === today())
  setFormData(todayEntry ?? { date: today(), ...DEFAULT_ENTRY })
})()

// ─────────────────────────────────────────────────────────────────────────────
// Expose to global scope for inline HTML event handlers
// ─────────────────────────────────────────────────────────────────────────────

Object.assign(window, {
  switchTab,
  saveEntry,
  editEntry,
  exportCSV,
  openSettings,
  closeSettings,
  saveSettings,
  handleCreateGist,
  handleLinkGist,
  handleUnlinkGist,
  copyShareLink,
  addMedRow,
  delMedRow,
  saveVetInfo,
  saveVetNote,
  updateCheck,
  checkRR,
  checkGums,
  checkBlood,
  checkStraining,
  checkCollapse,
  checkCoughing,
  openCoughSheet,
  closeCoughSheet,
  selectCoughToggle,
  logCoughEpisode,
  removeCoughEpisode,
  onDateChange,
  showCollapseDay,
  stepCount,
})
