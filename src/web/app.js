/* AI 扑克擂台 — 观战页面逻辑（原生 JS + SSE） */

const COLORS = ['#e8590c', '#4c6ef5', '#12b886', '#f76707', '#7048e8', '#c2255c', '#1098ad', '#5c940d'];
const ACTION_CN = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', all_in: '全下' };
const RED_SUITS = new Set(['♥', '♦']);

const state = {
  players: new Map(), // id -> {id,name,color,kind,model,stack,hole:[],folded,allIn,committed,isDealer,isSB,isBB,lastAction,busted,rank}
  humanIds: [], // 当前同桌的人类玩家座位 id（可多个）
  handNumber: 0,
  level: 1,
  sb: 10,
  bb: 20,
  pot: 0,
  community: [],
  streetName: '',
  started: false,
  elimEvery: 5, // 每 N 局末尾淘汰（从后端读取）
};

// 我的座位：每台设备选一个真人座位（localStorage 记住），纯观战为 null
let mySeat = localStorage.getItem('poker-seat') || null;
let viewerParam = mySeat || 'spectator';

// 读取淘汰循环配置
fetch('/api/status')
  .then((r) => r.json())
  .then((s) => { if (s.eliminateBottomEvery) state.elimEvery = s.eliminateBottomEvery; })
  .catch(() => {});

const $ = (sel) => document.querySelector(sel);

/* ---------- 座位布局 ---------- */
function layoutSeats() {
  const table = $('#table');
  const rect = table.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const rx = rect.width * 0.40;
  const ry = rect.height * 0.36;
  const ids = [...state.players.keys()];
  const n = ids.length;
  ids.forEach((id, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const seat = document.getElementById(`seat-${id}`);
    if (!seat) return;
    seat.style.left = `${cx + rx * Math.cos(angle)}px`;
    seat.style.top = `${cy + ry * Math.sin(angle)}px`;
  });
}

/* 显示用牌面文本：T → 10（引擎和 AI 用标准 T 记法，观众界面用 10） */
function cardText(card) {
  return (card[0] === 'T' ? '10' : card[0]) + card[1];
}

function cardEl(card, small) {
  const div = document.createElement('div');
  div.className = `card ${small ? 'small' : ''} ${RED_SUITS.has(card[1]) ? 'red' : ''}`;
  const rankText = card[0] === 'T' ? '10' : card[0];
  const corner = document.createElement('span');
  corner.className = 'corner';
  corner.textContent = rankText;
  const suit = document.createElement('span');
  suit.className = 'suit';
  suit.textContent = card[1];
  div.appendChild(corner);
  div.appendChild(suit);
  const corner2 = corner.cloneNode(true);
  corner2.classList.add('bottom');
  div.appendChild(corner2);
  return div;
}

function cardBackEl() {
  const d = document.createElement('div');
  d.className = 'card small back';
  return d;
}

/* 渲染座位底牌：
 * - 有真人同桌时，只显示"我的座位"的底牌；其它真人/AI 底牌盖住（服务器也只发了我的）
 * - 纯 AI 对局（无真人）：观战者全部可见
 * - 摊牌时(force)全部亮牌（showdown 事件统一发放）
 */
function renderHole(seat, p, force = false) {
  const hole = seat.querySelector('.hole');
  hole.innerHTML = '';
  const humansPresent = state.humanIds.length > 0;
  const hide = humansPresent && p.id !== mySeat && !force;
  const cards = hide || p.hole.length === 0 ? [null, null] : p.hole;
  for (const c of cards) {
    hole.appendChild(c ? cardEl(c, true) : cardBackEl());
  }
}

function renderSeats() {
  const seats = $('#seats');
  seats.innerHTML = '';
  for (const p of state.players.values()) {
    const seat = document.createElement('div');
    seat.className = 'seat' + (p.id === mySeat ? ' mine' : '');
    seat.id = `seat-${p.id}`;
    const humanMark = state.humanIds.includes(p.id) ? ' <span class="human-tag">👤</span>' : '';
    seat.innerHTML = `
      <div class="seat-inner">
        <div class="avatar" style="background:${p.color}">
          ${p.name[0]}
          <span class="badge d" style="display:none">庄</span>
          <span class="badge sb" style="display:none">SB</span>
          <span class="badge bb" style="display:none">BB</span>
        </div>
        <div class="name" title="${p.name}">${p.name}${p.id === mySeat ? '<em class="mine-tag">（我）</em>' : ''}${humanMark}</div>
        <div class="seat-status"></div>
        <div class="model" title="${p.model}">${p.model}</div>
        <div class="stack">${p.stack}</div>
        <div class="hole"></div>
        <div class="bet-chip" style="display:none"></div>
        <div class="action-flag"></div>
      </div>`;
    // 点击座位 → 打开配置弹窗
    seat.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlayerModal(p.id);
    });
    seats.appendChild(seat);
  }
  layoutSeats();
  if (!resizeBound) {
    window.addEventListener('resize', layoutSeats);
    resizeBound = true;
  }
}
let resizeBound = false;

/* ---------- 玩家配置弹窗 ---------- */
let pmPlayerId = null;
let pmProviders = [];

async function openPlayerModal(playerId) {
  pmPlayerId = playerId;
  try {
    const resp = await fetch('/api/players');
    const data = await resp.json();
    pmProviders = data.providers;
    const player = data.players.find((p) => p.id === playerId);
    if (!player) return;
    $('#pm-name').textContent = `${player.name}（${playerId}）`;
    const sel = $('#pm-provider');
    sel.innerHTML = '';
    const options = [
      ['human', '🧑 人类玩家操控'],
      ['heuristic', '🤖 启发式机器人（本地）'],
      ...data.providers.map((p) => [p.name, p.label]),
    ];
    for (const [val, label] of options) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === player.provider) opt.selected = true;
      sel.appendChild(opt);
    }
    $('#pm-model').value = player.model;
    $('#pm-key').value = '';
    updateKeyStatus();
    $('#pm-msg').textContent = '';
    $('#player-modal').classList.remove('hidden');
  } catch (err) {
    console.error('加载配置失败', err);
  }
}

function updateKeyStatus() {
  const p = pmProviders.find((x) => x.name === $('#pm-provider').value);
  const el = $('#pm-key-status');
  if (!p) { el.textContent = ''; el.className = 'pm-status'; return; }
  el.textContent = p.keySet ? '✓ 已配置' : '✗ 未配置';
  el.className = p.keySet ? 'pm-status ok' : 'pm-status no';
}

$('#pm-provider').addEventListener('change', updateKeyStatus);
$('#pm-close').addEventListener('click', () => $('#player-modal').classList.add('hidden'));
$('#player-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#player-modal').classList.add('hidden'); });

$('#pm-save').addEventListener('click', async () => {
  const msg = $('#pm-msg');
  msg.textContent = '保存中…';
  try {
    const provider = $('#pm-provider').value;
    const model = $('#pm-model').value.trim();
    const apiKey = $('#pm-key').value.trim();
    // 1. 更新玩家 provider/model
    const r1 = await fetch(`/api/players/${pmPlayerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model: model || undefined }),
    });
    const j1 = await r1.json();
    if (!r1.ok) throw new Error(j1.error || '保存玩家配置失败');
    // 2. 如果填了 API key，保存到对应 provider
    let keyNote = '';
    if (apiKey && provider !== 'heuristic') {
      const r2 = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: provider, apiKey }),
      });
      const j2 = await r2.json();
      if (!r2.ok) throw new Error(j2.error || '保存 API key 失败');
      keyNote = ' + key';
    }
    msg.textContent = `✅ ${j1.note}${keyNote}，页面将自动刷新现场…`;
    msg.style.color = '#7CFC00';
    setTimeout(() => $('#player-modal').classList.add('hidden'), 1200);
  } catch (err) {
    msg.textContent = `❌ ${err.message}`;
    msg.style.color = '#ff8787';
  }
});

function updateSeat(p) {
  const seat = document.getElementById(`seat-${p.id}`);
  if (!seat) return;
  const nameEl = seat.querySelector('.name');
  if (nameEl && nameEl.textContent !== p.name) {
    nameEl.textContent = p.name;
    nameEl.title = p.name;
  }
  const stackEl = seat.querySelector('.stack');
  const prev = Number(stackEl.dataset.v ?? '');
  if (prev && p.stack !== prev) {
    stackEl.classList.remove('gain', 'loss');
    void stackEl.offsetWidth; // 重启动画
    stackEl.classList.add(p.stack > prev ? 'gain' : 'loss');
  }
  stackEl.dataset.v = String(p.stack);
  stackEl.textContent = p.stack;
  seat.querySelector('.badge.d').style.display = p.isDealer ? 'inline-block' : 'none';
  seat.querySelector('.badge.sb').style.display = p.isSB ? 'inline-block' : 'none';
  seat.querySelector('.badge.bb').style.display = p.isBB ? 'inline-block' : 'none';
  seat.classList.toggle('folded', !!p.folded);
  seat.classList.toggle('busted', !!p.busted);
  seat.classList.toggle('active', !!p.isActive);
  // 名字下方持续标注状态：弃牌/全下（新手牌开始时由 hand_start 重置）
  const statusEl = seat.querySelector('.seat-status');
  if (p.folded) {
    statusEl.textContent = '🚫 弃牌';
    statusEl.className = 'seat-status folded';
  } else if (p.allIn) {
    statusEl.textContent = '🃏 全下';
    statusEl.className = 'seat-status allin';
  } else {
    statusEl.textContent = '';
    statusEl.className = 'seat-status';
  }
  const flag = seat.querySelector('.action-flag');
  if (p.lastAction) {
    flag.textContent = ACTION_CN[p.lastAction] ?? p.lastAction;
    seat.classList.add('show-flag');
    setTimeout(() => seat.classList.remove('show-flag'), 2200);
  }
  const bet = seat.querySelector('.bet-chip');
  if (p.committed > 0) {
    bet.textContent = p.committed;
    bet.style.display = 'block';
  } else {
    bet.style.display = 'none';
  }
  const hole = seat.querySelector('.hole');
  renderHole(seat, p);
  if (p.hole.length === 2 && !seat.querySelector('.hole .card.back')) {
    // 补齐两张
  }
}

function setHoleCards(playerId, cards, force = false) {
  const p = state.players.get(playerId);
  if (!p) return;
  p.hole = cards;
  const seat = document.getElementById(`seat-${playerId}`);
  if (!seat) return;
  renderHole(seat, p, force);
}

function renderCommunity() {
  const box = $('#community-cards');
  box.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const c = state.community[i];
    if (c) box.appendChild(cardEl(c, false));
    else box.appendChild(document.createElement('div')).className = 'card back';
  }
  $('#pot').textContent = `底池 ${state.pot}`;
  $('#hand-num').textContent = state.handNumber
    ? `第 ${state.handNumber} 手 · ${state.streetName || '翻前'} · ${state.players.size} 人`
    : '';
}

function renderLevel() {
  $('#level-info').textContent = `L${state.level} · SB ${state.sb} / BB ${state.bb}`;
}

function addLog(html, cls = 'action') {
  if (silentMode) return; // 历史重放时静默
  const body = $('#log-body');
  const div = document.createElement('div');
  div.className = `log-line ${cls}`;
  div.innerHTML = html;
  body.appendChild(div);
  // 自动滚动
  body.scrollTop = body.scrollHeight;
  while (body.children.length > 400) body.removeChild(body.firstChild);
}

function updateRankings() {
  const list = $('#ranking-list');
  const ranked = [...state.players.values()].sort((a, b) => (b.busted ? -1 : 1) - (a.busted ? -1 : 1) || b.stack - a.stack);
  list.innerHTML = '';
  ranked.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.busted) li.style.opacity = '0.55';
    li.innerHTML = `
      <span class="r-pos">${p.busted ? `#${p.rank}` : i + 1}</span>
      <span class="r-avatar" style="background:${p.color}">${p.name[0]}</span>
      <span class="r-name">${p.name}</span>
      <span class="r-stack">${p.busted ? '💀' : p.stack}</span>`;
    list.appendChild(li);
  });
}

/* ---------- 座位选择（多真人同桌：每台设备选自己的座位） ---------- */
function setMySeat(seatId) {
  mySeat = seatId || null;
  viewerParam = mySeat || 'spectator';
  if (mySeat) localStorage.setItem('poker-seat', mySeat);
  else localStorage.removeItem('poker-seat');
  $('#seat-overlay').classList.add('hidden');
  // 重连 SSE：服务器按新 viewer 过滤底牌（只发我这个座位的）
  reconnect();
  // 若已有牌桌，立即刷新座位高亮与底牌显示（中途选座也要即时生效）
  for (const p of state.players.values()) {
    const seat = document.getElementById(`seat-${p.id}`);
    if (seat) seat.classList.toggle('mine', p.id === mySeat);
    updateSeat(p);
  }
  const chip = $('#btn-seat');
  const chipName = $('#seat-chip-name');
  if (mySeat && state.humanIds.includes(mySeat)) {
    const me = state.players.get(mySeat);
    chipName.textContent = me ? me.name : mySeat;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
  const tip = $('#seat-tip');
  if (mySeat && !state.humanIds.includes(mySeat)) {
    tip.textContent = '⚠️ 这个座位现在不是人类玩家了（可能被改成 AI），请重选。';
  } else if (!mySeat) {
    tip.textContent = '👁 观战模式：底牌全部盖住（有真人同桌时）。';
  }
}

async function openSeatOverlay() {
  const tip = $('#seat-tip');
  tip.textContent = '';
  const list = $('#seat-list');
  let humans = [];
  try {
    const data = await (await fetch('/api/players')).json();
    humans = data.players.filter((p) => p.provider === 'human');
  } catch (err) {
    console.error('读取玩家配置失败', err);
  }
  // 在 await 之后清空再填充，避免多次并发调用（页面加载 + game_start）竞态导致选项重复
  list.innerHTML = '';
  if (humans.length === 0) {
    list.innerHTML = '<div class="seat-none">当前没有人类玩家座位。<br>点击任意座位头像 → 把 Provider 改为「🧑 人类玩家操控」后保存，真人即可加入。</div>';
  } else {
    for (const h of humans) {
      const btn = document.createElement('button');
      btn.className = 'seat-option' + (h.id === mySeat ? ' selected' : '');
      btn.innerHTML = `<span class="so-avatar">${h.name[0]}</span><span class="so-name">${h.name}</span><span class="so-sub">${h.id}${h.id === mySeat ? ' · 当前选择' : ''}</span>`;
      btn.addEventListener('click', () => setMySeat(h.id));
      list.appendChild(btn);
    }
  }
  $('#seat-overlay').classList.remove('hidden');
}

$('#seat-spectate').addEventListener('click', () => setMySeat(null));
$('#btn-seat').addEventListener('click', openSeatOverlay);

/* ---------- 人类玩家操作面板 ---------- */
let hpRequest = null;

function showHumanPanel(req) {
  hpRequest = req;
  const cards = $('#hp-cards');
  cards.innerHTML = '';
  for (const c of req.holeCards) cards.appendChild(cardEl(c, false));
  const streetName = req.street === 'preflop' ? '翻前' : req.street === 'flop' ? '翻牌' : req.street === 'turn' ? '转牌' : '河牌';
  $('#hp-situation').textContent = `${streetName} · 底池 ${req.pot} · ${req.toCall > 0 ? `需跟 ${req.toCall}` : '免费看牌'}`;
  $('#hp-fold').style.display = req.legalActions.includes('fold') ? '' : 'none';
  $('#hp-check').style.display = req.legalActions.includes('check') ? '' : 'none';
  const hasCall = req.legalActions.includes('call');
  $('#hp-call').style.display = hasCall ? '' : 'none';
  if (hasCall) $('#hp-call-amt').textContent = req.toCall;
  const hasRaise = req.legalActions.includes('raise');
  $('#hp-raise-wrap').style.display = hasRaise ? '' : 'none';
  if (hasRaise) {
    const r = $('#hp-raise');
    r.min = String(req.minRaiseTo);
    r.max = String(req.maxRaiseTo);
    r.value = String(req.minRaiseTo);
    updateRaiseVal();
  }
  $('#hp-allin').style.display = req.legalActions.includes('all_in') ? '' : 'none';
  $('#human-panel').classList.remove('hidden');
}

function hideHumanPanel() {
  $('#human-panel').classList.add('hidden');
}

function updateRaiseVal() {
  const v = Number($('#hp-raise').value);
  const extra = hpRequest ? v - hpRequest.committed : 0;
  $('#hp-raise-val').textContent = `加注到 ${v}${extra > 0 ? `（再投 ${extra}）` : ''}`;
}

function submitHuman(action, raiseTo) {
  if (!mySeat) return;
  fetch('/api/human-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: mySeat, action, raiseTo }),
  })
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) console.error('提交失败:', j.error);
    });
  hideHumanPanel();
}

$('#hp-fold').addEventListener('click', () => submitHuman('fold'));
$('#hp-check').addEventListener('click', () => submitHuman('check'));
$('#hp-call').addEventListener('click', () => submitHuman('call'));
$('#hp-raise-btn').addEventListener('click', () => submitHuman('raise', Number($('#hp-raise').value)));
$('#hp-allin').addEventListener('click', () => submitHuman('all_in'));
$('#hp-raise').addEventListener('input', updateRaiseVal);

/* ---------- 事件处理 ---------- */
function handleEvent(evt) {
  switch (evt.type) {
    case 'mode':
      $('#mode').textContent = '🥊 AI Arena';
      break;
    case 'identity_created': {
      const p = state.players.get(evt.playerId);
      if (p) {
        p.name = evt.name;
        updateSeat(p);
      }
      updateRankings();
      addLog(`🎭 <b>${escapeHtml(evt.name)}</b> 登场！<span class="sub">名字由 AI 自己取的</span>`, 'identity');
      break;
    }
    case 'game_start': {
      state.players.clear();
      for (const [i, pl] of evt.players.entries()) {
        state.players.set(pl.id, {
          ...pl, color: COLORS[i % COLORS.length], stack: evt.startingStack,
          hole: [], folded: false, allIn: false, committed: 0,
          isDealer: false, isSB: false, isBB: false, lastAction: null, busted: false, isActive: false,
        });
      }
      state.humanIds = evt.players.filter((p) => p.kind === 'human').map((p) => p.id);
      hideHumanPanel();
      // 我的座位失效（被改成 AI 等）→ 清除并重新选座；有真人同桌但还没选 → 弹选座
      if (mySeat && !state.humanIds.includes(mySeat)) {
        mySeat = null;
        viewerParam = 'spectator';
        localStorage.removeItem('poker-seat');
        reconnect();
      }
      $('#btn-seat').classList.toggle('hidden', !(mySeat && state.humanIds.includes(mySeat)));
      if (mySeat && state.humanIds.includes(mySeat)) {
        const me = state.players.get(mySeat);
        $('#seat-chip-name').textContent = me ? me.name : mySeat;
      }
      if (state.humanIds.length > 0 && !mySeat) openSeatOverlay();
      state.started = true;
      state.handNumber = 0;
      state.community = [];
      state.pot = 0;
      renderSeats();
      updateRankings();
      $('#log-body').innerHTML = '';
      addLog(`🎮 比赛开始！${evt.players.length} 位选手，初始筹码 ${evt.startingStack}，升盲淘汰制`, 'system');
      break;
    }
    case 'blind_change':
      state.level = evt.level; state.sb = evt.sb; state.bb = evt.bb;
      renderLevel();
      addLog(`📢 淘汰后盲注升级：L${evt.level} SB ${evt.sb} / BB ${evt.bb}`, 'system');
      break;
    case 'hand_start': {
      state.handNumber = evt.handNumber;
      state.level = evt.level; state.sb = evt.sb; state.bb = evt.bb;
      state.community = [];
      state.pot = 0;
      state.streetName = '翻前';
      // 战况：总局数 + 当前末尾淘汰循环进度（如 第 12 局 · 循环 2/5）
      const cycle = ((evt.handNumber - 1) % state.elimEvery) + 1;
      $('#hand-count').textContent = `· 第 ${evt.handNumber} 局 · 循环 ${cycle}/${state.elimEvery}`;
      for (const v of evt.players) {
        const p = state.players.get(v.id);
        if (!p) continue;
        Object.assign(p, {
          stack: v.stack, folded: false, allIn: false, committed: 0,
          isDealer: v.isDealer, isSB: v.isSB, isBB: v.isBB, lastAction: null, isActive: false, hole: [],
        });
      }
      renderLevel();
      renderCommunity();
      for (const p of state.players.values()) updateSeat(p);
      addLog(`🃏 第 ${evt.handNumber} 手 · 庄家 ${evt.dealerId}`, 'system');
      break;
    }
    case 'hole_cards':
      setHoleCards(evt.playerId, evt.cards);
      break;
    case 'street':
      state.community = evt.cards;
      state.streetName = evt.street === 'flop' ? '翻牌' : evt.street === 'turn' ? '转牌' : '河牌';
      renderCommunity();
      if (evt.cards.length) addLog(`🂠 ${state.streetName}: ${evt.cards.map(cardText).join(' ')}`, 'system');
      break;
    case 'actor': {
      for (const p of state.players.values()) p.isActive = false;
      const p = state.players.get(evt.playerId);
      if (p) {
        p.isActive = true;
        // 明确提示轮到谁行动（思考中的玩家 / 等待真人操作）
        const humanWait = state.humanIds.includes(evt.playerId) ? '（等待真人操作…）' : '';
        addLog(`▶ 轮到 <span class="who" style="color:${p.color}">${p.name}</span> 行动… ${humanWait}`, 'turn');
      }
      // 只有"我的座位"轮到行动时才弹操作面板；其它真人/AI 行动时不打扰
      if (evt.playerId === mySeat) showHumanPanel(evt.request);
      else hideHumanPanel();
      for (const q of state.players.values()) updateSeat(q);
      break;
    }
    case 'thinking': {
      const p = state.players.get(evt.playerId);
      if (!p) break;
      addLog(`<span class="who" style="color:${p.color}">${p.name}</span> 💭 ${escapeHtml(evt.text)} <span class="sub">· ${evt.model}</span>`, 'thinking');
      break;
    }
    case 'player_read': {
      const p = state.players.get(evt.playerId);
      if (!p) break;
      addLog(`<span class="who" style="color:${p.color}">${p.name}</span> 🎯 读牌：${escapeHtml(evt.text)}`, 'read');
      break;
    }
    case 'table_talk': {
      const p = state.players.get(evt.playerId);
      if (!p) break;
      addLog(`<span class="who" style="color:${p.color}">${p.name}</span> 💬 ${escapeHtml(evt.message)}`, 'talk');
      break;
    }
    case 'action': {
      const p = state.players.get(evt.playerId);
      if (!p) break;
      p.committed = evt.committed;
      p.stack = evt.stack;
      p.lastAction = evt.action;
      p.isActive = false;
      p.folded = evt.folded; // 弃牌后持续标注（直到新手牌 hand_start 重置）
      p.allIn = evt.allIn;
      state.pot = evt.pot;
      updateSeat(p);
      if (evt.playerId === mySeat) hideHumanPanel();
      renderCommunity();
      const actionText = evt.action === 'raise' ? `加注到 ${evt.committed}` : evt.action === 'all_in' ? `全下 ${evt.committed}` : evt.action === 'call' ? `跟注 ${evt.amount}` : evt.action === 'check' ? '过牌' : '弃牌';
      addLog(`<span class="who" style="color:${p.color}">${p.name}</span> ${actionText}`, 'action');
      break;
    }
    case 'showdown': {
      state.community = evt.community;
      state.streetName = '摊牌';
      renderCommunity();
      for (const r of evt.results) {
        const p = state.players.get(r.playerId);
        if (p) { setHoleCards(r.playerId, r.holeCards, true); if (r.hand) addLog(`<span class="who" style="color:${p.color}">${p.name}</span> 亮牌: ${escapeHtml(r.hand)}`, 'showdown'); }
      }
      for (const w of evt.winners) {
        const p = state.players.get(w.playerId);
        if (!p) continue;
        if (w.hand) {
          addLog(`🏆 <span class="who" style="color:${p.color}">${p.name}</span> 以 ${escapeHtml(w.hand)} 赢下底池 ${w.amount}！`, 'showdown');
        } else {
          addLog(`🃏 无人跟注，<span class="who" style="color:${p.color}">${p.name}</span> 直接收下底池 ${w.amount}`, 'showdown');
        }
      }
      break;
    }
    case 'hand_end':
      for (const v of evt.players) {
        const p = state.players.get(v.id);
        if (p) { p.stack = v.stack; p.committed = 0; p.lastAction = null; updateSeat(p); }
      }
      state.pot = 0;
      renderCommunity();
      updateRankings();
      break;
    case 'player_busted': {
      const p = state.players.get(evt.playerId);
      if (!p) break;
      p.busted = true;
      p.rank = evt.rank;
      updateSeat(p);
      updateRankings();
      const reasonText = evt.reason === 'bottom' ? '每 5 手末尾淘汰' : '筹码清零';
      addLog(`${evt.reason === 'bottom' ? '🪓' : '💀'} <span class="who" style="color:${p.color}">${p.name}</span> 被淘汰（第 ${evt.rank} 名）· ${reasonText}`, 'bust');
      break;
    }
    case 'player_renamed': {
      const p = state.players.get(evt.playerId);
      if (!p) break;
      const emoji = evt.reason === 'champion' ? '👑' : evt.reason === 'big_win' ? '🔥' : '🪦';
      const reasonText = evt.reason === 'champion' ? '夺冠加冕' : evt.reason === 'big_win' ? '赢下大底池，膨胀了' : '临别遗言';
      p.name = evt.newName;
      updateSeat(p);
      updateRankings();
      addLog(`${emoji} <span class="who" style="color:${p.color}">${escapeHtml(evt.oldName)}</span> → <b>${escapeHtml(evt.newName)}</b> <span class="sub">(${reasonText})</span>`, 'rename');
      break;
    }
    case 'tournament_end': {
      updateRankings();
      $('#hand-count').textContent = '· 已结束';
      const champ = state.players.get(evt.championId);
      const banner = $('#champion-banner');
      banner.innerHTML = `<div class="inner"><h2>🏆 ${champ ? champ.name : evt.championId} 夺冠！</h2><p>最终排名</p>`;
      const list = document.createElement('ul');
      for (const s of evt.standings.slice(0, 6)) {
        const li = document.createElement('li');
        li.textContent = `#${s.rank} ${s.name} · ${s.stack}`;
        list.appendChild(li);
      }
      banner.querySelector('.inner').appendChild(list);
      banner.classList.remove('hidden');
      addLog(`🥇 <b>${champ ? champ.name : evt.championId}</b> 赢得冠军！`, 'champ');
      break;
    }
    case 'note':
      addLog(`⚠️ ${escapeHtml(evt.text)}`, 'system');
      break;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 控制 ---------- */
function control(action, value) {
  return fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value !== undefined ? { action, value } : { action }),
  });
}

let paused = false;
$('#btn-pause').addEventListener('click', async () => {
  if (!paused) {
    await control('pause');
    paused = true;
    $('#btn-pause').textContent = '▶ 继续';
  } else {
    await control('resume');
    paused = false;
    $('#btn-pause').textContent = '⏸ 暂停';
  }
});
$('#btn-restart').addEventListener('click', () => {
  if (confirm('确定开新一局？当前比赛将终止。')) {
    control('restart');
    $('#champion-banner').classList.add('hidden');
    paused = false;
    $('#btn-pause').textContent = '⏸ 暂停';
  }
});
$('#speed').addEventListener('change', (e) => control('speed', Number(e.target.value)));

/* ---------- SSE ---------- */
// 重放模式：历史事件静默恢复状态，不打日志（避免"瞬间全部冒出"的错觉）
let silentMode = false;
let es = null;

function connect() {
  // viewer=<我的座位|spectator>：服务器按座位过滤底牌，保证两台设备互不泄露
  es = new EventSource(`/api/events?viewer=${encodeURIComponent(viewerParam)}`);
  const conn = $('#conn');
  es.onopen = () => { conn.textContent = '● 已连接'; conn.className = 'conn on'; };
  es.onerror = () => { conn.textContent = '○ 重连中…'; conn.className = 'conn off'; };
  es.addEventListener('replay', (e) => {
    silentMode = true;
    try {
      handleEvent(JSON.parse(e.data));
    } catch (err) {
      console.error('重放事件处理失败', err);
    }
    silentMode = false;
  });
  es.onmessage = (e) => {
    try {
      handleEvent(JSON.parse(e.data));
    } catch (err) {
      console.error('事件处理失败', err);
    }
  };
}

function reconnect() {
  if (es) es.close();
  connect();
}

// 页面加载：有真人座位且我还没选（或选的座位失效）→ 弹出选座
(async () => {
  try {
    const data = await (await fetch('/api/players')).json();
    const humans = data.players.filter((p) => p.provider === 'human');
    if (humans.length > 0 && !(mySeat && humans.some((h) => h.id === mySeat))) {
      openSeatOverlay();
    }
  } catch {
    // 网络异常时跳过，等 game_start 事件再弹
  }
})();

connect();
