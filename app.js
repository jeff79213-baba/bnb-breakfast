'use strict';

/* =========================================================
   民宿早餐房號管理系統
   本機優先、離線優先（localStorage）
   localStorage 前綴：rnb_（房號與早餐專用，避免跨專案衝突）
   ========================================================= */

// ===== 常數 =====
const STORAGE_KEY = 'rnb_data_v1';
const DEFAULT_TYPES = [
  { id: 'hot',    label: '熱食',     emoji: '🔥' },
  { id: 'normal', label: '一般早餐', emoji: '🥐' }
];
const STATUS = { PENDING: 'pending', COMPLETED: 'completed' };

let state = null;
let currentFilter = 'all';       // all | hot | normal | pending | completed | hot-pending
let importDraft = null;          // 匯入預覽暫存
let roomModalTarget = null;      // 編輯中的房號

const $ = (id) => document.getElementById(id);

// ===== 預設狀態 / 載入 / 儲存 =====
function defaultState() {
  return {
    version: 1,
    settings: { types: JSON.parse(JSON.stringify(DEFAULT_TYPES)) },
    rooms: [],        // [{ roomNumber:'101', breakfastType:'hot' }]
    daily: {}         // { '2026-08-23': { '101':'completed' } } 未記錄者視為 pending
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return defaultState();
    const base = defaultState();
    return {
      version: 1,
      settings: { types: Array.isArray(data.settings?.types) && data.settings.types.length ? data.settings.types : base.settings.types },
      rooms: Array.isArray(data.rooms) ? sanitizeRooms(data.rooms) : [],
      daily: (data.daily && typeof data.daily === 'object') ? data.daily : {}
    };
  } catch (e) {
    console.error('資料載入失敗', e);
    toast('⚠️ 本機資料讀取異常，已重設為空白');
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    toast('❌ 儲存失敗：裝置空間可能不足');
  }
}

function sanitizeRooms(rooms) {
  const seen = new Set();
  const out = [];
  for (const r of rooms) {
    const no = normalizeRoomNo(r?.roomNumber ?? r?.roomNumber);
    if (!no || seen.has(no)) continue;
    seen.add(no);
    out.push({ roomNumber: no, breakfastType: validType(r.breakfastType) ? r.breakfastType : 'normal' });
  }
  return sortRooms(out);
}

// ===== 工具 =====
function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtToday(key) {
  const [y, m, d] = key.split('-').map(Number);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return `${y}/${m}/${String(d).padStart(2, '0')}（週${wd}）`;
}

function normalizeRoomNo(v) {
  return String(v ?? '').trim().replace(/\s+/g, '');
}

function validType(t) {
  return state ? state.settings.types.some(x => x.id === t) : DEFAULT_TYPES.some(x => x.id === t);
}

function typeInfo(t) {
  return state.settings.types.find(x => x.id === t) || state.settings.types[0];
}

function numericAwareSort(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  const bothNum = !isNaN(na) && !isNaN(nb) && String(na) === a && String(nb) === b;
  if (bothNum) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortRooms(list) {
  return [...list].sort((x, y) => numericAwareSort(x.roomNumber, y.roomNumber));
}

// ===== 核心邏輯（純函式，方便日後補單元測試）=====
function getStatus(dateKey, roomNumber) {
  return state.daily[dateKey]?.[roomNumber] ?? STATUS.PENDING;
}

function setStatus(dateKey, roomNumber, status) {
  if (!state.daily[dateKey]) state.daily[dateKey] = {};
  state.daily[dateKey][roomNumber] = status;
  saveState();
  render();
}

function toggleStatus(dateKey, roomNumber) {
  const next = getStatus(dateKey, roomNumber) === STATUS.COMPLETED ? STATUS.PENDING : STATUS.COMPLETED;
  setStatus(dateKey, roomNumber, next);
  return next;
}

function computeStats(dateKey) {
  let hot = 0, normal = 0, completed = 0;
  for (const r of state.rooms) {
    if (r.breakfastType === 'hot') hot++;
    else normal++;
    if (getStatus(dateKey, r.roomNumber) === STATUS.COMPLETED) completed++;
  }
  const total = state.rooms.length;
  return { hot, normal, completed, pending: total - completed, total };
}

function filterRooms(dateKey, filter) {
  const list = state.rooms.filter(r => {
    const st = getStatus(dateKey, r.roomNumber);
    switch (filter) {
      case 'hot': return r.breakfastType === 'hot';
      case 'normal': return r.breakfastType !== 'hot';
      case 'pending': return st === STATUS.PENDING;
      case 'completed': return st === STATUS.COMPLETED;
      case 'hot-pending': return r.breakfastType === 'hot' && st === STATUS.PENDING;
      default: return true;
    }
  });
  return sortRooms(list);
}

// ===== 渲染 =====
function render() {
  const tk = todayKey();
  $('todayLabel').textContent = fmtToday(tk);
  const s = computeStats(tk);

  $('statHot').textContent = s.hot;
  $('statNormal').textContent = s.normal;
  $('statDone').textContent = s.completed;
  $('statPending').textContent = s.pending;

  $('progressLabel').textContent = `${s.completed} / ${s.total} 間`;
  const pct = s.total ? Math.round(s.completed / s.total * 100) : 0;
  $('progressBar').style.width = pct + '%';

  // 熱食警示橫幅
  const banner = $('hotAlertBanner');
  const hotPending = state.rooms.filter(r => r.breakfastType === 'hot' && getStatus(tk, r.roomNumber) === STATUS.PENDING).length;
  banner.classList.remove('hidden');
  if (hotPending > 0) {
    banner.textContent = `🔥 尚有 ${hotPending} 間熱食未用餐，點此查看`;
    banner.className = 'hot-banner alert';
  } else {
    banner.textContent = s.hot > 0 ? '🔥✅ 熱食已全數用餐完成' : '🥐 今日尚無熱食房號';
    banner.className = 'hot-banner ok';
  }

  // 空白狀態
  const empty = state.rooms.length === 0;
  $('emptyState').classList.toggle('hidden', !empty);
  $('filterChips').classList.toggle('hidden', empty);
  banner.classList.toggle('hidden', empty);

  renderGrid(tk);
}

function renderGrid(tk) {
  const grid = $('roomGrid');
  const rooms = filterRooms(tk, currentFilter);
  const html = rooms.map(r => {
    const st = getStatus(tk, r.roomNumber);
    const done = st === STATUS.COMPLETED;
    const info = typeInfo(r.breakfastType);
    const isHot = r.breakfastType === 'hot';
    return `
      <div class="card ${isHot ? 'hot' : 'normal'} ${done ? 'completed' : 'pending'} ${(!done && isHot) ? 'hot-pending' : ''}" data-room="${escapeHtml(r.roomNumber)}">
        <button class="edit-btn" data-edit="${escapeHtml(r.roomNumber)}" aria-label="編輯">✎</button>
        <div class="num">${escapeHtml(r.roomNumber)}</div>
        <div><span class="type-badge">${info.emoji} ${info.label}</span></div>
        <div class="status-line">${done ? '✅ 已用餐' : '⏳ 尚未用餐'}</div>
      </div>`;
  }).join('');
  grid.innerHTML = html;

  if (rooms.length === 0 && state.rooms.length > 0) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#868e96;padding:40px 0;">此篩選條件下沒有房號</p>`;
  }

  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === currentFilter);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== Toast =====
let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ===== Modal 控制 =====
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) bd.classList.add('hidden'); });
});

// ===== 房號管理 =====
function fillTypeSelect(sel) {
  sel.innerHTML = state.settings.types.map(t => `<option value="${t.id}">${t.emoji} ${t.label}</option>`).join('');
}

function openManage() {
  fillTypeSelect($('newRoomType'));
  renderManageList();
  openModal('manageModal');
}

function renderManageList() {
  const wrap = $('manageList');
  if (!state.rooms.length) {
    wrap.innerHTML = '<p class="hint" style="text-align:center;padding:16px 0;">目前沒有房號</p>';
    return;
  }
  wrap.innerHTML = sortRooms(state.rooms).map(r => {
    const opts = state.settings.types.map(t =>
      `<option value="${t.id}" ${t.id === r.breakfastType ? 'selected' : ''}>${t.emoji} ${t.label}</option>`).join('');
    return `
      <div class="manage-item">
        <span class="room-no">${escapeHtml(r.roomNumber)}</span>
        <select data-type-for="${escapeHtml(r.roomNumber)}">${opts}</select>
        <button class="del-btn" data-del="${escapeHtml(r.roomNumber)}">✕</button>
      </div>`;
  }).join('');
}

function addRoomsFromInput() {
  const raw = $('newRoomInput').value;
  const type = $('newRoomType').value;
  const tokens = raw.split(/[,，、\s\n;；]+/).map(normalizeRoomNo).filter(Boolean);
  if (!tokens.length) { toast('請先輸入房號'); return; }

  const existing = new Set(state.rooms.map(r => r.roomNumber));
  let added = 0, dup = [];
  for (const no of tokens) {
    if (existing.has(no)) { dup.push(no); continue; }
    existing.add(no);
    state.rooms.push({ roomNumber: no, breakfastType: type });
    added++;
  }
  state.rooms = sortRooms(state.rooms);
  saveState();
  render();
  renderManageList();
  $('newRoomInput').value = '';

  let msg = `已新增 ${added} 間房號`;
  if (dup.length) msg += `；重複略過：${dup.slice(0, 5).join('、')}${dup.length > 5 ? '…' : ''}`;
  toast(msg);
}

// ===== 匯入 =====
function sniffDelimiter(line) {
  const counts = { ',': (line.match(/,/g) || []).length, '\t': (line.match(/\t/g) || []).length, ';': (line.match(/;/g) || []).length };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
}

function splitLine(line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function mapBreakfast(v) {
  const s = String(v ?? '').toLowerCase();
  if (/熱/.test(s) || /^hot/.test(s)) return 'hot';
  if (/一般|普通|常態|標準/.test(s) || /^normal|^regular|^std/.test(s)) return 'normal';
  return null;
}

async function readFileSmart(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  text = text.replace(/^\uFEFF/, '');
  if ((text.match(/\uFFFD/g) || []).length > 3) {
    try { text = new TextDecoder('big5').decode(buf); } catch (_) {}
  }
  return text;
}

function parseImport(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const delim = sniffDelimiter(lines[0]);
  let startIdx = 0;
  const firstCells = splitLine(lines[0], delim);

  // 判斷是否有標題列
  const hasHeader = firstCells.some(c => /房|room/i.test(c) || /早|餐|type|breakfast/i.test(c));
  let roomCol = 0, typeCol = 1;
  if (hasHeader) {
    roomCol = firstCells.findIndex(c => /房|room/i.test(c));
    typeCol = firstCells.findIndex(c => /早|餐|類|type|breakfast/i.test(c));
    if (roomCol < 0) roomCol = 0;
    if (typeCol < 0) typeCol = roomCol === 0 ? 1 : 0;
    startIdx = 1;
  }

  const rows = [], issues = [];
  const seen = new Set();
  for (let i = startIdx; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const no = normalizeRoomNo(cells[roomCol]);
    const rawType = cells[typeCol] ?? '';
    if (!no) { issues.push(`第 ${i + 1} 列：房號空白，已略過`); continue; }
    const t = mapBreakfast(rawType);
    if (!t) { issues.push(`第 ${i + 1} 列：「${rawType || '空白'}」無法判斷早餐種類，已略過`); continue; }
    if (seen.has(no)) { issues.push(`第 ${i + 1} 列：房號 ${no} 重複，以最後一筆為準`); }
    seen.add(no);
    rows.push({ roomNumber: no, breakfastType: t, rawType });
  }
  return { rows, issues, delim, hasHeader };
}

function handleFile(file) {
  readFileSmart(file).then(text => {
    const parsed = parseImport(text);
    if (!parsed || !parsed.rows.length) {
      toast(`❌ 無法從檔案判讀出房號資料${parsed?.issues?.length ? '：' + parsed.issues[0] : ''}`, 4000);
      return;
    }
    importDraft = parsed;
    const hotCount = parsed.rows.filter(r => r.breakfastType === 'hot').length;

    $('importSummary').innerHTML =
      `共判讀到 <b>${parsed.rows.length}</b> 筆房號<br>` +
      `🔥 熱食 ${hotCount} 間　🥐 一般 ${parsed.rows.length - hotCount} 間`;

    $('importIssues').innerHTML = parsed.issues.slice(0, 8)
      .map(i => `<div class="issue">${escapeHtml(i)}</div>`).join('')
      + (parsed.issues.length > 8 ? `<div class="issue">…另有 ${parsed.issues.length - 8} 項提示</div>` : '');

    $('importPreviewList').innerHTML = parsed.rows.slice(0, 30).map(r => {
      const info = typeInfo(r.breakfastType);
      return `<div class="pv-row"><b>${escapeHtml(r.roomNumber)}</b><span>${info.emoji} ${info.label}</span></div>`;
    }).join('') + (parsed.rows.length > 30 ? `<div class="pv-row hint">…其餘 ${parsed.rows.length - 30} 筆</div>` : '');

    closeModal('menuModal');
    openModal('importModal');
  }).catch(() => toast('❌ 檔案讀取失敗'));
}

function confirmImport() {
  if (!importDraft) return;
  state.rooms = sortRooms(importDraft.rows.map(r => ({ roomNumber: r.roomNumber, breakfastType: r.breakfastType })));
  saveState();
  render();
  closeModal('importModal');
  importDraft = null;
  $('fileInput').value = '';
  toast(`✅ 已匯入 ${state.rooms.length} 間房號`);
}

// ===== 匯出 =====
function exportToday() {
  const tk = todayKey();
  if (!state.rooms.length) { toast('目前沒有房號可匯出'); return; }
  const rows = [['日期', '房號', '早餐種類', '用餐狀態']];
  for (const r of sortRooms(state.rooms)) {
    const done = getStatus(tk, r.roomNumber) === STATUS.COMPLETED;
    rows.push([tk.replace(/-/g, '/'), r.roomNumber, typeInfo(r.breakfastType).label, done ? '已用餐' : '未用餐']);
  }
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `早餐紀錄_${tk}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  closeModal('menuModal');
  toast('📤 已匯出今日紀錄');
}

// ===== 事件綁定 =====
function bindEvents() {
  // 卡片點擊＝一鍵切換用餐狀態（核心操作）
  $('roomGrid').addEventListener('click', e => {
    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) { e.stopPropagation(); openRoomModal(editBtn.dataset.edit); return; }
    const card = e.target.closest('.card');
    if (!card) return;
    const next = toggleStatus(todayKey(), card.dataset.room);
    if (navigator.vibrate) navigator.vibrate(next === STATUS.COMPLETED ? 20 : 8);
    toast(next === STATUS.COMPLETED ? `✅ ${card.dataset.room} 已用餐` : `↩️ ${card.dataset.room} 已取消`, 1200);
  });

  // 篩選
  $('filterChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    currentFilter = chip.dataset.filter;
    renderGrid(todayKey());
  });

  document.querySelectorAll('.stat-card[data-filter]').forEach(el => {
    el.addEventListener('click', () => { currentFilter = el.dataset.filter; renderGrid(todayKey()); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  });

  $('hotAlertBanner').addEventListener('click', () => {
    if ($('hotAlertBanner').classList.contains('alert')) {
      currentFilter = 'hot-pending';
      renderGrid(todayKey());
      $('roomGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // 選單
  $('menuBtn').addEventListener('click', () => openModal('menuModal'));
  $('menuCloseBtn').addEventListener('click', () => closeModal('menuModal'));
  $('menuManageBtn').addEventListener('click', () => { closeModal('menuModal'); openManage(); });
  $('menuImportBtn').addEventListener('click', () => { closeModal('menuModal'); $('fileInput').click(); });
  $('menuExportBtn').addEventListener('click', exportToday);

  $('emptyAddBtn').addEventListener('click', openManage);
  $('emptyImportBtn').addEventListener('click', () => $('fileInput').click());

  // 管理房號
  $('addRoomBtn').addEventListener('click', addRoomsFromInput);
  $('newRoomInput').addEventListener('keydown', e => { if (e.key === 'Enter') addRoomsFromInput(); });
  $('manageCloseBtn').addEventListener('click', () => { closeModal('manageModal'); render(); });

  $('manageList').addEventListener('change', e => {
    const sel = e.target.closest('select[data-type-for]');
    if (!sel) return;
    const room = state.rooms.find(r => r.roomNumber === sel.dataset.typeFor);
    if (room) { room.breakfastType = sel.value; saveState(); render(); }
  });
  $('manageList').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const no = del.dataset.del;
    if (!confirm(`確定要刪除房號 ${no} 嗎？\n（該房歷史用餐紀錄會保留在資料中）`)) return;
    state.rooms = state.rooms.filter(r => r.roomNumber !== no);
    saveState();
    renderManageList();
    render();
    toast(`已刪除房號 ${no}`);
  });

  // 匯入
  $('fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });
  $('importConfirmBtn').addEventListener('click', confirmImport);
  $('importCancelBtn').addEventListener('click', () => { importDraft = null; closeModal('importModal'); $('fileInput').value = ''; });

  // 單一房號編輯
  $('roomSaveBtn').addEventListener('click', () => {
    const room = state.rooms.find(r => r.roomNumber === roomModalTarget);
    if (room) { room.breakfastType = $('roomModalType').value; saveState(); render(); }
    closeModal('roomModal');
    toast('已更新');
  });
  $('roomCloseBtn').addEventListener('click', () => closeModal('roomModal'));
  $('roomDeleteBtn').addEventListener('click', () => {
    if (!confirm(`確定要刪除房號 ${roomModalTarget} 嗎？`)) return;
    state.rooms = state.rooms.filter(r => r.roomNumber !== roomModalTarget);
    saveState();
    render();
    closeModal('roomModal');
    toast(`已刪除房號 ${roomModalTarget}`);
  });
}

function openRoomModal(roomNo) {
  roomModalTarget = roomNo;
  const room = state.rooms.find(r => r.roomNumber === roomNo);
  if (!room) return;
  $('roomModalTitle').textContent = `房號 ${roomNo}`;
  fillTypeSelect($('roomModalType'));
  $('roomModalType').value = room.breakfastType;
  openModal('roomModal');
}

// ===== PWA =====
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW 註冊失敗', err));
  });
}

// ===== 啟動 =====
state = loadState();
bindEvents();
render();
