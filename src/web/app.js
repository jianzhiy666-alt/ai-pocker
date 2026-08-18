/* AI 扑克擂台 — 观战页面逻辑（原生 JS + SSE） */

const COLORS = ['#e8590c', '#4c6ef5', '#12b886', '#f76707', '#7048e8', '#c2255c', '#1098ad', '#5c940d'];
const ACTION_CN = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', all_in: '全下' };
const RED_SUITS = new Set(['♥', '♦']);

const state = {
  players: new Map(), // id -> {id,name,color,kind,model,stack,hole:[],folded,allIn,committed,isDealer,isSB,isBB,lastAction,busted,rank}
  handNumber: 0,
  level: 1,
  sb: 10,
  bb: 20,
  pot: 0,
  community: [],
  streetName: '',
  started: false,
};

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

function cardEl(card, small) {
  const div = document.createElement('div');
  div.className = `card ${small ? 'small' : ''} ${RED_SUITS.has(card[1]) ? 'red' : ''}`;
  const corner = document.createElement('span');
  corner.className = 'corner';
  corner.textContent = card[0];
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

function renderSeats() {
  const seats = $('#seats');
  seats.innerHTML = '';
  for (const p of state.players.values()) {
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.id = `seat-${p.id}`;
    seat.innerHTML = `
      <div class="seat-inner">
        <div class="avatar" style="background:${p.color}">
          ${p.name[0]}
          <span class="badge d" style="display:none">庄</span>
          <span class="badge sb" style="display:none">SB</span>
          <span class="badge bb" style="display:none">BB</span>
        </div>
        <div class="name" title="${p.name}">${p.name}</div>
        <div class="model" title="${p.model}">${p.model}</div>
        <div class="stack">${p.stack}</div>
        <div class="hole"></div>
        <div class="bet-chip" style="display:none"></div>
        <div class="action-flag"></div>
      </div>`;
    seats.appendChild(seat);
  }
  layoutSeats();
  window.addEventListener('resize', layoutSeats);
}

function updateSeat(p) {
  const seat = document.getElementById(`seat-${p.id}`);
  if (!seat) return;
  const nameEl = seat.querySelector('.name');
  if (nameEl && nameEl.textContent !== p.name) {
    nameEl.textContent = p.name;
    nameEl.title = p.name;
  }
  seat.querySelector('.stack').textContent = p.stack;
  seat.querySelector('.badge.d').style.display = p.isDealer ? 'inline-block' : 'none';
  seat.querySelector('.badge.sb').style.display = p.isSB ? 'inline-block' : 'none';
  seat.querySelector('.badge.bb').style.display = p.isBB ? 'inline-block' : 'none';
  seat.classList.toggle('folded', !!p.folded);
  seat.classList.toggle('busted', !!p.busted);
  seat.classList.toggle('active', !!p.isActive);
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
  hole.innerHTML = '';
  for (const c of p.hole) hole.appendChild(cardEl(c, true));
  if (p.hole.length === 2 && !seat.querySelector('.hole .card.back')) {
    // 补齐两张
  }
}

function setHoleCards(playerId, cards) {
  const p = state.players.get(playerId);
  if (!p) return;
  p.hole = cards;
  const seat = document.getElementById(`seat-${playerId}`);
  if (!seat) return;
  const hole = seat.querySelector('.hole');
  hole.innerHTML = '';
  for (const c of cards) hole.appendChild(cardEl(c, true));
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
      addLog(`📢 盲注升级：L${evt.level} SB ${evt.sb} / BB ${evt.bb}`, 'system');
      break;
    case 'hand_start': {
      state.handNumber = evt.handNumber;
      state.level = evt.level; state.sb = evt.sb; state.bb = evt.bb;
      state.community = [];
      state.pot = 0;
      state.streetName = '翻前';
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
      if (evt.cards.length) addLog(`🂠 ${state.streetName}: ${evt.cards.join(' ')}`, 'system');
      break;
    case 'actor': {
      for (const p of state.players.values()) p.isActive = false;
      const p = state.players.get(evt.playerId);
      if (p) {
        p.isActive = true;
        // 明确提示轮到谁行动（思考中的玩家）
        addLog(`▶ 轮到 <span class="who" style="color:${p.color}">${p.name}</span> 行动…`, 'turn');
      }
      for (const q of state.players.values()) updateSeat(q);
      break;
    }
    case 'thinking': {
      const p = state.players.get(evt.playerId);
      if (!p) break;
      addLog(`<span class="who" style="color:${p.color}">${p.name}</span> 💭 ${escapeHtml(evt.text)} <span class="sub">· ${evt.model}</span>`, 'thinking');
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
      state.pot = evt.pot;
      updateSeat(p);
      renderCommunity();
      const actionText = evt.action === 'raise' ? `加注到 ${evt.amount}` : evt.action === 'all_in' ? `全下 ${evt.amount}` : evt.action === 'call' ? `跟注 ${evt.amount}` : evt.action === 'check' ? '过牌' : '弃牌';
      addLog(`<span class="who" style="color:${p.color}">${p.name}</span> ${actionText}`, 'action');
      break;
    }
    case 'showdown': {
      state.community = evt.community;
      state.streetName = '摊牌';
      renderCommunity();
      for (const r of evt.results) {
        const p = state.players.get(r.playerId);
        if (p) { setHoleCards(r.playerId, r.holeCards); if (r.hand) addLog(`<span class="who" style="color:${p.color}">${p.name}</span> 亮牌: ${escapeHtml(r.hand)}`, 'showdown'); }
      }
      for (const w of evt.winners) {
        const p = state.players.get(w.playerId);
        if (!p) continue;
        addLog(`🏆 <span class="who" style="color:${p.color}">${p.name}</span> 赢得 ${w.amount}${w.hand ? `（${escapeHtml(w.hand)}）` : ''}`, 'showdown');
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
      addLog(`💀 <span class="who" style="color:${p.color}">${p.name}</span> 筹码清零，被淘汰（第 ${evt.rank} 名）`, 'bust');
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

function connect() {
  const es = new EventSource('/api/events');
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
connect();
