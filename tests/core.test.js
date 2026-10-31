'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const hotSrcRoom = { roomNumber: '101', source: '官網', vegan: '', eggMilk: '' };
const platformRoom = { roomNumber: '312', source: 'Booking.com', vegan: '', eggMilk: '' };
const addonRoom = { roomNumber: '308', source: 'Agoda', vegan: '', eggMilk: '加購' };
const noAddRoom = { roomNumber: '507', source: '官網', vegan: '不加購', eggMilk: '' };
const noMealRoom = { roomNumber: '102', source: '手動訂單', vegan: '', eggMilk: '', mealTime: '不用餐' };

test('isHotSource: 手動/官網/官網訂單為熟食來源，其餘不是', () => {
  assert.strictEqual(C.isHotSource('手動訂單'), true);
  assert.strictEqual(C.isHotSource('官網訂單'), true);
  assert.strictEqual(C.isHotSource('官網'), true);
  assert.strictEqual(C.isHotSource('Booking.com'), false);
  assert.strictEqual(C.isHotSource(''), false);
  assert.strictEqual(C.isHotSource(undefined), false);
});

test('isAddon: eggMilk 含加購，或 vegan === 加購', () => {
  assert.strictEqual(C.isAddon(addonRoom), true);
  assert.strictEqual(C.isAddon({ eggMilk: '蛋奶加購' }), true);
  assert.strictEqual(C.isAddon({ vegan: '加購' }), true);
  assert.strictEqual(C.isAddon({ vegan: '不加購' }), false);
  assert.strictEqual(C.isAddon(platformRoom), false);
  assert.strictEqual(C.isAddon(undefined), false);
});

test('isNoAdd: vegan === 不加購', () => {
  assert.strictEqual(C.isNoAdd(noAddRoom), true);
  assert.strictEqual(C.isNoAdd(platformRoom), false);
});

test('isHotRoom / isPlatformRoom: 真理表', () => {
  assert.strictEqual(C.isHotRoom(hotSrcRoom), true);     // 官網 → 熟食
  assert.strictEqual(C.isHotRoom(platformRoom), false);  // Booking → 平台
  assert.strictEqual(C.isHotRoom(addonRoom), true);      // Agoda+加購 → 熟食
  assert.strictEqual(C.isHotRoom(noAddRoom), false);     // 官網但不加購 → 平台
  assert.strictEqual(C.isPlatformRoom(platformRoom), true);
  assert.strictEqual(C.isPlatformRoom(hotSrcRoom), false);
});

test('平台房改加購（vegan=加購）→ 排進熟食並計入未用餐', () => {
  const edited = { ...platformRoom, vegan: '加購', eggMilk: '' };
  assert.strictEqual(C.isHotRoom(edited), true);
  assert.strictEqual(C.isPlatformRoom(edited), false);
  assert.strictEqual(C.computeHotPending([edited], () => 'pending'), 1);
  assert.strictEqual(C.computeStats([edited], () => 'pending').hot, 1);
  assert.strictEqual(C.computeStats([edited], () => 'pending').addon, 1);
});

test('isNoMeal: mealTime === 不用餐', () => {
  assert.strictEqual(C.isNoMeal(noMealRoom), true);
  assert.strictEqual(C.isNoMeal(hotSrcRoom), false);
});

test('computeHotPending: 熟食區未用餐且扣除不用餐', () => {
  const rooms = [hotSrcRoom, platformRoom, addonRoom, noAddRoom, noMealRoom];
  const statusOf = () => 'pending'; // 全部未用餐
  // 熟食 = 101, 308；207 平台、507 不加購(平台)、102 不用餐(扣除)
  assert.strictEqual(C.computeHotPending(rooms, statusOf), 2);
  const allDone = () => 'completed';
  assert.strictEqual(C.computeHotPending(rooms, allDone), 0);
});

test('computeStats: 熟食含加購、熟食+平台=總數', () => {
  const rooms = [hotSrcRoom, platformRoom, addonRoom, noAddRoom];
  const statusOf = (r) => (r.roomNumber === '101' ? 'completed' : 'pending');
  const s = C.computeStats(rooms, statusOf);
  assert.strictEqual(s.hot, 2);        // 101(官網) + 308(加購)
  assert.strictEqual(s.normal, 2);     // 312 + 507(不加購)
  assert.strictEqual(s.addon, 1);      // 308
  assert.strictEqual(s.completed, 1);
  assert.strictEqual(s.pending, 3);
  assert.strictEqual(s.total, 4);
});

test('normalizeSlots / addSlot / enabledSlots: 時段操作', () => {
  assert.deepStrictEqual(C.normalizeSlots([' 8:15 ', '', ' 9:30']), ['8:15', '9:30']);
  assert.deepStrictEqual(C.normalizeSlots(undefined), []);

  let slots = C.addSlot([], '8:15');
  slots = C.addSlot(slots, '8:15');       // 重複不加
  slots = C.addSlot(slots, ' 9:30 ');     // 去空白
  slots = C.addSlot(slots, '');           // 空不加
  assert.deepStrictEqual(slots, [{ label: '8:15', enabled: true }, { label: '9:30', enabled: true }]);

  const mixed = [{ label: '8:15', enabled: true }, { label: '9:30', enabled: false }, { label: ' 10:00 ', enabled: true }];
  assert.deepStrictEqual(C.enabledSlots(mixed), ['8:15', '10:00']);
  assert.deepStrictEqual(C.enabledSlots([]), []);
});

test('sortSlots: 依時間由小到大，無法解析的放最後', () => {
  const slots = [
    { label: '9:30', enabled: true },
    { label: '8:15', enabled: true },
    { label: '10:00', enabled: true },
    { label: '早餐後', enabled: false },
    { label: '12:05', enabled: true },
  ];
  const sorted = C.sortSlots(slots);
  assert.deepStrictEqual(sorted.map(s => s.label), ['8:15', '9:30', '10:00', '12:05', '早餐後']);
  assert.strictEqual(sorted[4].enabled, false);
  assert.strictEqual(C.sortSlots(undefined).length, 0);
});

test('assignGroupColors: 依 orderId 分組、空 orderId 退 source、穩定', () => {
  const palette = ['#e64980', '#9775fa', '#4dabf7'];
  const rooms = [
    { roomNumber: '106', orderId: 'A', source: '官網' },
    { roomNumber: '301', orderId: 'A', source: '官網' },
    { roomNumber: '508', orderId: 'A', source: '官網' },
    { roomNumber: '312', orderId: '', source: '短租' },
    { roomNumber: '507', orderId: '', source: '短租' },
    { roomNumber: '101', orderId: '', source: 'Booking.com' },
  ];
  const m = C.assignGroupColors(rooms, palette);
  assert.strictEqual(m['106'], m['301']);  // 同訂單同色
  assert.strictEqual(m['301'], m['508']);
  assert.strictEqual(m['312'], m['507']);  // 同來源同色
  assert.notStrictEqual(m['312'], m['101']);
  const m2 = C.assignGroupColors(rooms, palette);
  assert.strictEqual(m['106'], m2['106']); // 穩定
  assert.strictEqual(m['312'], m2['312']);
});

test('sortRoomsGrouped: 同姓名相鄰、組間依最小房號、組內依房號', () => {
  const rooms = [
    { roomNumber: '305', guestName: '王小明' },
    { roomNumber: '306', guestName: '陳大文' },
    { roomNumber: '308', guestName: '王小明' },
    { roomNumber: '502', guestName: '王小明' },
    { roomNumber: '201', guestName: '陳大文' },
  ];
  const out = C.sortRoomsGrouped(rooms).map(r => r.roomNumber);
  // 陳大文組最小 201 < 王小明組最小 305 → 陳大文組在前
  assert.deepStrictEqual(out, ['201', '306', '305', '308', '502']);
});

test('sortRoomsGrouped: 無姓名房排最後（依房號）', () => {
  const rooms = [
    { roomNumber: '502', guestName: '王小明' },
    { roomNumber: '305', guestName: '王小明' },
    { roomNumber: '101', guestName: '' },
    { roomNumber: '601', guestName: '   ' },
    { roomNumber: '308', guestName: '王小明' },
  ];
  const out = C.sortRoomsGrouped(rooms).map(r => r.roomNumber);
  assert.deepStrictEqual(out, ['305', '308', '502', '101', '601']);
});

test('sortRoomsGrouped: 多組 + 無姓名混合、結果穩定、空輸入', () => {
  const rooms = [
    { roomNumber: '507', guestName: '' },
    { roomNumber: '305', guestName: '王小' },
    { roomNumber: '502', guestName: '王小' },
    { roomNumber: '201', guestName: '陳大' },
    { roomNumber: '308', guestName: '王小' },
    { roomNumber: '306', guestName: '陳大' },
    { roomNumber: '101', guestName: '' },
  ];
  const expected = ['201', '306', '305', '308', '502', '101', '507'];
  assert.deepStrictEqual(C.sortRoomsGrouped(rooms).map(r => r.roomNumber), expected);
  assert.deepStrictEqual(C.sortRoomsGrouped(rooms).map(r => r.roomNumber), expected); // 穩定
  assert.deepStrictEqual(C.sortRoomsGrouped([]), []);
  assert.deepStrictEqual(C.sortRoomsGrouped(undefined), []);
});

test('computeHotPeople: 基本加總（熟食總人數 = 大人 + 小孩）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1, infant: 0 },
    { roomNumber: '308', source: 'Agoda', eggMilk: '加購', adult: 1, child: 2, infant: 0 },
  ];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 3, kid: 3, people: 6 });
  assert.deepStrictEqual(out.pending, { adult: 3, kid: 3, people: 6 });
});

test('computeHotPeople: 小孩 = child + infant（訂單模式三欄）', () => {
  const rooms = [{ roomNumber: '201', source: '官網', adult: 2, child: 1, infant: 2 }];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.strictEqual(out.total.adult, 2);
  assert.strictEqual(out.total.kid, 3);
  assert.strictEqual(out.total.people, 5);
});

test('computeHotPeople: 已用餐的房間整間扣除（total 不變、pending 減）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1, infant: 1 },
    { roomNumber: '308', source: 'Agoda', eggMilk: '加購', adult: 1, child: 0, infant: 0 },
  ];
  const oneDone = C.computeHotPeople(rooms, (r) => (r.roomNumber === '101' ? 'completed' : 'pending'));
  assert.deepStrictEqual(oneDone.total, { adult: 3, kid: 2, people: 5 });
  assert.deepStrictEqual(oneDone.pending, { adult: 1, kid: 0, people: 1 });
  const allDone = C.computeHotPeople(rooms, () => 'completed');
  assert.deepStrictEqual(allDone.total, { adult: 3, kid: 2, people: 5 });
  assert.deepStrictEqual(allDone.pending, { adult: 0, kid: 0, people: 0 });
});

test('computeHotPeople: 排除不用餐的房間（isNoMeal）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1, mealTime: '' },
    { roomNumber: '102', source: '手動訂單', adult: 3, child: 3, mealTime: '不用餐' },
  ];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 2, kid: 1, people: 3 });
  assert.deepStrictEqual(out.pending, { adult: 2, kid: 1, people: 3 });
});

test('computeHotPeople: 排除非熟食房（平台房、不加購房）', () => {
  const rooms = [
    { roomNumber: '101', source: '官網', adult: 2, child: 1 },
    { roomNumber: '312', source: 'Booking.com', adult: 4, child: 4 },
    { roomNumber: '507', source: '官網', vegan: '不加購', adult: 5, child: 5 },
  ];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 2, kid: 1, people: 3 });
  assert.deepStrictEqual(out.pending, { adult: 2, kid: 1, people: 3 });
});

test('computeHotPeople: 空／undefined 輸入回傳全 0', () => {
  const expected = {
    total: { adult: 0, kid: 0, people: 0 },
    pending: { adult: 0, kid: 0, people: 0 },
  };
  assert.deepStrictEqual(C.computeHotPeople([], () => 'pending'), expected);
  assert.deepStrictEqual(C.computeHotPeople(undefined, () => 'pending'), expected);
});

test('computeHotPeople: 舊純房號模式（無人數欄位）回傳全 0', () => {
  const rooms = [{ roomNumber: '101', source: '官網', vegan: '', eggMilk: '' }];
  const out = C.computeHotPeople(rooms, () => 'pending');
  assert.deepStrictEqual(out.total, { adult: 0, kid: 0, people: 0 });
  assert.deepStrictEqual(out.pending, { adult: 0, kid: 0, people: 0 });
});

test('clearRooms: 清空房號，但 settings 與 daily 完整保留', () => {
  const state = {
    version: 1,
    settings: {
      types: [{ id: 'hot', label: '熱食', emoji: '🔥' }],
      prep: { jellyRatio: 1.1, eggRatio: 1.5, riceAdult: 0.2, riceChild: 0.1, specialDiv: 12 },
      mealSlots: [{ label: '07:30', enabled: true }],
      sortMode: 'name'
    },
    rooms: [{ roomNumber: '101', breakfastType: 'hot' }, { roomNumber: '205', breakfastType: 'hot' }],
    daily: { '2026-10-03': { '101': 'completed' } }
  };
  const before = JSON.parse(JSON.stringify(state));
  const next = C.clearRooms(state);

  assert.deepStrictEqual(next.rooms, []);
  assert.deepStrictEqual(next.settings, before.settings);
  assert.deepStrictEqual(next.daily, before.daily);
  assert.strictEqual(next.version, 1);
});

test('clearRooms: 不 mutate 傳入的 state', () => {
  const state = {
    settings: { prep: { jellyRatio: 1.1 }, types: [], mealSlots: [], sortMode: 'room' },
    rooms: [{ roomNumber: '101' }],
    daily: {}
  };
  C.clearRooms(state);
  assert.strictEqual(state.rooms.length, 1);
});

test('clearRooms: rooms 本來就是空陣列時仍回傳空陣列', () => {
  const next = C.clearRooms({ version: 1, settings: {}, rooms: [], daily: {} });
  assert.deepStrictEqual(next.rooms, []);
});

test('sortRoomsByMealTime: 依時間早→晚排序', () => {
  const rooms = [
    { roomNumber: '101', mealTime: '09:00' },
    { roomNumber: '102', mealTime: '07:30' },
    { roomNumber: '103', mealTime: '08:00' },
  ];
  assert.deepStrictEqual(
    C.sortRoomsByMealTime(rooms).map(r => r.roomNumber),
    ['102', '103', '101']
  );
});

test('sortRoomsByMealTime: 無時間／不用餐殿後，該組內依房號', () => {
  const rooms = [
    { roomNumber: '105', mealTime: '' },
    { roomNumber: '101', mealTime: '08:00' },
    { roomNumber: '103', mealTime: '不用餐' },
    { roomNumber: '102', mealTime: '07:00' },
    { roomNumber: '104', mealTime: '  ' },
  ];
  assert.deepStrictEqual(
    C.sortRoomsByMealTime(rooms).map(r => r.roomNumber),
    ['102', '101', '103', '104', '105']
  );
});

test('sortRoomsByMealTime: 同時間併列依房號', () => {
  const rooms = [
    { roomNumber: '308', mealTime: '08:00' },
    { roomNumber: '101', mealTime: '08:00' },
    { roomNumber: '205', mealTime: '08:00' },
  ];
  assert.deepStrictEqual(
    C.sortRoomsByMealTime(rooms).map(r => r.roomNumber),
    ['101', '205', '308']
  );
});

test('sortRoomsByMealTime: 無效時間格式視為無時間', () => {
  const rooms = [
    { roomNumber: '101', mealTime: '9:7' },
    { roomNumber: '102', mealTime: '13:00' },
    { roomNumber: '103', mealTime: '08:3' },
    { roomNumber: '104', mealTime: '08:00' },
  ];
  assert.deepStrictEqual(
    C.sortRoomsByMealTime(rooms).map(r => r.roomNumber),
    ['104', '101', '102', '103']
  );
});

test('sortRoomsByMealTime: 不修改原陣列', () => {
  const rooms = [
    { roomNumber: '101', mealTime: '09:00' },
    { roomNumber: '102', mealTime: '07:00' },
  ];
  const copy = rooms.map(r => r.roomNumber);
  C.sortRoomsByMealTime(rooms);
  assert.deepStrictEqual(rooms.map(r => r.roomNumber), copy);
});

test('sortRoomsByMealTime: 空／undefined 輸入回傳 []', () => {
  assert.deepStrictEqual(C.sortRoomsByMealTime([]), []);
  assert.deepStrictEqual(C.sortRoomsByMealTime(undefined), []);
});

test('sortRoomsPendingFirst: 未用餐在前、已用餐在後，同組依房號', () => {
  const rooms = [
    { roomNumber: '105' }, { roomNumber: '101' }, { roomNumber: '103' },
    { roomNumber: '102' }, { roomNumber: '104' },
  ];
  const done = new Set(['101', '103']);
  assert.deepStrictEqual(
    C.sortRoomsPendingFirst(rooms, r => done.has(r.roomNumber)).map(r => r.roomNumber),
    ['102', '104', '105', '101', '103']
  );
});

test('sortRoomsPendingFirst: 未提供判斷函式視為全部未完成（依房號）', () => {
  const rooms = [{ roomNumber: '205' }, { roomNumber: '101' }];
  assert.deepStrictEqual(C.sortRoomsPendingFirst(rooms).map(r => r.roomNumber), ['101', '205']);
});

test('sortRoomsPendingFirst: 不修改原陣列、空輸入回傳 []', () => {
  const rooms = [{ roomNumber: '101' }, { roomNumber: '102' }];
  const copy = rooms.map(r => r.roomNumber);
  C.sortRoomsPendingFirst(rooms, r => r.roomNumber === '101');
  assert.deepStrictEqual(rooms.map(r => r.roomNumber), copy);
  assert.deepStrictEqual(C.sortRoomsPendingFirst([]), []);
  assert.deepStrictEqual(C.sortRoomsPendingFirst(undefined), []);
});

// ===== 批次文字指令 =====

const CMD_ROOMS = [
  { roomNumber: '201', source: '官網', adult: 1, child: 0, infant: 0, eggMilk: '', vegan: '', mealTime: '', breakfastType: 'hot' },
  { roomNumber: '202', source: '官網', adult: 2, child: 1, infant: 0, eggMilk: '蛋奶加購', vegan: '', mealTime: '', breakfastType: 'hot' },
  { roomNumber: '203', source: '官網', adult: 2, child: 0, infant: 0, eggMilk: '', vegan: '不加購', mealTime: '', breakfastType: 'normal' },
  { roomNumber: '204', source: '官網', adult: 2, child: 0, infant: 0, eggMilk: '', vegan: '', mealTime: '不用餐', breakfastType: 'normal' },
];

test('parseRoomCommand: 順序不限，抓房號／人數／加購／蛋奶', () => {
  const r = C.parseRoomCommand('加購 蛋奶 2大1小 201', CMD_ROOMS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.roomNumber, '201');
  assert.strictEqual(r.patch.adult, 2);
  assert.strictEqual(r.patch.child, 1);
  assert.strictEqual(r.patch.eggMilk, '蛋奶加購');
  assert.strictEqual(r.patch.vegan, '');
  assert.ok(r.changes.some(c => c.label === '大人' && c.to === '2'));
  assert.ok(r.changes.some(c => c.label === '餐點'));
});

test('parseRoomCommand: 全素會自動視為加購', () => {
  const r = C.parseRoomCommand('201 全素 1大', CMD_ROOMS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.patch.eggMilk, '全素加購');
  assert.strictEqual(r.patch.adult, 1);
});

test('parseRoomCommand: 中文數字（二大一小）', () => {
  const r = C.parseRoomCommand('201 二大一小 加購', CMD_ROOMS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.patch.adult, 2);
  assert.strictEqual(r.patch.child, 1);
});

test('parseRoomCommand: 不加購（8欄房會清掉人數）', () => {
  const rooms = [{ roomNumber: '301', source: '官網', adult: '2', child: '1', eggMilk: '', vegan: '', mealTime: '', breakfastType: 'normal' }];
  const r = C.parseRoomCommand('301 不加購', rooms);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.patch.vegan, '不加購');
  assert.strictEqual(r.patch.adult, '');
  assert.strictEqual(r.patch.child, '');
});

test('parseRoomCommand: 不用餐與恢復用餐', () => {
  const a = C.parseRoomCommand('202 不用餐', CMD_ROOMS);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.patch.mealTime, '不用餐');
  const b = C.parseRoomCommand('204 要用餐', CMD_ROOMS);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.patch.mealTime, '');
});

test('parseRoomCommand: 時間支援 8:30／8點半／08:30', () => {
  for (const text of ['201 8:30', '201 8點半', '201 08:30']) {
    const r = C.parseRoomCommand(text, CMD_ROOMS);
    assert.strictEqual(r.ok, true, text);
    assert.strictEqual(r.patch.mealTime, '08:30', text);
  }
});

test('parseRoomCommand: 已吃／未吃寫入用餐狀態', () => {
  assert.strictEqual(C.parseRoomCommand('201 已吃', CMD_ROOMS).dailyStatus, 'completed');
  assert.strictEqual(C.parseRoomCommand('201 未用餐', CMD_ROOMS).dailyStatus, 'pending');
});

test('parseRoomCommand: 房號不存在／找不到房號／沒有動作都要擋下', () => {
  assert.strictEqual(C.parseRoomCommand('999 2大1小', CMD_ROOMS).ok, false);
  assert.strictEqual(C.parseRoomCommand('2大1小 加購', CMD_ROOMS).ok, false);
  assert.strictEqual(C.parseRoomCommand('201', CMD_ROOMS).ok, false);
});

test('parseRoomCommand: 衝突指令要擋下', () => {
  assert.strictEqual(C.parseRoomCommand('201 加購 不加購', CMD_ROOMS).ok, false);
  assert.strictEqual(C.parseRoomCommand('201 不用餐 08:30', CMD_ROOMS).ok, false);
  assert.strictEqual(C.parseRoomCommand('201 不用餐 加購', CMD_ROOMS).ok, false);
  assert.strictEqual(C.parseRoomCommand('201 已吃 未吃', CMD_ROOMS).ok, false);
  assert.strictEqual(C.parseRoomCommand('201 全素 蛋奶', CMD_ROOMS).ok, false);
});

test('parseRoomCommand: 舊格式房不能改人數／餐點', () => {
  const rooms = [{ roomNumber: '101', breakfastType: 'normal' }];
  const r = C.parseRoomCommand('101 2大1小 加購', rooms);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('舊格式')));
});

test('splitRoomCommands: 換行、分號、連續多房都能拆', () => {
  assert.deepStrictEqual(
    C.splitRoomCommands('201 2大1小\n202 不用餐；203 08:30'),
    ['201 2大1小', '202 不用餐', '203 08:30']
  );
  assert.deepStrictEqual(
    C.splitRoomCommands('201 2大1小 202 不用餐 203 08:30'),
    ['201 2大1小', '202 不用餐', '203 08:30']
  );
});

test('splitRoomCommands: 空字串回空陣列', () => {
  assert.deepStrictEqual(C.splitRoomCommands(''), []);
  assert.deepStrictEqual(C.splitRoomCommands(null), []);
});

// ===== 房號備註 =====

test('noteGet: 缺值一律回空字串', () => {
  assert.strictEqual(C.noteGet(null, '2026-10-25', '201', 'eaten'), '');
  assert.strictEqual(C.noteGet({}, '2026-10-25', '201', 'eaten'), '');
  assert.strictEqual(C.noteGet({ '2026-10-25': {} }, '2026-10-25', '201', 'eaten'), '');
  assert.strictEqual(C.noteGet({ '2026-10-25': { '201': {} } }, '2026-10-25', '201', 'eaten'), '');
  const notes = { '2026-10-25': { '201': { eaten: '1大已吃' } } };
  assert.strictEqual(C.noteGet(notes, '2026-10-25', '201', 'eaten'), '1大已吃');
  assert.strictEqual(C.noteGet(notes, '2026-10-25', '201', 'veg'), '');
});

test('noteSet: 回傳新物件，不改動原本的 notes', () => {
  const notes = {};
  const next = C.noteSet(notes, '2026-10-25', '201', 'eaten', '1大已吃');
  assert.deepStrictEqual(notes, {});
  assert.strictEqual(C.noteGet(next, '2026-10-25', '201', 'eaten'), '1大已吃');
});

test('noteSet: 空字串／純空白會刪掉欄位、房號 key、日期 key', () => {
  let notes = C.noteSet({}, '2026-10-25', '201', 'eaten', '有值');
  notes = C.noteSet(notes, '2026-10-25', '201', 'veg', '也有的值');
  notes = C.noteSet(notes, '2026-10-25', '201', 'eaten', '   ');
  assert.deepStrictEqual(notes, { '2026-10-25': { '201': { veg: '也有的值' } } });
  notes = C.noteSet(notes, '2026-10-25', '201', 'veg', '');
  assert.deepStrictEqual(notes, {});
});

test('noteSet: 超過上限會截斷至 NOTE_MAX', () => {
  const long = 'あ'.repeat(C.NOTE_MAX + 50);
  const notes = C.noteSet({}, '2026-10-25', '201', 'veg', long);
  const v = C.noteGet(notes, '2026-10-25', '201', 'veg');
  assert.strictEqual(v.length, C.NOTE_MAX);
});

test('noteCount: 計數有值的備註條數', () => {
  assert.strictEqual(C.noteCount({}, '2026-10-25', '201'), 0);
  let notes = C.noteSet({}, '2026-10-25', '201', 'eaten', '1大');
  assert.strictEqual(C.noteCount(notes, '2026-10-25', '201'), 1);
  notes = C.noteSet(notes, '2026-10-25', '201', 'veg', '1人素');
  assert.strictEqual(C.noteCount(notes, '2026-10-25', '201'), 2);
});

test('migrateNote: 換房時搬移並刪除舊房號', () => {
  const notes = C.noteSet({}, '2026-10-25', '201', 'eaten', '1大已吃');
  const next = C.migrateNote(notes, '2026-10-25', '201', '205');
  assert.strictEqual(C.noteGet(next, '2026-10-25', '205', 'eaten'), '1大已吃');
  assert.strictEqual(C.noteGet(next, '2026-10-25', '201', 'eaten'), '');
  assert.strictEqual(C.noteGet(notes, '2026-10-25', '201', 'eaten'), '1大已吃');
});

test('migrateNote: 同房號或來源不存在時為 no-op', () => {
  const notes = C.noteSet({}, '2026-10-25', '201', 'eaten', '1大');
  assert.strictEqual(C.migrateNote(notes, '2026-10-25', '201', '201'), notes);
  assert.strictEqual(C.migrateNote(notes, '2026-10-25', '999', '205'), notes);
  assert.deepStrictEqual(C.migrateNote({}, '2026-10-25', '201', '205'), {});
});

test('clearNotesForDate: 只清指定日期，其他日期保留', () => {
  let notes = C.noteSet({}, '2026-10-25', '201', 'eaten', 'a');
  notes = C.noteSet(notes, '2026-10-26', '201', 'eaten', 'b');
  const next = C.clearNotesForDate(notes, '2026-10-25');
  assert.strictEqual(next['2026-10-25'], undefined);
  assert.strictEqual(C.noteGet(next, '2026-10-26', '201', 'eaten'), 'b');
});

test('sanitizeNotes: 壞形狀一律回 {}', () => {
  assert.deepStrictEqual(C.sanitizeNotes(null), {});
  assert.deepStrictEqual(C.sanitizeNotes(undefined), {});
  assert.deepStrictEqual(C.sanitizeNotes([]), {});
  assert.deepStrictEqual(C.sanitizeNotes('x'), {});
  assert.deepStrictEqual(C.sanitizeNotes({ '2026-10-25': 'not-object' }), {});
  assert.deepStrictEqual(C.sanitizeNotes({ '2026-10-25': { '201': 'not-object' } }), {});
});

test('sanitizeNotes: 清掉非字串、空值與超長內容', () => {
  const dirty = {
    '2026-10-25': {
      '201': { eaten: '  1大已吃  ', veg: '', bad: 123 },
      '202': { eaten: null },
    },
    '2026-10-26': { 'dummy': {} },
  };
  const clean = C.sanitizeNotes(dirty);
  assert.deepStrictEqual(clean, { '2026-10-25': { '201': { eaten: '1大已吃' } } });
  const long = { '2026-10-25': { '201': { veg: 'x'.repeat(C.NOTE_MAX + 10) } } };
  assert.strictEqual(C.sanitizeNotes(long)['2026-10-25']['201'].veg.length, C.NOTE_MAX);
});