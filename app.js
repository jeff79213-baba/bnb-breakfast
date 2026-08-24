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
    if ('adult' in r) {
      out.push({ roomNumber: no, source: r.source || '', status: r.status || '', eggMilk: r.eggMilk || '', vegan: r.vegan || '', adult: r.adult || '', child: r.child || '', mealTime: r.mealTime || '', payStatus: (r.payStatus === '已付' || r.payStatus === '待付') ? r.payStatus : '', breakfastType: validType(r.breakfastType) ? r.breakfastType : 'normal' });
    } else {
      out.push({ roomNumber: no, breakfastType: validType(r.breakfastType) ? r.breakfastType : 'normal' });
    }
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
  if (isBreakfast8Mode()) {
    let hot = 0, normal = 0, addon = 0, completed = 0;
    for (const r of state.rooms) {
      if (isAddon(r)) addon++;
      else if (isHotMeal(r)) hot++;
      else if (isNormalMeal(r)) normal++;
      else normal++; // 續住不加購等歸一般
      if (getStatus(dateKey, r.roomNumber) === STATUS.COMPLETED) completed++;
    }
    const total = state.rooms.length;
    return { hot, normal, addon, completed, pending: total - completed, total };
  }
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
  if ($('statAddon')) $('statAddon').textContent = s.addon ?? 0;
  $('statDone').textContent = s.completed;
  $('statPending').textContent = s.pending;

  $('progressLabel').textContent = `${s.completed} / ${s.total} 間`;
  const pct = s.total ? Math.round(s.completed / s.total * 100) : 0;
  $('progressBar').style.width = pct + '%';

  // 熟食警示橫幅（簡約線條）
  const banner = $('hotAlertBanner');
  let hotPending = 0;
  if (isBreakfast8Mode()) hotPending = state.rooms.filter(r => isHotMeal(r) && getStatus(tk, r.roomNumber) === STATUS.PENDING).length;
  else hotPending = state.rooms.filter(r => r.breakfastType === 'hot' && getStatus(tk, r.roomNumber) === STATUS.PENDING).length;
  banner.classList.remove('hidden');
  if (hotPending > 0) {
    banner.textContent = `尚有 ${hotPending} 間熟食未用餐`;
    banner.className = 'hot-banner alert';
  } else {
    banner.textContent = s.hot > 0 ? '熟食已全數用餐完成' : '今日尚無熟食房號';
    banner.className = 'hot-banner ok';
  }

  // 空白狀態
  const empty = state.rooms.length === 0;
  $('emptyState').classList.toggle('hidden', !empty);
  // 8欄模式兩欄同時顯示，不用 chips 篩選
  if (isBreakfast8Mode()) $('filterChips').classList.add('hidden');
  else $('filterChips').classList.toggle('hidden', empty);
  banner.classList.toggle('hidden', empty);

  renderGrid(tk);
}

function isBreakfast8Mode() { return state.rooms.length && state.rooms[0] && 'adult' in state.rooms[0]; }
let mealEditTarget = null;
let mealEditMode = 'addon'; // addon | revert
let mealPayChoice = '待付'; // 已付 | 待付
function updatePayButtons() {
  const paid = $('payPaidBtn'), unpaid = $('payUnpaidBtn');
  if (mealPayChoice === '已付') {
    paid.style.background = '#2f9e44'; paid.style.borderColor = '#2f9e44'; paid.style.color = '#fff';
    unpaid.style.background = '#fff'; unpaid.style.borderColor = '#dee2e6'; unpaid.style.color = '#212529';
  } else {
    unpaid.style.background = '#e8590c'; unpaid.style.borderColor = '#e8590c'; unpaid.style.color = '#fff';
    paid.style.background = '#fff'; paid.style.borderColor = '#dee2e6'; paid.style.color = '#212529';
  }
}
function isAddon(r) { return r.eggMilk === '加購'; }
function isHotMeal(r) { return !isAddon(r) && !!(r.adult || r.child) && r.vegan !== '不加購'; }
function isNormalMeal(r) { return r.vegan === '不加購'; }
// 兩欄定向滑動：首次滑動方向決定鎖定上下或左右，避免斜向亂飄
// 手機：touch 依起始 12px 判斷主軸，鎖定後強制另一軸 scroll 不動；電腦：wheel 亦做同樣定向
function attachDirectionLock(el) {
  let sx = 0, sy = 0, locked = null;
  let startLeft = 0, startTop = 0;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    locked = null;
    startLeft = el.scrollLeft; startTop = el.scrollTop;
    el.classList.remove('drag-lock-v', 'drag-lock-h');
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (!locked) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      el.classList.toggle('drag-lock-h', locked === 'h');
      el.classList.toggle('drag-lock-v', locked === 'v');
    }
    // 鎖定後強制另一軸維持在起點，達成只有上下或只有左右
    if (locked === 'v' && el.scrollLeft !== startLeft) el.scrollLeft = startLeft;
    if (locked === 'h' && el.scrollTop !== startTop) el.scrollTop = startTop;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    locked = null;
    el.classList.remove('drag-lock-v', 'drag-lock-h');
  }, { passive: true });
  el.addEventListener('touchcancel', () => {
    locked = null;
    el.classList.remove('drag-lock-v', 'drag-lock-h');
  }, { passive: true });
  // 電腦滾輪/觸控板：若同時有 X/Y 偏移，只保留主方向
  el.addEventListener('wheel', e => {
    const absX = Math.abs(e.deltaX), absY = Math.abs(e.deltaY);
    if (absX > 2 && absY > 2) {
      if (absX > absY) e.preventDefault(), el.scrollLeft += e.deltaX;
      else e.preventDefault(), el.scrollTop += e.deltaY;
    }
  }, { passive: false });
}
function renderGrid(tk) {
  const grid = $('roomGrid');
  // 8欄兩欄模式：熟食｜一般 每房一橫排
  if (isBreakfast8Mode()) {
    // 讓兩欄寬度與橘棒一致：取消 grid 原有卡片佈局
    grid.style.display = 'block';
    grid.style.gridTemplateColumns = 'none';
    const all = sortRooms(state.rooms);
    const hotList = all.filter(r => isHotMeal(r) || isAddon(r));
    const normalList = all.filter(isNormalMeal);
    // 已/未用餐同時顯示，僅用樣式區分
    const mkRow = (r) => {
      const st = getStatus(tk, r.roomNumber);
      const done = st === STATUS.COMPLETED;
      const isAdd = isAddon(r);
      const isNoAdd = r.vegan === '不加購';
      // 匯入即加購（無付款狀態）→ 黃底「加購」；現場改加購 → 房號下方顯示 已付/待付
      const yellowBadge = (isAdd && !r.payStatus) ? '<span style="background:#fcc419;color:#664d03;font-size:10px;padding:1px 4px;border-radius:4px;margin-left:4px">加購</span>' : '';
      const payLine = (isAdd && r.payStatus) ? `<div style="font-size:12px;font-weight:800;margin-top:2px;color:${r.payStatus === '已付' ? '#2f9e44' : '#e8590c'}">${r.payStatus}</div>` : '';
      return `<tr data-room="${escapeHtml(r.roomNumber)}" class="${done ? 'row-done' : ''}" style="cursor:pointer;${done ? 'opacity:.45;background:#e7f5ff' : ''}${isAdd ? 'outline:2px solid #fcc419' : ''}">
        <td style="padding:8px 4px;font-weight:900">${escapeHtml(r.roomNumber)}${yellowBadge}${payLine}</td>
        <td style="font-size:12px">${escapeHtml(r.source || '')}</td>
        <td style="font-size:11px">${r.status ? `<span style="background:#ffe3e3;color:#c92a2a;padding:1px 5px;border-radius:999px">${escapeHtml(r.status)}</span>` : ''}</td>
        <td style="font-size:12px">${escapeHtml(r.eggMilk || '')}${isAdd ? `<button data-revert="${escapeHtml(r.roomNumber)}" style="margin-left:4px;background:#fff;border:1px solid #868e96;border-radius:6px;font-size:11px;padding:1px 6px">改</button>` : ''}</td>
        <td style="font-size:12px">${escapeHtml(r.vegan || '')}${isNoAdd ? `<button data-addon="${escapeHtml(r.roomNumber)}" style="margin-left:4px;background:#fff3bf;border:1px solid #fcc419;border-radius:6px;font-size:11px;padding:1px 6px">改</button>` : ''}</td>
        <td style="text-align:center;font-weight:700">${escapeHtml(r.adult || '')}</td>
        <td style="text-align:center">${escapeHtml(r.child || '')}</td>
        <td style="font-size:12px">${escapeHtml(r.mealTime || '')}</td>
        <td style="text-align:center">${done ? '<span class="line-check" style="border-color:#1971c2"></span>' : '<span class="line-pending"></span>'}</td>
      </tr>`;
    };
    const hotRows = hotList.map(mkRow).join('') || '<tr><td colspan=9 style="text-align:center;padding:20px;color:#868e96">無熟食</td></tr>';
    const normalRows = normalList.map(mkRow).join('') || '<tr><td colspan=9 style="text-align:center;padding:20px;color:#868e96">無一般</td></tr>';
    // 上方四按鈕同時顯示，不做單欄篩選 - 僅顯示數字
    grid.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:100%">
        <div style="background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 2px 5px rgba(0,0,0,.07)">
          <div style="background:#e8590c;color:#fff;text-align:center;padding:10px;font-weight:900;font-size:18px;letter-spacing:2px">熟食</div>
          <div class="pane-scroll" data-pane="hot">
            <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#fff1e7;font-size:11px"><th>房號</th><th>來源</th><th>狀態</th><th>蛋奶</th><th>全素</th><th>大人</th><th>小孩</th><th>時間</th><th></th></tr></thead><tbody>${hotRows}</tbody></table>
          </div>
        </div>
        <div style="background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 2px 5px rgba(0,0,0,.07)">
          <div style="background:#2f9e44;color:#fff;text-align:center;padding:10px;font-weight:900;font-size:18px;letter-spacing:2px">一般</div>
          <div class="pane-scroll" data-pane="normal">
            <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#ebfbee;font-size:11px"><th>房號</th><th>來源</th><th>狀態</th><th>蛋奶</th><th>全素</th><th>大人</th><th>小孩</th><th>時間</th><th></th></tr></thead><tbody>${normalRows}</tbody></table>
          </div>
        </div>
      </div>`;
    grid.querySelectorAll('.pane-scroll').forEach(attachDirectionLock);
    // 點排切換已用餐；不加購用「改」按鈕另改
    grid.querySelectorAll('tr[data-room]').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-addon]')) return; // 改按鈕不觸發切換
      const next = toggleStatus(tk, tr.dataset.room);
      if (navigator.vibrate) navigator.vibrate(next === STATUS.COMPLETED ? 20 : 8);
      toast(next === STATUS.COMPLETED ? `✅ ${tr.dataset.room} 已用餐` : `↩️ ${tr.dataset.room} 已取消`, 1200);
    }));
    grid.querySelectorAll('[data-addon]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const room = state.rooms.find(x => x.roomNumber === btn.dataset.addon);
      if (!room) return;
      mealEditTarget = room.roomNumber;
      mealEditMode = 'addon';
      $('mealEditTitle').textContent = `房號 ${room.roomNumber} 改為加購`;
      $('mealEditHint').textContent = `來源：${room.source || ''}　此房原為不加購，改為加購後請輸入大人小孩數量`;
      $('mealAdultInput').value = room.adult || '';
      $('mealChildInput').value = room.child || '';
      $('mealAdultInput').disabled = false; $('mealChildInput').disabled = false;
      mealPayChoice = '待付';
      updatePayButtons();
      $('mealSaveBtn').textContent = '確認改為加購';
      openModal('mealEditModal');
    }));
    grid.querySelectorAll('[data-revert]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const room = state.rooms.find(x => x.roomNumber === btn.dataset.revert);
      if (!room) return;
      mealEditTarget = room.roomNumber;
      mealEditMode = 'revert';
      $('mealEditTitle').textContent = `房號 ${room.roomNumber} 改回不加購`;
      $('mealEditHint').textContent = `來源：${room.source || ''}　此房目前為加購 ${room.adult || 0}/${room.child || 0}${room.payStatus ? `（${room.payStatus}）` : ''}，確認改回不加購？`;
      $('mealAdultInput').value = room.adult || '';
      $('mealChildInput').value = room.child || '';
      $('mealAdultInput').disabled = true; $('mealChildInput').disabled = true;
      $('mealSaveBtn').textContent = '確認改回不加購';
      openModal('mealEditModal');
    }));
    return;
  }
  // 切回卡片模式時恢復 grid 樣式
  grid.style.display = '';
  grid.style.gridTemplateColumns = '';
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

// ===== 早餐統計 8欄專用解析（102~512可視+規則）=====
function parseBreakfastMatrix(matrix, sheetMeta) {
  // sheetMeta: { hiddenRows:Set }
  if (!matrix || !matrix.length) return null;
  const norm = matrix.map(row => (Array.isArray(row) ? row : [row]).map(c => String(c ?? '').trim()));
  // 找標題列含 房號
  let hr = -1;
  for (let i = 0; i < Math.min(5, norm.length); i++) {
    if (norm[i].some(c => c.includes('房號'))) { hr = i; break; }
  }
  if (hr === -1) return null;
  // 判斷是否為 8欄版（有 來源/蛋奶素/全素/大人/小孩/用餐時間）
  const header = norm[hr];
  const has8 = header.some(c => /來源|訂單來源/.test(c)) && header.some(c => /大人/.test(c));
  if (!has8) return null;

  const hiddenRows = sheetMeta?.hiddenRows || new Set();
  const rows = [];
  const issues = [];
  for (let i = hr + 1; i < norm.length; i++) {
    const excelRowNum = i + 1; // 1-indexed
    if (hiddenRows.has(excelRowNum)) continue;
    const r = norm[i];
    // 物理欄 B~H 對應 matrix 1~7 (A=0)
    const roomRaw = (r[1] || '').trim();
    if (!/^\d+$/.test(roomRaw)) continue;
    const rn = parseInt(roomRaw, 10);
    if (!(102 <= rn && rn <= 512)) continue;
    const src = (r[2] || '').trim();
    let pD = (r[3] || '').trim(), pE = (r[4] || '').trim(), pF = (r[5] || '').trim(), pG = (r[6] || '').trim(), pH = (r[7] || '').trim();
    let 住宿狀態 = '', 蛋奶素 = '', 全素 = '', 大人 = '', 小孩 = '', 用餐時間 = pH;
    const is_bu = (pE === '不' && pF === '加' && pG === '購');
    const is_xu = (pD === '續住' && is_bu);
    if (is_xu) { 住宿狀態 = '續住'; 全素 = '不加購'; }
    else if (is_bu) {
      if (pD === '續住') 住宿狀態 = '續住';
      else if (pD) 蛋奶素 = pD;
      全素 = '不加購';
    } else {
      if (pD === '續住') { 住宿狀態 = '續住'; 全素 = pE; 大人 = pF; 小孩 = pG; }
      else if (pD === '加購') { 蛋奶素 = '加購'; 全素 = pE; 大人 = pF; 小孩 = pG; }
      else { 蛋奶素 = pD; 全素 = pE; 大人 = pF; 小孩 = pG; }
    }
    // 轉為舊 rooms 格式 + 擴充欄位
    const breakfastType = (大人 || 小孩) ? 'normal' : (全素 === '不加購' ? 'normal' : 'normal');
    // 用成人>0 判斷是否需要熱食？此處統一 normal，後續依大人/小孩顯示
    rows.push({ roomNumber: roomRaw, source: src, status: 住宿狀態, eggMilk: 蛋奶素, vegan: 全素, adult: 大人, child: 小孩, mealTime: 用餐時間, breakfastType, raw: r });
  }
  // 依房號排序
  rows.sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber));
  return { rows, issues, isBreakfast8: true };
}

// ===== Excel 解析（支援 .xlsx / .xls 二進位）=====
function isExcelFile(file) {
  return /\.xlsx?$/i.test(file.name || '');
}

function parseFromMatrix(matrix) {
  if (!matrix || !matrix.length) return null;
  // 正規化為字串二維陣列，並過濾全空白列
  const norm = matrix.map(row => (Array.isArray(row) ? row : [row]).map(c => String(c ?? '').trim()));
  const rows2d = norm.filter(r => r.some(c => c !== ''));
  if (!rows2d.length) return null;

  const first = rows2d[0];
  const hasHeader = first.some(c => /房|room/i.test(c) || /早|餐|類|type|breakfast/i.test(c));
  let roomCol = 0, typeCol = 1, startIdx = 0;
  if (hasHeader) {
    roomCol = first.findIndex(c => /房|room/i.test(c));
    typeCol = first.findIndex(c => /早|餐|類|type|breakfast/i.test(c));
    if (roomCol < 0) roomCol = 0;
    if (typeCol < 0) typeCol = roomCol === 0 ? 1 : 0;
    startIdx = 1;
  }

  const rows = [], issues = [];
  const seen = new Set();
  for (let i = startIdx; i < rows2d.length; i++) {
    const cells = rows2d[i];
    const no = normalizeRoomNo(cells[roomCol]);
    const rawType = cells[typeCol] ?? '';
    if (!no) { issues.push(`第 ${i + 1} 列：房號空白，已略過`); continue; }
    const t = mapBreakfast(rawType);
    if (!t) { issues.push(`第 ${i + 1} 列：「${rawType || '空白'}」無法判斷早餐種類，已略過`); continue; }
    if (seen.has(no)) { issues.push(`第 ${i + 1} 列：房號 ${no} 重複，以最後一筆為準`); }
    seen.add(no);
    rows.push({ roomNumber: no, breakfastType: t, rawType });
  }
  return { rows, issues, hasHeader };
}

async function parseExcelFile(file) {
  if (typeof XLSX === 'undefined') throw new Error('XLSX 未載入：請確認網路連線後重新整理');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  if (!wb.SheetNames.length) throw new Error('Excel 無工作表');
  // 優先找 早餐統計
  let targetName = wb.SheetNames.find(n => n.includes('早餐')) || wb.SheetNames[0];
  let sheet = wb.Sheets[targetName];
  let hiddenRows = new Set();
  if (sheet['!rows']) {
    sheet['!rows'].forEach((r, idx) => { if (r && r.hidden) hiddenRows.add(idx + 1); });
  }
  let matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  let parsed8 = parseBreakfastMatrix(matrix, { hiddenRows });
  if (parsed8 && parsed8.rows.length) return parsed8;
  // 若非 8欄，嘗試遍歷其他 sheet
  for (const name of wb.SheetNames) {
    if (name === targetName) continue;
    const s = wb.Sheets[name];
    const hr = new Set();
    if (s['!rows']) s['!rows'].forEach((r, idx) => { if (r && r.hidden) hr.add(idx + 1); });
    const m = XLSX.utils.sheet_to_json(s, { header: 1, defval: '', raw: false, blankrows: false });
    const p = parseBreakfastMatrix(m, { hiddenRows: hr });
    if (p && p.rows.length) return p;
  }
  // 退回舊通用解析
  return parseFromMatrix(matrix);
}

function showImportPreview(parsed) {
  importDraft = parsed;
  if (parsed.isBreakfast8) {
    // 8欄預覽
    $('importSummary').innerHTML = `共判讀到 <b>${parsed.rows.length}</b> 間（102~512可視）<br>已套用規則：不|加|購→不加購、續住→住宿狀態`;
    $('importIssues').innerHTML = parsed.issues.slice(0, 8).map(i => `<div class="issue">${escapeHtml(i)}</div>`).join('') + (parsed.issues.length > 8 ? `<div class="issue">…另有 ${parsed.issues.length - 8} 項</div>` : '');
    $('importPreviewList').innerHTML = `<div style="overflow:auto"><table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th>房號</th><th>來源</th><th>狀態</th><th>蛋奶素</th><th>全素</th><th>大人</th><th>小孩</th><th>時間</th></tr>` + parsed.rows.slice(0, 40).map(r => `<tr><td>${escapeHtml(r.roomNumber)}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.eggMilk)}</td><td>${escapeHtml(r.vegan)}</td><td>${escapeHtml(r.adult)}</td><td>${escapeHtml(r.child)}</td><td>${escapeHtml(r.mealTime)}</td></tr>`).join('') + `</table>` + (parsed.rows.length > 40 ? `<div class="hint" style="text-align:center;padding:6px">…其餘 ${parsed.rows.length - 40} 筆</div>` : '') + `</div>`;
  } else {
    const hotCount = parsed.rows.filter(r => r.breakfastType === 'hot').length;
    $('importSummary').innerHTML = `共判讀到 <b>${parsed.rows.length}</b> 筆房號<br>` + `🔥 熱食 ${hotCount} 間　🥐 一般 ${parsed.rows.length - hotCount} 間`;
    $('importIssues').innerHTML = parsed.issues.slice(0, 8).map(i => `<div class="issue">${escapeHtml(i)}</div>`).join('') + (parsed.issues.length > 8 ? `<div class="issue">…另有 ${parsed.issues.length - 8} 項提示</div>` : '');
    $('importPreviewList').innerHTML = parsed.rows.slice(0, 30).map(r => {
      const info = typeInfo(r.breakfastType);
      return `<div class="pv-row"><b>${escapeHtml(r.roomNumber)}</b><span>${info.emoji} ${info.label}</span></div>`;
    }).join('') + (parsed.rows.length > 30 ? `<div class="pv-row hint">…其餘 ${parsed.rows.length - 30} 筆</div>` : '');
  }
  closeModal('menuModal');
  openModal('importModal');
}

function handleFile(file) {
  if (isExcelFile(file)) {
    parseExcelFile(file).then(parsed => {
      if (!parsed || !parsed.rows.length) {
        toast(`❌ 無法從 Excel 判讀出房號資料${parsed?.issues?.length ? '：' + parsed.issues[0] : '（請確認第一欄為房號、第二欄為早餐種類：熱食/一般）'}`, 4000);
        return;
      }
      showImportPreview(parsed);
    }).catch(err => {
      console.error(err);
      const msg = err && err.message ? err.message : '檔案讀取失敗';
      toast(`❌ Excel 讀取失敗：${msg}`, 4000);
    });
    return;
  }
  // CSV / TXT 舊邏輯
  readFileSmart(file).then(text => {
    const parsed = parseImport(text);
    if (!parsed || !parsed.rows.length) {
      toast(`❌ 無法從檔案判讀出房號資料${parsed?.issues?.length ? '：' + parsed.issues[0] : ''}`, 4000);
      return;
    }
    showImportPreview(parsed);
  }).catch(() => toast('❌ 檔案讀取失敗'));
}

function confirmImport() {
  if (!importDraft) return;
  if (importDraft.isBreakfast8) {
    // 8欄存法：保留完整欄位
    state.rooms = sortRooms(importDraft.rows.map(r => ({
      roomNumber: r.roomNumber, source: r.source, status: r.status, eggMilk: r.eggMilk, vegan: r.vegan, adult: r.adult, child: r.child, mealTime: r.mealTime, payStatus: '', breakfastType: (r.adult || r.child) ? 'hot' : 'normal'
    })));
  } else {
    state.rooms = sortRooms(importDraft.rows.map(r => ({ roomNumber: r.roomNumber, breakfastType: r.breakfastType })));
  }
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

  // 不加購改加購 / 加購改回（同欄位位置）
  $('payPaidBtn').addEventListener('click', () => { mealPayChoice = '已付'; updatePayButtons(); });
  $('payUnpaidBtn').addEventListener('click', () => { mealPayChoice = '待付'; updatePayButtons(); });
  $('mealCancelBtn').addEventListener('click', () => { mealEditTarget = null; $('mealAdultInput').disabled = false; $('mealChildInput').disabled = false; closeModal('mealEditModal'); });
  $('mealSaveBtn').addEventListener('click', () => {
    const room = state.rooms.find(r => r.roomNumber === mealEditTarget);
    if (!room) return;
    if (mealEditMode === 'revert') {
      room.eggMilk = '';
      room.vegan = '不加購';
      room.adult = '';
      room.child = '';
      room.payStatus = '';
      saveState();
      $('mealAdultInput').disabled = false; $('mealChildInput').disabled = false;
      closeModal('mealEditModal'); mealEditTarget = null; render();
      toast(`↩️ ${room.roomNumber} 已改回不加購`);
      return;
    }
    const a = $('mealAdultInput').value.trim();
    const c = $('mealChildInput').value.trim();
    if (a === '' && c === '') { toast('請輸入大人或小孩數量'); return; }
    room.eggMilk = '加購';
    room.vegan = '';
    room.adult = a;
    room.child = c;
    room.payStatus = mealPayChoice;
    saveState();
    closeModal('mealEditModal');
    mealEditTarget = null;
    render();
    toast(`✅ ${room.roomNumber} 已改為加購 ${a}/${c}（${mealPayChoice}）`);
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
