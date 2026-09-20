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
const C = window.BreakfastCore;

// ===== 預設狀態 / 載入 / 儲存 =====
// ===== 備料區預設比例（新式計算公式，均可在備料區更改）=====
const DEFAULT_PREP = {
  jellyRatio: 1.1,    // 果凍奶酪：總量 ＝ 總人數 × 比例
  jellyStock: 0,      // 果凍剩餘庫存（果凍應做 ＝ 果凍需要 − 果凍庫存）
  cheeseStock: 0,     // 奶酪剩餘庫存（奶酪應做 ＝ 奶酪需要 − 奶酪庫存）
  cheeseDiv: 4,       // 奶酪需要 ＝ 總量 / cheeseDiv（單一品項）
  jellyItems: {},     // 果凍各品項分配 {品項: 數量}
  eggRatio: 1.5,      // 茶葉蛋：應煮 ＝ 總人數×比例 − 庫存 ＋ 預留顆數 ＋ 比例×預留%
  eggStock: 0,        // 茶葉蛋剩餘庫存
  eggExtra: 0,        // 無滿房預留多煮（顆）
  eggReservePct: 0,   // 無滿房預留多煮（％）
  riceAdult: 0.2,     // 主食新式：飯/粥 = 大人×riceAdult + 小孩×riceChild
  riceChild: 0.1,
  porridgeAdult: 0.2,
  porridgeChild: 0.1,
  specialDiv: 12      // 特殊主食 = (大人 + 小孩×0.5) / specialDiv
};

// 果凍品項（固定9項，奶酪為單一品項不拆分）
const JELLY_ITEMS = ['葡萄果凍', '草莓果凍', '布丁', '仙草蜜', '紅/綠豆湯', '巧克力布丁', '百香果蒟蒻', '銀耳蓮子', '檸檬愛玉'];

function defaultState() {
  return {
    version: 1,
    settings: {
      types: JSON.parse(JSON.stringify(DEFAULT_TYPES)),
      prep: Object.assign({}, DEFAULT_PREP),
      mealSlots: []
    },
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
      settings: {
        types: Array.isArray(data.settings?.types) && data.settings.types.length ? data.settings.types : base.settings.types,
        prep: Object.assign({}, DEFAULT_PREP, (data.settings && data.settings.prep) || {}),
        mealSlots: C ? C.sortSlots(Array.isArray(data.settings?.mealSlots) ? data.settings.mealSlots : []) : []
      },
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
    if ('infant' in r) {
      // 新訂單格式（I~M）：房號與來源唯讀，其餘可改（含狀態/蛋奶/全素/加購）
      const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
      out.push({ roomNumber: no, source: r.source || '', roomType: r.roomType || '', status: r.status || '', eggMilk: r.eggMilk || '', vegan: r.vegan || '', adult: num(r.adult), child: num(r.child), infant: num(r.infant), mealTime: r.mealTime || '', payStatus: (r.payStatus === '已付' || r.payStatus === '待付') ? r.payStatus : '', breakfastType: (r.breakfastType === 'hot' || r.breakfastType === 'normal') ? r.breakfastType : 'normal', orderId: r.orderId || '', guestName: r.guestName || '' });
    } else if ('adult' in r) {
      out.push({ roomNumber: no, source: r.source || '', status: r.status || '', eggMilk: r.eggMilk || '', vegan: r.vegan || '', adult: r.adult || '', child: r.child || '', mealTime: r.mealTime || '', payStatus: (r.payStatus === '已付' || r.payStatus === '待付') ? r.payStatus : '', breakfastType: validType(r.breakfastType) ? r.breakfastType : 'normal', orderId: r.orderId || '' });
    } else {
      out.push({ roomNumber: no, breakfastType: validType(r.breakfastType) ? r.breakfastType : 'normal', orderId: '' });
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

function isOrderMode() { return state.rooms.length && state.rooms[0] && 'infant' in state.rooms[0]; }
// 加購種類三選一
const MEAL_TYPES = ['正常', '蛋奶', '全素'];
let mealTypeChoice = '正常'; // 正常 | 蛋奶 | 全素
function updateMealTypeButtons() {
  const map = { '正常': $('mealTypeNormalBtn'), '蛋奶': $('mealTypeEggBtn'), '全素': $('mealTypeVeganBtn') };
  Object.entries(map).forEach(([k, btn]) => {
    if (!btn) return;
    if (mealTypeChoice === k) {
      btn.style.background = '#7048e8'; btn.style.borderColor = '#7048e8'; btn.style.color = '#fff';
    } else {
      btn.style.background = '#fff'; btn.style.borderColor = '#dee2e6'; btn.style.color = '#212529';
    }
  });
}
function mealTypeValue() { return mealTypeChoice === '正常' ? '加購' : mealTypeChoice + '加購'; }
function orderKid(r) { return (Number(r.child) || 0) + (Number(r.infant) || 0); }

function computeStats(dateKey) {
  return C.computeStats(state.rooms, r => getStatus(dateKey, r.roomNumber));
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
  const hotPending = C.computeHotPending(state.rooms, r => getStatus(tk, r.roomNumber));
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
  // 8欄 / 新訂單模式兩欄同時顯示，不用 chips 篩選
  if (isOrderMode() || isBreakfast8Mode()) $('filterChips').classList.add('hidden');
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
function isAddon(r) { return C.isAddon(r); }
function isHotMeal(r) { return C.isHotRoom(r); }
function isNormalMeal(r) { return C.isPlatformRoom(r); }
// 兩欄定向滑動：真正單軸鎖定，避免斜滑（手動接管 touch）
// touch-action:none + preventDefault，手動依主軸只捲單向
function attachDirectionLock(el) {
  let sx = 0, sy = 0, locked = null;
  let startTop = 0, startLeft = 0;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    startTop = el.scrollTop; startLeft = el.scrollLeft;
    locked = null;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
    const dx = cx - sx, dy = cy - sy;
    if (!locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    // 鎖定後只允許單軸，另一軸完全不動；用 preventDefault 擋掉瀏覽器原生斜滑
    e.preventDefault();
    if (locked === 'v') el.scrollTop = startTop - dy;
    else if (locked === 'h') el.scrollLeft = startLeft - dx;
  }, { passive: false });
  el.addEventListener('touchend', () => { locked = null; }, { passive: true });
  el.addEventListener('touchcancel', () => { locked = null; }, { passive: true });
}
// 兩欄表格高度：量測上方統計區（標題／五宮格／進度條／警示橫幅）後，
// 把畫面剩餘高度寫進 CSS 變數 --pane-max-h，讓兩欄往下長到畫面底部（吃掉底部空白）。
// 用實際量測而非固定 vh，直立手機統計區折三列、平板一列都能正確填滿。
function applyPaneHeight() {
  const grid = $('roomGrid');
  if (!grid) return;
  const pane = grid.querySelector('.pane-scroll');
  if (!pane) return;
  const top = pane.getBoundingClientRect().top + window.scrollY;
  const avail = window.innerHeight - top - 36;
  const h = Math.max(240, Math.round(avail));
  document.documentElement.style.setProperty('--pane-max-h', h + 'px');
  const gridContainer = grid.querySelector(':scope > div');
  if (gridContainer && gridContainer.style.gridTemplateColumns) {
    gridContainer.style.height = h + 'px';
  }
}
let paneHeightBound = false;
function bindPaneHeight() {
  if (paneHeightBound) return;
  paneHeightBound = true;
  window.addEventListener('resize', applyPaneHeight);
  window.addEventListener('orientationchange', () => setTimeout(applyPaneHeight, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', applyPaneHeight);
}
// ===== 新訂單模式渲染（I~M 格式）=====
// 房號與來源唯讀；大人 / 小孩(孩童+嬰幼兒合併) / 時間可改（✎ 編輯）
const ORDER_PALETTE = ['#e64980', '#9775fa', '#4dabf7', '#38d9a9', '#ffa94d', '#fa5252', '#82c91e', '#15aabf'];
function renderOrderGrid(tk) {
  const grid = $('roomGrid');
  grid.style.display = 'block';
  grid.style.gridTemplateColumns = 'none';
  const all = sortRooms(state.rooms);
  const colors = C.assignGroupColors(all, ORDER_PALETTE);
  const hotList = all.filter(C.isHotRoom);
  const normalList = all.filter(r => C.isPlatformRoom(r));
  const mkRow = (r) => {
    const st = getStatus(tk, r.roomNumber);
    const done = st === STATUS.COMPLETED;
    const color = colors[r.roomNumber] || '';
    const isAdd = C.isAddon(r);
    const isNoAdd = C.isNoAdd(r);
    const kid = orderKid(r);
    const yellowBadge = (isAdd && !r.payStatus) ? `<span style="background:#fcc419;color:#664d03;font-size:10px;padding:1px 4px;border-radius:4px;margin-left:4px">${escapeHtml(r.eggMilk)}</span>` : '';
    const payLine = (isAdd && r.payStatus) ? `<div style="font-size:12px;font-weight:800;margin-top:2px;color:${r.payStatus === '已付' ? '#2f9e44' : '#e8590c'}">${r.payStatus}</div>` : '';
    return `<tr data-room="${escapeHtml(r.roomNumber)}" style="cursor:pointer;${done ? 'opacity:.45;background:#e7f5ff' : ''}${isAdd ? ';outline:2px solid #fcc419' : ''}${color ? ';border-bottom:5px solid ' + color + ';' : ''}">
      <td style="padding:8px 4px;font-weight:900">${color ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;box-shadow:0 0 0 1px rgba(0,0,0,.12)"></span>` : ''}${escapeHtml(r.roomNumber)}${r.guestName ? `<span title="${escapeHtml(r.guestName)}" style="font-size:11px;color:#868e96;margin-left:4px">(${escapeHtml(r.guestName.length > 5 ? r.guestName.slice(0,5) + '...' : r.guestName)})</span>` : ''}${yellowBadge}${payLine}</td>
      <td style="font-size:12px">${escapeHtml(r.source || '')}</td>
      <td style="font-size:11px">${[r.status, r.eggMilk, r.vegan].filter(Boolean).map(escapeHtml).join(' ')}${isAdd ? `<button data-orderrevert="${escapeHtml(r.roomNumber)}" style="margin-left:4px;background:#fff;border:1px solid #868e96;border-radius:6px;font-size:10px;padding:1px 4px">改</button>` : ''}${isNoAdd ? `<button data-orderaddon="${escapeHtml(r.roomNumber)}" style="margin-left:4px;background:#fff3bf;border:1px solid #fcc419;border-radius:6px;font-size:10px;padding:1px 4px">改</button>` : ''}</td>
      <td style="text-align:center;font-weight:700">${escapeHtml(r.adult ?? '')}</td>
      <td style="text-align:center">${escapeHtml(kid || '')}</td>
      <td style="font-size:12px;color:${r.mealTime === '不用餐' ? '#868e96;font-style:italic' : 'inherit'}" data-timeset="${escapeHtml(r.roomNumber)}">${escapeHtml(r.mealTime || '')}${r.mealTime ? '' : '<span class="hint" style="color:#adb5bd">＋</span>'}<button data-orderedit="${escapeHtml(r.roomNumber)}" style="margin-left:4px;background:#fff;border:1px solid #868e96;border-radius:6px;font-size:11px;padding:1px 6px">改</button></td>
      <td style="text-align:center">${done ? '<span class="line-check" style="border-color:#1971c2"></span>' : '<span class="line-pending"></span>'}</td>
    </tr>`;
  };
  // overflow: split lists so no duplication
  let hotBaseList = hotList, hotExtra = [];
  let normalBaseList = normalList, normalExtra = [];
  if (hotList.length > normalList.length && normalList.length > 0) {
    hotBaseList = hotList.slice(0, normalList.length);
    hotExtra = hotList.slice(normalList.length);
  } else if (normalList.length > hotList.length && hotList.length > 0) {
    normalBaseList = normalList.slice(0, hotList.length);
    normalExtra = normalList.slice(hotList.length);
  }
  const hotRows = hotBaseList.map(mkRow).join('') || '<tr><td colspan=7 style="text-align:center;padding:20px;color:#868e96">無熟食</td></tr>';
  const normalRows = normalBaseList.map(mkRow).join('') || '<tr><td colspan=7 style="text-align:center;padding:20px;color:#868e96">無平台</td></tr>';
  let hotOverflow = "", normalOverflow = "";
  if (hotExtra.length) {
    hotOverflow = '<tr><td colspan=7 style="padding:0"><div style="background:#e8590c;color:#fff;text-align:center;padding:4px 0;font-weight:900;font-size:13px;letter-spacing:1px">補充熟食</div></td></tr>' + hotExtra.map(mkRow).join("");
  }
  if (normalExtra.length) {
    normalOverflow = '<tr><td colspan=7 style="padding:0"><div style="background:#2f9e44;color:#fff;text-align:center;padding:4px 0;font-weight:900;font-size:13px;letter-spacing:1px">補充平台</div></td></tr>' + normalExtra.map(mkRow).join("");
  }
  const savedScrolls = {};
  grid.querySelectorAll('.pane-scroll').forEach(el => { savedScrolls[el.dataset.pane] = el.scrollTop; });
  grid.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:100%">
      <div style="background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 2px 5px rgba(0,0,0,.07)">
        <div style="background:#e8590c;color:#fff;text-align:center;padding:10px;font-weight:900;font-size:18px;letter-spacing:2px">熟食</div>
        <div class="pane-scroll" data-pane="hot">
          <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#fff1e7;font-size:11px"><th>房號</th><th>來源</th><th>備註</th><th>大人</th><th>小孩</th><th>時間</th><th></th></tr></thead><tbody>${hotRows}${normalOverflow}</tbody></table>
        </div>
      </div>
      <div style="background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 2px 5px rgba(0,0,0,.07)">
        <div style="background:#2f9e44;color:#fff;text-align:center;padding:10px;font-weight:900;font-size:18px;letter-spacing:2px">平台</div>
        <div class="pane-scroll" data-pane="normal">
          <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#ebfbee;font-size:11px"><th>房號</th><th>來源</th><th>備註</th><th>大人</th><th>小孩</th><th>時間</th><th></th></tr></thead><tbody>${normalRows}${hotOverflow}</tbody></table>
        </div>
      </div>
    </div>`;
  grid.querySelectorAll('.pane-scroll').forEach(el => {
    const saved = savedScrolls[el.dataset.pane];
    if (typeof saved === 'number') el.scrollTop = saved;
  });
  grid.querySelectorAll('.pane-scroll').forEach(attachDirectionLock);
  bindPaneHeight();
  applyPaneHeight();
  grid.querySelectorAll('tr[data-room]').forEach(tr => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-orderedit]')) return;
    if (e.target.closest('[data-orderaddon]')) return;
    if (e.target.closest('[data-orderrevert]')) return;
    if (e.target.closest('[data-timeset]')) return;
    const next = toggleStatus(tk, tr.dataset.room);
    if (navigator.vibrate) navigator.vibrate(next === STATUS.COMPLETED ? 20 : 8);
    toast(next === STATUS.COMPLETED ? `✅ ${tr.dataset.room} 已用餐` : `↩️ ${tr.dataset.room} 已取消`, 1200);
  }));
  grid.querySelectorAll('[data-orderedit]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openOrderEdit(btn.dataset.orderedit);
  }));
  grid.querySelectorAll('[data-orderaddon]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openMealEdit(btn.dataset.orderaddon, 'addon');
  }));
  grid.querySelectorAll('[data-orderrevert]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openMealEdit(btn.dataset.orderrevert, 'revert');
  }));
  grid.querySelectorAll('[data-timeset]').forEach(td => td.addEventListener('click', (e) => {
    e.stopPropagation();
    openTimePicker(td.dataset.timeset);
  }));
}

let orderEditTarget = null;
function openOrderEdit(roomNo) {
  const room = state.rooms.find(r => r.roomNumber === roomNo);
  if (!room) return;
  orderEditTarget = roomNo;
  $('orderEditTitle').textContent = `房號 ${roomNo}`;
  $('orderEditSource').textContent = `來源：${room.source || ''}（不可更改）`;
  $('orderRoomNoInput').value = roomNo;
  $('orderAdultInput').value = room.adult ?? '';
  $('orderChildInput').value = room.child ?? '';
  $('orderInfantInput').value = room.infant ?? '';
  $('orderTimeInput').value = room.mealTime || '';
  $('orderStatusInput').value = room.status || '';
  $('orderEggMilkInput').value = ['加購', '蛋奶加購', '全素加購'].includes(room.eggMilk) ? room.eggMilk : '';
  $('orderVeganInput').value = room.vegan === '不加購' ? '不加購' : '';
  openModal('orderEditModal');
}

function renderGrid(tk) {
  const grid = $('roomGrid');
  // 新訂單模式（I~M）：熟食｜一般 兩欄，房號與來源唯讀
  if (isOrderMode()) { renderOrderGrid(tk); return; }
  // 8欄兩欄模式：熟食｜一般 每房一橫排
  if (isBreakfast8Mode()) {
    // 讓兩欄寬度與橘棒一致：取消 grid 原有卡片佈局
    grid.style.display = 'block';
    grid.style.gridTemplateColumns = 'none';
    const all = sortRooms(state.rooms);
    const colors = C.assignGroupColors(all, ORDER_PALETTE);
    const hotList = all.filter(r => isHotMeal(r) || isAddon(r));
    const normalList = all.filter(isNormalMeal);
    // 已/未用餐同時顯示，僅用樣式區分
    const mkRow = (r) => {
      const st = getStatus(tk, r.roomNumber);
      const done = st === STATUS.COMPLETED;
      const color = colors[r.roomNumber] || '';
      const isAdd = isAddon(r);
      const isNoAdd = r.vegan === '不加購';
      // 匯入即加購（無付款狀態）→ 黃底「加購」；現場改加購 → 房號下方顯示 已付/待付
      const yellowBadge = (isAdd && !r.payStatus) ? '<span style="background:#fcc419;color:#664d03;font-size:10px;padding:1px 4px;border-radius:4px;margin-left:4px">加購</span>' : '';
      const payLine = (isAdd && r.payStatus) ? `<div style="font-size:12px;font-weight:800;margin-top:2px;color:${r.payStatus === '已付' ? '#2f9e44' : '#e8590c'}">${r.payStatus}</div>` : '';
      return `<tr data-room="${escapeHtml(r.roomNumber)}" class="${done ? 'row-done' : ''}" style="cursor:pointer;${done ? 'opacity:.45;background:#e7f5ff' : ''}${isAdd ? 'outline:2px solid #fcc419' : ''}${color ? ';border-bottom:5px solid ' + color + ';' : ''}">
        <td style="padding:8px 4px;font-weight:900">${color ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;box-shadow:0 0 0 1px rgba(0,0,0,.12)"></span>` : ''}${escapeHtml(r.roomNumber)}${r.guestName ? `<span title="${escapeHtml(r.guestName)}" style="font-size:11px;color:#868e96;margin-left:4px">(${escapeHtml(r.guestName.length > 5 ? r.guestName.slice(0,5) + '...' : r.guestName)})</span>` : ''}${yellowBadge}${payLine}</td>
        <td style="font-size:12px">${escapeHtml(r.source || '')}</td>
        <td style="font-size:11px">${[r.status, r.eggMilk, r.vegan].filter(Boolean).map(escapeHtml).join(' ')}${isAdd ? `<button data-revert="${escapeHtml(r.roomNumber)}" style="margin-left:4px;background:#fff;border:1px solid #868e96;border-radius:6px;font-size:10px;padding:1px 4px">改</button>` : ''}${isNoAdd ? `<button data-addon="${escapeHtml(r.roomNumber)}" style="margin-left:4px;background:#fff3bf;border:1px solid #fcc419;border-radius:6px;font-size:10px;padding:1px 4px">改</button>` : ''}</td>
        <td style="text-align:center;font-weight:700">${escapeHtml(r.adult || '')}</td>
        <td style="text-align:center">${escapeHtml(r.child || '')}</td>
        <td style="font-size:12px;color:${r.mealTime === '不用餐' ? '#868e96;font-style:italic' : 'inherit'}" data-timeset="${escapeHtml(r.roomNumber)}">${escapeHtml(r.mealTime || '')}${r.mealTime ? '' : '<span class="hint" style="color:#adb5bd">＋</span>'}</td>
        <td style="text-align:center">${done ? '<span class="line-check" style="border-color:#1971c2"></span>' : '<span class="line-pending"></span>'}</td>
      </tr>`;
    };
    // overflow: split lists so no duplication
    let hotBaseList8 = hotList, hotExtra8 = [];
    let normalBaseList8 = normalList, normalExtra8 = [];
    if (hotList.length > normalList.length && normalList.length > 0) {
      hotBaseList8 = hotList.slice(0, normalList.length);
      hotExtra8 = hotList.slice(normalList.length);
    } else if (normalList.length > hotList.length && hotList.length > 0) {
      normalBaseList8 = normalList.slice(0, hotList.length);
      normalExtra8 = normalList.slice(hotList.length);
    }
    const hotRows = hotBaseList8.map(mkRow).join('') || '<tr><td colspan=7 style="text-align:center;padding:20px;color:#868e96">無熟食</td></tr>';
    const normalRows = normalBaseList8.map(mkRow).join('') || '<tr><td colspan=7 style="text-align:center;padding:20px;color:#868e96">無平台</td></tr>';
    let hotOverflow8 = "", normalOverflow8 = "";
    if (hotExtra8.length) {
      hotOverflow8 = '<tr><td colspan=7 style="padding:0"><div style="background:#e8590c;color:#fff;text-align:center;padding:4px 0;font-weight:900;font-size:13px;letter-spacing:1px">補充熟食</div></td></tr>' + hotExtra8.map(mkRow).join("");
    }
    if (normalExtra8.length) {
      normalOverflow8 = '<tr><td colspan=7 style="padding:0"><div style="background:#2f9e44;color:#fff;text-align:center;padding:4px 0;font-weight:900;font-size:13px;letter-spacing:1px">補充平台</div></td></tr>' + normalExtra8.map(mkRow).join("");
    }
    const savedScrolls = {};
    grid.querySelectorAll('.pane-scroll').forEach(el => { savedScrolls[el.dataset.pane] = el.scrollTop; });
    grid.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:100%">
        <div style="background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 2px 5px rgba(0,0,0,.07)">
          <div style="background:#e8590c;color:#fff;text-align:center;padding:10px;font-weight:900;font-size:18px;letter-spacing:2px">熟食</div>
          <div class="pane-scroll" data-pane="hot">
            <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#fff1e7;font-size:11px"><th>房號</th><th>來源</th><th>備註</th><th>大人</th><th>小孩</th><th>時間</th><th></th></tr></thead><tbody>${hotRows}${normalOverflow8}</tbody></table>
          </div>
        </div>
        <div style="background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 2px 5px rgba(0,0,0,.07)">
          <div style="background:#2f9e44;color:#fff;text-align:center;padding:10px;font-weight:900;font-size:18px;letter-spacing:2px">平台</div>
          <div class="pane-scroll" data-pane="normal">
            <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#ebfbee;font-size:11px"><th>房號</th><th>來源</th><th>備註</th><th>大人</th><th>小孩</th><th>時間</th><th></th></tr></thead><tbody>${normalRows}${hotOverflow8}</tbody></table>
          </div>
        </div>
      </div>`;
    grid.querySelectorAll('.pane-scroll').forEach(el => {
      const saved = savedScrolls[el.dataset.pane];
      if (typeof saved === 'number') el.scrollTop = saved;
    });
    grid.querySelectorAll('.pane-scroll').forEach(attachDirectionLock);
    bindPaneHeight();
    applyPaneHeight();
    // 點排切換已用餐；不加購用「改」按鈕另改
    grid.querySelectorAll('tr[data-room]').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-addon]')) return; // 改按鈕不觸發切換
      if (e.target.closest('[data-timeset]')) return;
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
      if ($('mealTypeRow')) $('mealTypeRow').style.display = 'none';
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
    grid.querySelectorAll('[data-timeset]').forEach(td => td.addEventListener('click', (e) => {
      e.stopPropagation();
      openTimePicker(td.dataset.timeset);
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

// ===== 用餐時段設定 =====
function getMealSlots() {
  return Array.isArray(state.settings.mealSlots) ? state.settings.mealSlots : [];
}
function saveMealSlots() {
  state.settings.mealSlots = C.sortSlots(getMealSlots());
  saveState();
}
function renderSlotsList() {
  const wrap = $('slotsList');
  const slots = getMealSlots();
  if (!slots.length) {
    wrap.innerHTML = '<p class="hint" style="text-align:center;padding:16px 0;">尚未設定時段</p>';
    return;
  }
  wrap.innerHTML = slots.map((s, i) => {
    const label = escapeHtml(String(s.label || '').trim());
    return `<div class="manage-item">
      <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
        <input type="checkbox" data-slot-check="${i}" ${s.enabled ? 'checked' : ''}>
        <span class="room-no">${label}</span>
      </label>
      <button class="del-btn" data-slot-del="${i}">✕</button>
    </div>`;
  }).join('');
}
function openSlotsModal() {
  renderSlotsList();
  initWheelSelector();
  openModal('mealSlotsModal');
}

let wheelHour = [];
let wheelMin = [];

function initWheelSelector() {
  const hourCol = $('wheelHour');
  const minCol = $('wheelMin');
  if (!hourCol || !minCol) return;
  hourCol.innerHTML = '';
  minCol.innerHTML = '';
  wheelHour = Array.from({ length: 12 }, (_, i) => String(i + 1));
  wheelMin = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  const filler = () => { const d = document.createElement('div'); d.className = 'wheel-spacer'; return d; };
  hourCol.appendChild(filler());
  wheelHour.forEach((v, i) => { const d = document.createElement('div'); d.className = 'wheel-item'; d.dataset.val = v; d.dataset.idx = i; d.textContent = v; hourCol.appendChild(d); });
  hourCol.appendChild(filler());
  minCol.appendChild(filler());
  wheelMin.forEach((v, i) => { const d = document.createElement('div'); d.className = 'wheel-item'; d.dataset.val = v; d.dataset.idx = i; d.textContent = v; minCol.appendChild(d); });
  minCol.appendChild(filler());

  // 目前值（預設 8:00；若 slotsInput 已有合法值則沿用）
  const cur = parseTime12(($('slotsInput').value || '').trim()) || { h: 8, m: 0 };
  wheelSetIndex(hourCol, cur.h - 1);
  wheelSetIndex(minCol, cur.m / 5);

  [hourCol, minCol].forEach(col => {
    let t = null;
    col.addEventListener('scroll', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { wheelSyncActive(col); wheelApply(); }, 120);
    }, { passive: true });
    col.addEventListener('click', e => {
      const item = e.target.closest('.wheel-item');
      if (!item) return;
      const idx = Number(item.dataset.idx);
      wheelMarkActive(col, idx);
      col.scrollTo({ top: idx * 50, behavior: 'smooth' });
      setTimeout(() => { wheelSyncActive(col); wheelApply(); }, 140);
    });
  });
  wheelSyncActive(hourCol);
  wheelSyncActive(minCol);
  wheelApply();
}

function parseTime12(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]);
  if (h < 1 || h > 12 || min < 0 || min > 59 || min % 5 !== 0) return null;
  return { h, m: min };
}

function wheelSetIndex(col, idx) {
  const total = col.querySelectorAll('.wheel-item').length;
  if (idx < 0 || idx >= total) return;
  col.scrollTop = idx * 50;
  wheelMarkActive(col, idx);
}

function wheelMarkActive(col, idx) {
  col.querySelectorAll('.wheel-item').forEach(el => el.classList.toggle('active', Number(el.dataset.idx) === idx));
}

function wheelSyncActive(col) {
  const rect = col.getBoundingClientRect();
  const center = rect.top + rect.height / 2;
  let best = 0, bestD = Infinity;
  col.querySelectorAll('.wheel-item').forEach(el => {
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - center);
    if (d < bestD) { bestD = d; best = Number(el.dataset.idx); }
  });
  wheelMarkActive(col, best);
}

function wheelApply() {
  const hourCol = $('wheelHour'), minCol = $('wheelMin');
  if (!hourCol || !minCol) return;
  const hEl = hourCol.querySelector('.active');
  const mEl = minCol.querySelector('.active');
  if (!hEl || !mEl) return;
  const h = Number(hEl.dataset.val);
  const m = Number(mEl.dataset.val);
  $('slotsInput').value = `${h}:${String(m).padStart(2, '0')}`;
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

// ===== 新訂單格式解析（I~M：房型房號/成人/孩童/嬰幼兒/訂單來源）=====
// 房號含 N 完整保留（如 212N）；一格多房以 / 分隔，依房型人數依序分配
function extractOrderRoomNo(seg) {
  const m = String(seg || '').trim().match(/^(\d+)\s*([Nn])?/);
  if (!m) return '';
  return m[1] + (m[2] ? 'N' : '');
}
function roomCapacity(seg) {
  const s = String(seg || '');
  const m = s.match(/(\d+)\s*人房/);
  let cap = m ? parseInt(m[1], 10) : 2;
  if (/加[大]?床/.test(s)) cap += 1;
  return cap;
}
function parseOrderMatrix(matrix) {
  if (!matrix || !matrix.length) return null;
  const norm = matrix.map(row => (Array.isArray(row) ? row : [row]).map(c => String(c ?? '').trim()));
  // 找標題列（含 房型房號）
  let hr = -1;
  for (let i = 0; i < Math.min(5, norm.length); i++) {
    if (norm[i].some(c => c.includes('房型房號'))) { hr = i; break; }
  }
  if (hr === -1) return null;
  const header = norm[hr];
  const findCol = (re, fallback) => {
    const idx = header.findIndex(c => re.test(c));
    return idx >= 0 ? idx : fallback;
  };
  // 預設 I~M（0-indexed 8~12）
  const roomCol = findCol(/房型房號/, 8);
  const adultCol = findCol(/^成人/, 9);
  const childCol = findCol(/孩童/, 10);
  const infantCol = findCol(/嬰幼/, 11);
  const srcCol = findCol(/訂單來源/, 12);
  const orderCol = findCol(/訂單編號/, -1);
  const guestCol = findCol(/顧客|Guest|姓名|住客/, 4);

  const num = (v) => { const n = Number(String(v || '').trim()); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  const byNo = new Map();
  const issues = [];
  for (let i = hr + 1; i < norm.length; i++) {
    const r = norm[i];
    const cell = (r[roomCol] || '').trim();
    if (!cell) continue;
    const segs = cell.split(/[\/／、\n]+/).map(s => s.trim()).filter(Boolean);
    const infos = segs.map(seg => ({ seg, no: extractOrderRoomNo(seg), cap: roomCapacity(seg) })).filter(x => x.no);
    if (!infos.length) continue;
    const src = (r[srcCol] || '').trim();
    let remA = num(r[adultCol]), remC = num(r[childCol]), remI = num(r[infantCol]);
    infos.forEach((info, idx) => {
      const last = idx === infos.length - 1;
      let space = info.cap;
      const take = (rem) => last ? rem : Math.min(rem, space);
      const a = take(remA); remA -= a; space -= a;
      const c = take(remC); remC -= c; space -= c;
      const inf = take(remI); remI -= inf; space -= inf;
      const rec = {
        roomNumber: info.no, roomType: info.seg, source: src,
        adult: a, child: c, infant: inf, mealTime: '',
        orderId: orderCol >= 0 ? String(r[orderCol] || '').trim() : '',
        guestName: guestCol >= 0 ? String(r[guestCol] || '').trim() : '',
        breakfastType: C.isHotSource(src) ? 'hot' : 'normal'
      };
      if (byNo.has(info.no)) issues.push(`房號 ${info.no} 重複，以最後一筆為準`);
      byNo.set(info.no, rec);
    });
  }
  const rows = [...byNo.values()];
  if (!rows.length) return null;
  rows.sort((a, b) => numericAwareSort(a.roomNumber, b.roomNumber));
  return { rows, issues, isOrder: true };
}

// 反查：同一筆訂單多間房 → Map<房號, 訂單編號>
function collectOrderIds(matrix) {
  if (!matrix || !matrix.length) return null;
  const norm = matrix.map(row => (Array.isArray(row) ? row : [row]).map(c => String(c ?? '').trim()));
  let hr = -1;
  for (let i = 0; i < Math.min(5, norm.length); i++) {
    if (norm[i].some(c => c.includes('訂單編號')) && norm[i].some(c => /房型房號|房間房號/.test(c))) { hr = i; break; }
  }
  if (hr === -1) return null;
  const header = norm[hr];
  const orderIdx = header.findIndex(c => c.includes('訂單編號'));
  const roomIdx = header.findIndex(c => /房型房號|房間房號/.test(c));
  if (orderIdx < 0 || roomIdx < 0) return null;
  const map = new Map();
  for (let i = hr + 1; i < norm.length; i++) {
    const cell = (norm[i][roomIdx] || '').trim();
    const orderId = (norm[i][orderIdx] || '').trim();
    if (!cell || !orderId) continue;
    cell.split(/[\/／、\n]+/).map(s => s.trim()).filter(Boolean).forEach(seg => {
      const m = seg.match(/^(\d+)\s*([Nn])?/);
      if (m) map.set(m[1] + (m[2] ? 'N' : ''), orderId);
    });
  }
  return map.size ? map : null;
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
  let parsed = null;
  // 優先試新訂單格式（I~M：房型房號/成人/孩童/嬰幼兒/訂單來源）
  for (const name of wb.SheetNames) {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false });
    const po = parseOrderMatrix(m);
    if (po && po.rows.length) { parsed = po; break; }
  }
  if (!parsed) {
    // 優先找 早餐統計
    const targetName = wb.SheetNames.find(n => n.includes('早餐')) || wb.SheetNames[0];
    const sheet = wb.Sheets[targetName];
    const hiddenRows = new Set();
    if (sheet['!rows']) {
      sheet['!rows'].forEach((r, idx) => { if (r && r.hidden) hiddenRows.add(idx + 1); });
    }
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    const parsed8 = parseBreakfastMatrix(matrix, { hiddenRows });
    if (parsed8 && parsed8.rows.length) {
      parsed = parsed8;
    } else {
      // 若非 8欄，嘗試遍歷其他 sheet
      for (const name of wb.SheetNames) {
        if (name === targetName) continue;
        const s = wb.Sheets[name];
        const hr = new Set();
        if (s['!rows']) s['!rows'].forEach((r, idx) => { if (r && r.hidden) hr.add(idx + 1); });
        const m = XLSX.utils.sheet_to_json(s, { header: 1, defval: '', raw: false, blankrows: false });
        const p = parseBreakfastMatrix(m, { hiddenRows: hr });
        if (p && p.rows.length) { parsed = p; break; }
      }
      if (!parsed) parsed = parseFromMatrix(matrix);
    }
  }
  // 訂單編號反查：以第一份含 訂單編號+房型房號 的 sheet 為準，套用到所有 rows
  if (parsed && parsed.rows) {
    for (const name of wb.SheetNames) {
      const m = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false });
      const m2 = collectOrderIds(m);
      if (m2) {
        parsed.rows.forEach(r => { if (!r.orderId && m2.has(r.roomNumber)) r.orderId = m2.get(r.roomNumber); });
        break;
      }
    }
  }
  return parsed;
}

function showImportPreview(parsed) {
  importDraft = parsed;
  if (parsed.isOrder) {
    // 新訂單預覽：房號 / 房型 / 來源 / 大人 / 小孩(孩童+嬰幼兒)
    const hotCount = parsed.rows.filter(r => r.breakfastType === 'hot').length;
    let tA = 0, tC = 0, tI = 0;
    parsed.rows.forEach(r => { tA += r.adult; tC += r.child; tI += r.infant; });
    $('importSummary').innerHTML = `共判讀到 <b>${parsed.rows.length}</b> 間<br>熟食 ${hotCount} 間　一般 ${parsed.rows.length - hotCount} 間<br>成人 ${tA}　孩童 ${tC}　嬰幼兒 ${tI}`;
    $('importIssues').innerHTML = parsed.issues.slice(0, 8).map(i => `<div class="issue">${escapeHtml(i)}</div>`).join('') + (parsed.issues.length > 8 ? `<div class="issue">…另有 ${parsed.issues.length - 8} 項</div>` : '');
    $('importPreviewList').innerHTML = `<div style="overflow:auto"><table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th>房號</th><th>房型</th><th>來源</th><th>大人</th><th>小孩</th></tr>` + parsed.rows.slice(0, 40).map(r => `<tr><td>${escapeHtml(r.roomNumber)}</td><td style="font-size:11px">${escapeHtml(r.roomType)}</td><td>${escapeHtml(r.source)}</td><td style="text-align:center">${r.adult}</td><td style="text-align:center">${r.child + r.infant}</td></tr>`).join('') + `</table>` + (parsed.rows.length > 40 ? `<div class="hint" style="text-align:center;padding:6px">…其餘 ${parsed.rows.length - 40} 筆</div>` : '') + `</div>`;
  } else if (parsed.isBreakfast8) {
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
  if (importDraft.isOrder) {
    // 新訂單存法：房號與來源唯讀，其餘可改（含狀態/蛋奶/全素）
    state.rooms = sortRooms(importDraft.rows.map(r => ({
      roomNumber: r.roomNumber, roomType: r.roomType, source: r.source, guestName: r.guestName || '',
      status: '', eggMilk: '', vegan: '', adult: r.adult, child: r.child,
      infant: r.infant, mealTime: '', payStatus: '',
      orderId: r.orderId || '',
      breakfastType: r.breakfastType
    })));
  } else if (importDraft.isBreakfast8) {
    // 8欄存法：保留完整欄位
    state.rooms = sortRooms(importDraft.rows.map(r => ({
      roomNumber: r.roomNumber, source: r.source, status: r.status, eggMilk: r.eggMilk, vegan: r.vegan, adult: r.adult, child: r.child, mealTime: r.mealTime, payStatus: '', orderId: r.orderId || '', breakfastType: (r.adult || r.child) ? 'hot' : 'normal'
    })));
  } else {
    state.rooms = sortRooms(importDraft.rows.map(r => ({ roomNumber: r.roomNumber, breakfastType: r.breakfastType, orderId: r.orderId || '' })));
  }
  saveState();
  render();
  closeModal('importModal');
  importDraft = null;
  $('fileInput').value = '';
  toast(`✅ 已匯入 ${state.rooms.length} 間房號`);
}

// ===== 備料區 =====
function getPrep() {
  return Object.assign({}, DEFAULT_PREP, (state.settings && state.settings.prep) || {});
}
function savePrep(patch) {
  state.settings.prep = Object.assign(getPrep(), patch);
  saveState();
}
function calcPrepTotals() {
  let A = 0, C = 0, I = 0, hotRooms = 0, hotP = 0;
  for (const r of state.rooms) {
    const a = Number(r.adult) || 0, c = Number(r.child) || 0, i = Number(r.infant) || 0;
    A += a; C += c; I += i;
    if (r.breakfastType === 'hot') { hotRooms++; hotP += a + c + i; }
  }
  return { A, C, I, total: A + C + I, rooms: state.rooms.length, hotRooms, hotPeople: hotP };
}
function calcPrep() {
  const p = getPrep();
  const t = calcPrepTotals();
  // 果凍奶酪：先算總量與各品類需要，再扣各自庫存得應做
  const jellyTotal = Math.max(0, Math.round(t.total * Number(p.jellyRatio)));
  const cheeseNeed = Math.round(jellyTotal / (Number(p.cheeseDiv) || 4));
  const jellyNeed = Math.max(0, jellyTotal - cheeseNeed);
  const cheese = Math.max(0, cheeseNeed - (Number(p.cheeseStock) || 0));
  const jelly = Math.max(0, jellyNeed - (Number(p.jellyStock) || 0));
  // 果凍品項分配合計／剩餘
  const items = (p.jellyItems && typeof p.jellyItems === 'object') ? p.jellyItems : {};
  let allocated = 0;
  JELLY_ITEMS.forEach(n => { allocated += Math.max(0, Math.floor(Number(items[n]) || 0)); });
  const remain = jelly - allocated;
  // 茶葉蛋：總人數×比例 − 庫存 ＋ 預留顆數 ＋ 比例×預留％
  const eggBase = t.total * Number(p.eggRatio);
  const eggTotal = Math.max(0, Math.round(eggBase - Number(p.eggStock) + (Number(p.eggExtra) || 0) + eggBase * (Number(p.eggReservePct) || 0) / 100));
  const kid = t.C + t.I; // 小孩＝孩童＋嬰幼兒
  const r1 = v => Math.round(v * 10) / 10;
  const rice = r1(t.A * Number(p.riceAdult) + kid * Number(p.riceChild));
  const porridge = r1(t.A * Number(p.porridgeAdult) + kid * Number(p.porridgeChild));
  const special = r1((t.A + kid * 0.5) / (Number(p.specialDiv) || 12));
  return { t, kid, jellyTotal, cheeseNeed, jellyNeed, cheese, jelly, allocated, remain, eggTotal, rice, porridge, special };
}
function openPrep() {
  if (!isOrderMode() && state.rooms.length) { toast('備料區僅支援新訂單格式匯入的資料'); return; }
  const p = getPrep();
  $('jellyRatio').value = p.jellyRatio;
  $('jellyStock').value = p.jellyStock || 0;
  $('cheeseStock').value = p.cheeseStock || 0;
  $('cheeseDiv').value = p.cheeseDiv;
  $('eggRatio').value = p.eggRatio;
  $('eggStock').value = p.eggStock;
  $('eggExtra').value = p.eggExtra;
  $('eggReservePct').value = p.eggReservePct || 0;
  $('riceAdult').value = p.riceAdult;
  $('riceChild').value = p.riceChild;
  $('porridgeAdult').value = p.porridgeAdult;
  $('porridgeChild').value = p.porridgeChild;
  $('specialDiv').value = p.specialDiv;
  buildJellyItems();
  renderPrep();
  openModal('prepModal');
}
function buildJellyItems() {
  const p = getPrep();
  const items = (p.jellyItems && typeof p.jellyItems === 'object') ? p.jellyItems : {};
  $('jellyItems').innerHTML = JELLY_ITEMS.map(n =>
    `<label class="hint">${escapeHtml(n)}<input type="number" data-jelly-item="${escapeHtml(n)}" min="0" value="${Math.max(0, Math.floor(Number(items[n]) || 0))}" style="width:100%;min-height:48px;border:2px solid #dee2e6;border-radius:10px;padding:0 10px;font-size:16px"></label>`
  ).join('');
  $('jellyItems').querySelectorAll('input[data-jelly-item]').forEach(inp => {
    inp.addEventListener('change', collectJellyItems);
  });
}
function collectJellyItems() {
  const items = {};
  $('jellyItems').querySelectorAll('input[data-jelly-item]').forEach(inp => {
    const v = Math.max(0, Math.floor(Number(inp.value) || 0));
    inp.value = v;
    if (v > 0) items[inp.dataset.jellyItem] = v;
  });
  savePrep({ jellyItems: items });
  renderPrep();
}
function renderPrep() {
  const c = calcPrep();
  $('prepSumLine').innerHTML = `成人 <b>${c.t.A}</b>　孩童 <b>${c.t.C}</b>　嬰幼兒 <b>${c.t.I}</b>＝總人數 <b>${c.t.total}</b>`;
  $('prepHotLine').innerHTML = `熟食區 <b>${c.t.hotRooms}</b> 間 / <b>${c.t.hotPeople}</b> 人（共 ${c.t.rooms} 間）`;
  $('jellyTotal').textContent = c.jellyTotal;
  $('cheeseNum').textContent = `${c.cheese}（需${c.cheeseNeed}−庫${Number(getPrep().cheeseStock) || 0}）`;
  $('jellyNum').textContent = `${c.jelly}（需${c.jellyNeed}−庫${Number(getPrep().jellyStock) || 0}）`;
  $('jellyAllocated').textContent = c.allocated;
  const remEl = $('jellyRemain');
  remEl.textContent = c.remain;
  remEl.style.color = c.remain < 0 ? '#e03131' : '#2f9e44';
  $('eggTotal').textContent = c.eggTotal;
  $('riceNum').textContent = c.rice;
  $('porridgeNum').textContent = c.porridge;
  $('specialNum').textContent = c.special;
  $('prepKidNote').textContent = `小孩＝孩童 ${c.t.C}＋嬰幼兒 ${c.t.I}＝${c.kid}`;
}
function collectPrep() {
  const num = (id, fb) => {
    const v = Number($(id).value);
    return Number.isFinite(v) && v >= 0 ? v : fb;
  };
  const d = DEFAULT_PREP;
  savePrep({
    jellyRatio: num('jellyRatio', d.jellyRatio),
    jellyStock: num('jellyStock', d.jellyStock),
    cheeseStock: num('cheeseStock', d.cheeseStock),
    cheeseDiv: num('cheeseDiv', d.cheeseDiv),
    eggRatio: num('eggRatio', d.eggRatio),
    eggStock: num('eggStock', d.eggStock),
    eggExtra: num('eggExtra', d.eggExtra),
    eggReservePct: num('eggReservePct', d.eggReservePct),
    riceAdult: num('riceAdult', d.riceAdult),
    riceChild: num('riceChild', d.riceChild),
    porridgeAdult: num('porridgeAdult', d.porridgeAdult),
    porridgeChild: num('porridgeChild', d.porridgeChild),
    specialDiv: num('specialDiv', d.specialDiv)
  });
  renderPrep();
}

// ===== 匯出 =====
function exportToday() {
  const tk = todayKey();
  if (!state.rooms.length) { toast('目前沒有房號可匯出'); return; }
  if (isOrderMode()) {
    const rows = [['日期', '房號', '房型', '來源', '大人', '小孩', '嬰幼兒', '用餐狀態']];
    for (const r of sortRooms(state.rooms)) {
      const done = getStatus(tk, r.roomNumber) === STATUS.COMPLETED;
      rows.push([tk.replace(/-/g, '/'), r.roomNumber, r.roomType || '', r.source || '', r.adult, orderKid(r), r.infant, done ? '已用餐' : '未用餐']);
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
    return;
  }
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
  $('menuPrepBtn').addEventListener('click', () => { closeModal('menuModal'); openPrep(); });

  // 用餐時段設定 modal
  $('menuSlotsBtn').addEventListener('click', () => { closeModal('menuModal'); openSlotsModal(); });
  $('slotsAddBtn').addEventListener('click', () => { const v = $('slotsInput').value; state.settings.mealSlots = C.addSlot(getMealSlots(), v); saveMealSlots(); $('slotsInput').value = ''; renderSlotsList(); toast(v.trim() ? `已新增 ${v.trim()}` : '請輸入時段'); });
  $('slotsInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('slotsAddBtn').click(); });
  $('slotsCloseBtn').addEventListener('click', () => closeModal('mealSlotsModal'));
  $('slotsList').addEventListener('change', e => { const c = e.target.closest('input[data-slot-check]'); if (!c) return; const i = Number(c.dataset.slotCheck); const s = getMealSlots()[i]; if (s) { s.enabled = c.checked; saveMealSlots(); renderSlotsList(); } });
  $('slotsList').addEventListener('click', e => { const b = e.target.closest('[data-slot-del]'); if (!b) return; const i = Number(b.dataset.slotDel); const s = getMealSlots()[i]; if (!s) return; state.settings.mealSlots = getMealSlots().filter((_, k) => k !== i); saveMealSlots(); renderSlotsList(); toast(`已刪除 ${s.label}`); });

  // 時間選擇彈窗
  $('timePickerCloseBtn').addEventListener('click', () => { timePickerTarget = null; closeModal('timePickerModal'); });

  // 備料區：比例更改即時重算並儲存
  $('prepModal').querySelectorAll('input[type="number"]').forEach(inp => {
    inp.addEventListener('change', collectPrep);
  });
  $('prepCloseBtn').addEventListener('click', () => closeModal('prepModal'));

  // 新訂單房號編輯：來源唯讀，房號與其餘可改（含狀態/蛋奶/全素）
  $('orderSaveBtn').addEventListener('click', () => {
    const room = state.rooms.find(r => r.roomNumber === orderEditTarget);
    if (!room) { orderEditTarget = null; closeModal('orderEditModal'); return; }
    const num = (id) => {
      const v = Number($(id).value);
      return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    };
    // 房號可改（現場換房）：重複則擋下，今日用餐狀態跟著搬到新房號
    const newNo = normalizeRoomNo($('orderRoomNoInput').value);
    if (!newNo) { toast('房號不可為空'); return; }
    if (newNo !== room.roomNumber && state.rooms.some(r => r.roomNumber === newNo)) {
      toast(`❌ 房號 ${newNo} 已存在`);
      return;
    }
    if (newNo !== room.roomNumber) {
      const tk = todayKey();
      if (state.daily[tk] && state.daily[tk][room.roomNumber] !== undefined) {
        state.daily[tk][newNo] = state.daily[tk][room.roomNumber];
        delete state.daily[tk][room.roomNumber];
      }
      room.roomNumber = newNo;
      state.rooms = sortRooms(state.rooms);
    }
    room.adult = num('orderAdultInput');
    room.child = num('orderChildInput');
    room.infant = num('orderInfantInput');
    room.mealTime = $('orderTimeInput').value.trim();
    room.status = $('orderStatusInput').value.trim();
    const em = $('orderEggMilkInput').value;
    room.eggMilk = ['加購', '蛋奶加購', '全素加購'].includes(em) ? em : '';
    room.vegan = $('orderVeganInput').value === '不加購' ? '不加購' : '';
    if (room.eggMilk && room.vegan === '不加購') room.vegan = '';
    const moved = newNo !== orderEditTarget;
    const oldNo = orderEditTarget;
    saveState();
    render();
    closeModal('orderEditModal');
    orderEditTarget = null;
    toast(moved ? `已改房 ${oldNo} → ${newNo}` : '已更新');
  });
  $('orderCancelBtn').addEventListener('click', () => { orderEditTarget = null; closeModal('orderEditModal'); });
  $('orderTimeInput').addEventListener('click', openOrderTimePicker);

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
  $('mealTypeNormalBtn').addEventListener('click', () => { mealTypeChoice = '正常'; updateMealTypeButtons(); });
  $('mealTypeEggBtn').addEventListener('click', () => { mealTypeChoice = '蛋奶'; updateMealTypeButtons(); });
  $('mealTypeVeganBtn').addEventListener('click', () => { mealTypeChoice = '全素'; updateMealTypeButtons(); });
  $('mealCancelBtn').addEventListener('click', () => { mealEditTarget = null; $('mealAdultInput').disabled = false; $('mealChildInput').disabled = false; closeModal('mealEditModal'); });
  $('mealSaveBtn').addEventListener('click', () => {
    const room = state.rooms.find(r => r.roomNumber === mealEditTarget);
    if (!room) return;
    const isOrder = 'infant' in room;
    if (mealEditMode === 'revert') {
      room.eggMilk = '';
      room.vegan = '不加購';
      room.payStatus = '';
      if (!isOrder) { room.adult = ''; room.child = ''; }
      saveState();
      $('mealAdultInput').disabled = false; $('mealChildInput').disabled = false;
      closeModal('mealEditModal'); mealEditTarget = null; render();
      toast(`↩️ ${room.roomNumber} 已改回不加購`);
      return;
    }
    const a = $('mealAdultInput').value.trim();
    const c = $('mealChildInput').value.trim();
    if (a === '' && c === '') { toast('請輸入大人或小孩數量'); return; }
    room.eggMilk = isOrder ? mealTypeValue() : '加購';
    room.vegan = '';
    if (isOrder) {
      const na = Math.max(0, Math.floor(Number(a) || 0));
      const nc = Math.max(0, Math.floor(Number(c) || 0));
      room.adult = na; room.child = nc;
    } else {
      room.adult = a;
      room.child = c;
    }
    room.payStatus = mealPayChoice;
    saveState();
    closeModal('mealEditModal');
    mealEditTarget = null;
    render();
    toast(`✅ ${room.roomNumber} 已改為${room.eggMilk} ${a}/${c}（${mealPayChoice}）`);
  });
}

// 不加購改加購 / 加購改回（新訂單與舊8欄共用）
function openMealEdit(roomNo, mode) {
  const room = state.rooms.find(x => x.roomNumber === roomNo);
  if (!room) return;
  mealEditTarget = roomNo;
  mealEditMode = mode;
  if (mode === 'revert') {
    $('mealEditTitle').textContent = `房號 ${room.roomNumber} 改回不加購`;
    $('mealEditHint').textContent = `來源：${room.source || ''}　此房目前為加購 ${room.adult || 0}/${room.child || 0}${room.payStatus ? `（${room.payStatus}）` : ''}，確認改回不加購？`;
    $('mealAdultInput').value = room.adult ?? '';
    $('mealChildInput').value = room.child ?? '';
    $('mealAdultInput').disabled = true; $('mealChildInput').disabled = true;
    $('mealSaveBtn').textContent = '確認改回不加購';
  } else {
    $('mealEditTitle').textContent = `房號 ${room.roomNumber} 改為加購`;
    $('mealEditHint').textContent = `來源：${room.source || ''}　此房原為不加購，請選加購種類並輸入大人小孩數量`;
    $('mealAdultInput').value = room.adult ?? '';
    $('mealChildInput').value = room.child ?? '';
    $('mealAdultInput').disabled = false; $('mealChildInput').disabled = false;
    mealPayChoice = '待付';
    updatePayButtons();
    mealTypeChoice = '正常';
    updateMealTypeButtons();
    $('mealTypeRow').style.display = '';
    $('mealSaveBtn').textContent = '確認改為加購';
  }
  if (mode === 'revert' && $('mealTypeRow')) $('mealTypeRow').style.display = 'none';
  openModal('mealEditModal');
}

let timePickerTarget = null;
function renderTimePickerOptions(onPick) {
  const slots = C.enabledSlots(state.settings.mealSlots);
  const wrap = $('timePickerOptions');
  let html = '';
  if (slots.length) {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">` +
      slots.map(s => `<button type="button" class="btn" data-time-value="${escapeHtml(s)}" style="min-height:56px">${escapeHtml(s)}</button>`).join('') + `</div>`;
  } else {
    html += `<p class="hint" style="text-align:center;padding:12px 0">尚未設定時段，請先到選單設定</p>`;
  }
  html += `<button type="button" class="btn" data-time-value="不用餐" style="min-height:52px;width:100%;background:#f1f3f5;border-color:#adb5bd;color:#495057;margin-bottom:10px">🚫 不用餐</button>`;
  html += `<button type="button" class="btn" data-time-value="" style="min-height:52px;width:100%">清除（空白）</button>`;
  wrap.innerHTML = html;
  wrap.querySelectorAll('[data-time-value]').forEach(btn => {
    btn.addEventListener('click', () => onPick(btn.dataset.timeValue));
  });
}

function openTimePicker(roomNo) {
  const room = state.rooms.find(r => r.roomNumber === roomNo);
  if (!room) return;
  timePickerTarget = roomNo;
  $('timePickerTitle').textContent = `房號 ${roomNo} 用餐時間`;
  renderTimePickerOptions((value) => {
    const room2 = state.rooms.find(x => x.roomNumber === timePickerTarget);
    if (!room2) return;
    room2.mealTime = value;
    saveState();
    render();
    closeModal('timePickerModal');
    timePickerTarget = null;
    toast(value ? `✅ ${room2.roomNumber} 時間：${value}` : `${room2.roomNumber} 已清除用餐時間`);
  });
  openModal('timePickerModal');
}

function openOrderTimePicker() {
  const room = state.rooms.find(r => r.roomNumber === orderEditTarget);
  if (!room) return;
  $('timePickerTitle').textContent = `房號 ${room.roomNumber} 用餐時間`;
  renderTimePickerOptions((value) => {
    $('orderTimeInput').value = value;
    closeModal('timePickerModal');
  });
  openModal('timePickerModal');
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
