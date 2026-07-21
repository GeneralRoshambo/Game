'use strict';
/* ==========================================================================
   WYRD DECK — a tiny poker-hand roguelite card battler
   Vanilla JS, organized into clearly labeled sections.
   ========================================================================== */

/* ==========================================================================
   SECTION: UTILITIES
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function floatText(kind, text, xPct = 50, yPct = 24) {
  if (saveState && saveState.settings && saveState.settings.reduceMotion) return;
  const el = document.createElement('div');
  el.className = `float-text ${kind}`;
  el.textContent = text;
  el.style.left = `calc(${xPct}% - 24px)`;
  el.style.top = `${yPct}%`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

/* ==========================================================================
   SECTION: DECK & CARD LOGIC
   ========================================================================== */

const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Ascending distinct values, used only to detect straights (Ace can sit high or low).
const RANK_ORDER = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

// "Power" value used in the damage formula. Face cards are flattened to 10, Ace is 11.
const RANK_POWER = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 10, Q: 10, K: 10, A: 11 };

let uidCounter = 1;
function makeCard(rank, suit, enh = 0) {
  return { uid: uidCounter++, rank, suit, enh };
}

function buildStandardDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(makeCard(rank, suit));
  return deck;
}

function cardPower(card) {
  return RANK_POWER[card.rank] + (card.enh || 0);
}

function cardLabel(card) {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

/* ==========================================================================
   SECTION: POKER EVALUATION
   ========================================================================== */

const HAND_TABLE = {
  HIGH_CARD:      { name: 'High Card',       base: 3,  mult: 1.0 },
  PAIR:           { name: 'Pair',            base: 6,  mult: 1.1 },
  TWO_PAIR:       { name: 'Two Pair',        base: 10, mult: 1.2 },
  THREE_KIND:     { name: 'Three of a Kind', base: 16, mult: 1.35 },
  STRAIGHT:       { name: 'Straight',        base: 24, mult: 1.5 },
  FLUSH:          { name: 'Flush',           base: 30, mult: 1.6 },
  FULL_HOUSE:     { name: 'Full House',      base: 38, mult: 1.8 },
  FOUR_KIND:      { name: 'Four of a Kind',  base: 50, mult: 2.0 },
  STRAIGHT_FLUSH: { name: 'Straight Flush',  base: 70, mult: 2.5 },
};
const HAND_RANK_ORDER = ['HIGH_CARD', 'PAIR', 'TWO_PAIR', 'THREE_KIND', 'STRAIGHT', 'FLUSH', 'FULL_HOUSE', 'FOUR_KIND', 'STRAIGHT_FLUSH'];

// Merge base hand stats with any permanent run upgrades earned as rewards.
function getHandInfo(type) {
  const base = HAND_TABLE[type];
  const up = runState.handUpgrades[type];
  if (!up) return base;
  return { name: base.name, base: base.base + up.baseAdd, mult: base.mult + up.multAdd };
}

// Evaluates 1-5 selected cards into a standard poker hand type.
// Straight/Flush/Full House/Four of a Kind/Straight Flush all require exactly
// 5 cards, matching real poker; smaller selections can still Pair, etc.
function evaluateHand(cards) {
  const n = cards.length;
  const counts = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const countVals = Object.values(counts).sort((a, b) => b - a);

  const suitSet = new Set(cards.map((c) => c.suit));
  const isFlush = n === 5 && suitSet.size === 1;

  const uniqueOrder = [...new Set(cards.map((c) => RANK_ORDER[c.rank]))].sort((a, b) => a - b);
  let isStraight = false;
  if (n === 5 && uniqueOrder.length === 5) {
    if (uniqueOrder[4] - uniqueOrder[0] === 4) isStraight = true;
    // The "wheel": Ace playing low alongside 2-3-4-5.
    else if (uniqueOrder.join(',') === '2,3,4,5,14') isStraight = true;
  }

  let type;
  if (isStraight && isFlush) type = 'STRAIGHT_FLUSH';
  else if (countVals[0] === 4) type = 'FOUR_KIND';
  else if (countVals[0] === 3 && countVals[1] === 2) type = 'FULL_HOUSE';
  else if (isFlush) type = 'FLUSH';
  else if (isStraight) type = 'STRAIGHT';
  else if (countVals[0] === 3) type = 'THREE_KIND';
  else if (countVals[0] === 2 && countVals[1] === 2) type = 'TWO_PAIR';
  else if (countVals[0] === 2) type = 'PAIR';
  else type = 'HIGH_CARD';

  return type;
}

// Turns a resolved hand into damage + side effects (heal, guard, crit, weaken),
// applying whichever relics the player currently holds.
function computeDamage(cards, handType, commit) {
  const info = getHandInfo(handType);
  const sumPower = cards.reduce((s, c) => s + cardPower(c), 0);
  let dmg = (info.base + sumPower) * info.mult;

  const faceCount = cards.filter((c) => c.rank === 'J' || c.rank === 'Q' || c.rank === 'K').length;
  const heartCount = cards.filter((c) => c.suit === 'H').length;
  const spadeCount = cards.filter((c) => c.suit === 'S').length;
  const handRank = HAND_RANK_ORDER.indexOf(handType);

  let healAmt = 0, guardGain = 0, weakenApplied = false, critChance = 0;

  if (runState.relics.has('facecards')) dmg += faceCount * 3;
  if (runState.relics.has('hearts')) healAmt += heartCount * 1;
  if (runState.relics.has('spadescrit')) critChance += spadeCount * 0.05;
  if (runState.relics.has('flushguard') && !battle.flags.usedFlushGuard && handRank >= HAND_RANK_ORDER.indexOf('FLUSH')) {
    guardGain += 8;
    if (commit) battle.flags.usedFlushGuard = true;
  }
  if (runState.relics.has('fullhouseweak') && handRank >= HAND_RANK_ORDER.indexOf('FULL_HOUSE')) {
    weakenApplied = true;
  }

  let crit = false;
  if (critChance > 0 && Math.random() < critChance) {
    dmg *= 2;
    crit = true;
  }

  return { dmg: Math.round(dmg), healAmt, guardGain, weakenApplied, crit, handName: info.name };
}

/* ==========================================================================
   SECTION: RELICS
   ========================================================================== */

const RELICS = [
  { id: 'facecards', name: 'Signet Ring', icon: '♛', desc: 'Face cards (J/Q/K) in your hand each deal +3 bonus damage.' },
  { id: 'hearts', name: 'Heart Locket', icon: '♥', desc: 'Each Heart in your hand heals 1 HP when you play it.' },
  { id: 'flushguard', name: 'Aegis Charm', icon: '🛡', desc: 'The first Flush-or-better you play each battle grants 8 Guard.' },
  { id: 'spadescrit', name: "Rogue's Dagger", icon: '♠', desc: 'Each Spade in your hand adds 5% crit chance (double damage).' },
  { id: 'fullhouseweak', name: "Widow's Veil", icon: '☠', desc: 'Full House or better weakens the enemy, cutting its next attacks by 30%.' },
];
function getRelic(id) { return RELICS.find((r) => r.id === id); }

/* ==========================================================================
   SECTION: ENEMIES
   ========================================================================== */

const ENEMY_TEMPLATES = {
  goblin: { name: 'Goblin Raider', emoji: '👺', hp: 26, pattern: ['atk', 'atk', 'defend'], atkMin: 6, atkMax: 9, defend: 6 },
  bone: { name: 'Bone Knight', emoji: '💀', hp: 32, pattern: ['atk', 'atk', 'atk', 'defend'], atkMin: 7, atkMax: 11, defend: 10 },
  witch: { name: 'Candle Witch', emoji: '🕯️', hp: 24, pattern: ['atk', 'weaken', 'atk'], atkMin: 5, atkMax: 8 },
  mirror: { name: 'Mirror Beast', emoji: '🪞', hp: 58, pattern: ['atk', 'buff', 'atk', 'atk'], atkMin: 10, atkMax: 15, buffMult: 1.5 },
  hollow: { name: 'The Hollow King', emoji: '👑', hp: 95, pattern: ['atk', 'atk', 'buff', 'atk', 'special'], atkMin: 9, atkMax: 14, buffMult: 1.4, specialMin: 22, specialMax: 28 },
};

function createEnemyInstance(key) {
  const t = ENEMY_TEMPLATES[key];
  return { key, template: t, hp: t.hp, maxHp: t.hp, shield: 0, buffedNextAtk: null, patternIdx: 0, intent: null };
}

function rollIntent(enemy) {
  const t = enemy.template;
  const kind = t.pattern[enemy.patternIdx % t.pattern.length];
  enemy.patternIdx++;
  if (kind === 'atk') {
    const val = randInt(t.atkMin, t.atkMax);
    return { kind: 'attack', value: val, label: `Attack ${val}`, icon: '⚔️', cls: '' };
  }
  if (kind === 'special') {
    const val = randInt(t.specialMin, t.specialMax);
    return { kind: 'attack', value: val, label: `Big Attack ${val}`, icon: '💥', cls: '' };
  }
  if (kind === 'defend') {
    const val = t.defend || 8;
    return { kind: 'defend', value: val, label: `Defend ${val}`, icon: '🛡️', cls: 'intent-defend' };
  }
  if (kind === 'buff') {
    return { kind: 'buff', mult: t.buffMult || 1.5, label: 'Empowering', icon: '✨', cls: 'intent-buff' };
  }
  if (kind === 'weaken') {
    return { kind: 'weaken', label: 'Hexing', icon: '🔮', cls: 'intent-buff' };
  }
  return { kind: 'attack', value: 5, label: 'Attack 5', icon: '⚔️', cls: '' };
}

/* ==========================================================================
   SECTION: RUN / MAP STRUCTURE
   ========================================================================== */

const STAGE_PLAN = [
  { type: 'fight', label: 'Battle', choices: ['goblin', 'witch'] },
  { type: 'fight', label: 'Battle', choices: ['bone', 'goblin'] },
  { type: 'event', label: 'Shrine' },
  { type: 'elite', label: 'Elite Battle', choices: ['mirror'] },
  { type: 'fight', label: 'Battle', choices: ['witch', 'bone'] },
  { type: 'boss', label: 'Boss Battle', choices: ['hollow'] },
];

let runState = null;
function newRunState() {
  return {
    stageIndex: 0,
    deck: buildStandardDeck(),
    relics: new Set(),
    handUpgrades: {},
    playerMaxHp: 60,
    playerHp: 60,
  };
}

/* ==========================================================================
   SECTION: BATTLE STATE
   ========================================================================== */

let battle = null;

function startBattle(enemyKey, kind) {
  battle = {
    enemy: createEnemyInstance(enemyKey),
    kind,
    guard: 0,
    hexTurns: 0,
    weakenEnemyTurns: 0,
    drawPile: shuffle(runState.deck),
    discardPile: [],
    hand: [],
    selected: new Set(),
    turn: 1,
    flags: { usedFlushGuard: false },
  };
  battle.enemy.intent = rollIntent(battle.enemy);
  switchScreen('battle');
  drawPlayerHand();
  renderBattle();
}

function drawPlayerHand() {
  battle.selected = new Set();
  battle.hand = [];
  for (let i = 0; i < 8; i++) {
    if (battle.drawPile.length === 0) {
      if (battle.discardPile.length === 0) break;
      battle.drawPile = shuffle(battle.discardPile);
      battle.discardPile = [];
    }
    battle.hand.push(battle.drawPile.pop());
  }
  renderBattle();
}

function toggleCardSelect(uid) {
  if (paused || !battle) return;
  if (battle.selected.has(uid)) {
    battle.selected.delete(uid);
  } else if (battle.selected.size < 5) {
    battle.selected.add(uid);
  }
  renderBattle();
}

function currentSelection() {
  return battle.hand.filter((c) => battle.selected.has(c.uid));
}

function applyDamageToEnemy(dmg) {
  let remaining = dmg;
  if (battle.enemy.shield > 0) {
    const absorbed = Math.min(battle.enemy.shield, remaining);
    battle.enemy.shield -= absorbed;
    remaining -= absorbed;
  }
  battle.enemy.hp = Math.max(0, battle.enemy.hp - remaining);
  if (dmg > 0) floatText('dmg', `-${dmg}`, 50, 16);
}

function applyDamageToPlayer(dmg) {
  let remaining = dmg;
  if (battle.guard > 0) {
    const absorbed = Math.min(battle.guard, remaining);
    battle.guard -= absorbed;
    remaining -= absorbed;
    if (absorbed > 0) floatText('shield', `Blocked ${absorbed}`, 50, 8);
  }
  runState.playerHp = Math.max(0, runState.playerHp - remaining);
  if (remaining > 0) floatText('dmg', `-${remaining}`, 50, 8);
}

function healPlayer(amt) {
  if (amt <= 0) return;
  runState.playerHp = Math.min(runState.playerMaxHp, runState.playerHp + amt);
  floatText('heal', `+${amt}`, 50, 8);
}

function playHand() {
  if (paused || !battle) return;
  const cards = currentSelection();
  if (cards.length === 0) return;

  const handType = evaluateHand(cards);
  const result = computeDamage(cards, handType, true);
  let dmg = result.dmg;
  if (battle.hexTurns > 0) {
    dmg = Math.round(dmg * 0.7);
    battle.hexTurns--;
  }

  applyDamageToEnemy(dmg);
  if (result.healAmt) healPlayer(result.healAmt);
  if (result.guardGain) {
    battle.guard += result.guardGain;
    floatText('shield', `+${result.guardGain} Guard`, 50, 8);
  }
  if (result.weakenApplied) battle.weakenEnemyTurns = 2;
  if (result.crit) floatText('dmg', 'CRIT!', 50, 12);

  battle.discardPile.push(...battle.hand);
  battle.hand = [];
  battle.selected = new Set();

  renderBattle();

  if (battle.enemy.hp <= 0) {
    setTimeout(() => onEnemyDefeated(), 500);
    return;
  }
  setTimeout(() => resolveEnemyTurn(), 700);
}

function resolveEnemyTurn() {
  if (!battle) return;
  const intent = battle.enemy.intent;
  if (intent.kind === 'attack') {
    let dmg = intent.value;
    if (battle.weakenEnemyTurns > 0) dmg = Math.round(dmg * 0.7);
    if (battle.enemy.buffedNextAtk) {
      dmg = Math.round(dmg * battle.enemy.buffedNextAtk);
      battle.enemy.buffedNextAtk = null;
    }
    applyDamageToPlayer(dmg);
  } else if (intent.kind === 'defend') {
    battle.enemy.shield += intent.value;
  } else if (intent.kind === 'buff') {
    battle.enemy.buffedNextAtk = intent.mult;
  } else if (intent.kind === 'weaken') {
    battle.hexTurns = Math.max(battle.hexTurns, 1);
    floatText('dmg', 'Hexed!', 50, 8);
  }
  if (battle.weakenEnemyTurns > 0) battle.weakenEnemyTurns--;

  if (runState.playerHp <= 0) {
    onPlayerDefeated();
    return;
  }

  battle.turn++;
  battle.enemy.intent = rollIntent(battle.enemy);
  drawPlayerHand();
  renderBattle();
}

function onEnemyDefeated() {
  const kind = battle.kind;
  battle = null;
  if (kind === 'boss') {
    saveState.bestStage = Math.max(saveState.bestStage, STAGE_PLAN.length + 1);
    persistSave();
    showEnd(true);
  } else {
    showReward();
  }
}

function onPlayerDefeated() {
  battle = null;
  persistSave();
  showEnd(false);
}

/* ==========================================================================
   SECTION: REWARDS
   ========================================================================== */

function makeAddCardReward() {
  const rank = pick(RANKS);
  const suit = pick(SUITS);
  return {
    icon: '➕',
    name: 'Add a Card',
    desc: `Add ${rank}${SUIT_SYMBOL[suit]} to your deck.`,
    apply() { runState.deck.push(makeCard(rank, suit)); },
  };
}

function makeRemoveCardReward() {
  const card = pick(runState.deck);
  return {
    icon: '➖',
    name: 'Remove a Card',
    desc: `Remove ${cardLabel(card)} from your deck.`,
    apply() { runState.deck = runState.deck.filter((c) => c.uid !== card.uid); },
  };
}

function makeEnhanceCardReward() {
  const card = pick(runState.deck);
  return {
    icon: '✨',
    name: 'Enhance a Card',
    desc: `Bless ${cardLabel(card)} with +2 power, permanently.`,
    apply() { card.enh = (card.enh || 0) + 2; },
  };
}

function makeRelicReward() {
  const owned = runState.relics;
  const options = RELICS.filter((r) => !owned.has(r.id));
  const relic = pick(options);
  return {
    icon: relic.icon,
    name: relic.name,
    desc: relic.desc,
    apply() {
      runState.relics.add(relic.id);
      if (!saveState.unlockedRelics.includes(relic.id)) saveState.unlockedRelics.push(relic.id);
    },
  };
}

function makeUpgradeHandReward() {
  const type = pick(HAND_RANK_ORDER);
  const info = HAND_TABLE[type];
  return {
    icon: '📈',
    name: `Upgrade ${info.name}`,
    desc: `${info.name} permanently deals more damage.`,
    apply() {
      const up = runState.handUpgrades[type] || { baseAdd: 0, multAdd: 0 };
      up.baseAdd += Math.round(info.base * 0.25) + 1;
      up.multAdd += 0.1;
      runState.handUpgrades[type] = up;
    },
  };
}

function buildRewardPool() {
  const pool = [makeAddCardReward(), makeEnhanceCardReward(), makeUpgradeHandReward()];
  if (runState.deck.length > 15) pool.push(makeRemoveCardReward());
  if (runState.relics.size < RELICS.length) pool.push(makeRelicReward());
  return shuffle(pool).slice(0, 3);
}

function showReward() {
  const pool = buildRewardPool();
  const row = $('#reward-choices');
  row.innerHTML = '';
  pool.forEach((opt) => {
    const el = document.createElement('button');
    el.className = 'choice-card';
    el.innerHTML = `<div class="choice-icon">${opt.icon}</div><div class="choice-name">${opt.name}</div><div class="choice-desc">${opt.desc}</div>`;
    el.addEventListener('click', () => {
      opt.apply();
      proceedAfterNode();
    });
    row.appendChild(el);
  });
  switchScreen('reward');
}

/* ==========================================================================
   SECTION: EVENT / SHRINE
   ========================================================================== */

function makeRestReward() {
  const amt = Math.round(runState.playerMaxHp * 0.3);
  return {
    icon: '🕊️',
    name: 'Rest',
    desc: `Recover ${amt} HP.`,
    apply() { healPlayerOutOfBattle(amt); },
  };
}
function healPlayerOutOfBattle(amt) {
  runState.playerHp = Math.min(runState.playerMaxHp, runState.playerHp + amt);
}

function showEvent() {
  $('#event-title').textContent = 'Roadside Shrine';
  $('#event-desc').textContent = 'A quiet moment before the road continues. Choose one boon.';
  const pool = [makeRestReward(), makeEnhanceCardReward()];
  if (runState.deck.length > 15) pool.push(makeRemoveCardReward());
  else pool.push(makeAddCardReward());
  const row = $('#event-choices');
  row.innerHTML = '';
  pool.forEach((opt) => {
    const el = document.createElement('button');
    el.className = 'choice-card';
    el.innerHTML = `<div class="choice-icon">${opt.icon}</div><div class="choice-name">${opt.name}</div><div class="choice-desc">${opt.desc}</div>`;
    el.addEventListener('click', () => {
      opt.apply();
      proceedAfterNode();
    });
    row.appendChild(el);
  });
  switchScreen('event');
}

function proceedAfterNode() {
  runState.stageIndex++;
  saveState.bestStage = Math.max(saveState.bestStage, runState.stageIndex + 1);
  persistSave();
  showMap();
}

/* ==========================================================================
   SECTION: UI RENDERING
   ========================================================================== */

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${id}`).classList.add('active');
}

function hpBarHtml(hp, maxHp) {
  const pct = clamp((hp / maxHp) * 100, 0, 100);
  return `<span class="hp-bar-wrap"><span class="hp-bar-fill" style="width:${pct}%"></span></span>`;
}

function renderTitleBestLine() {
  const relicsCount = saveState.unlockedRelics.length;
  $('#best-line').textContent = `Best stage reached: ${saveState.bestStage} · Relics discovered: ${relicsCount}/${RELICS.length}`;
  $('#chk-reduce-motion').checked = !!saveState.settings.reduceMotion;
}

function renderMap() {
  const stage = STAGE_PLAN[runState.stageIndex];
  $('#map-hp').innerHTML = `HP ${hpBarHtml(runState.playerHp, runState.playerMaxHp)} ${runState.playerHp}/${runState.playerMaxHp}`;
  $('#map-stage').textContent = `Stage ${runState.stageIndex + 1} / ${STAGE_PLAN.length} — ${stage.label}`;

  const wrap = $('#map-nodes');
  wrap.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'map-row';

  if (stage.type === 'event') {
    const node = document.createElement('button');
    node.className = 'map-node clickable';
    node.innerHTML = `<span class="node-icon">❓</span><span class="node-name">Roadside Shrine</span><span class="node-sub">Rest or receive a boon</span>`;
    node.addEventListener('click', () => showEvent());
    row.appendChild(node);
  } else {
    stage.choices.forEach((key) => {
      const t = ENEMY_TEMPLATES[key];
      const node = document.createElement('button');
      node.className = 'map-node clickable';
      node.innerHTML = `<span class="node-icon">${t.emoji}</span><span class="node-name">${t.name}</span><span class="node-sub">${t.hp} HP</span>`;
      node.addEventListener('click', () => startBattle(key, stage.type));
      row.appendChild(node);
    });
  }
  wrap.appendChild(row);
}

function renderBattle() {
  if (!battle) return;
  const guardTxt = battle.guard > 0 ? ` 🛡${battle.guard}` : '';
  const hexTxt = battle.hexTurns > 0 ? ' 🔮' : '';
  $('#battle-player-hp').innerHTML = `HP ${hpBarHtml(runState.playerHp, runState.playerMaxHp)} ${runState.playerHp}/${runState.playerMaxHp}${guardTxt}${hexTxt}`;
  $('#battle-turn').textContent = `Turn ${battle.turn}`;

  const enemy = battle.enemy;
  const dead = enemy.hp <= 0;
  const statusBits = [];
  if (enemy.shield > 0) statusBits.push(`🛡 Shielded ${enemy.shield}`);
  if (enemy.buffedNextAtk) statusBits.push('⚡ Empowered');
  if (battle.weakenEnemyTurns > 0) statusBits.push('🌀 Weakened');

  $('#enemy-row').innerHTML = `
    <div class="enemy-card ${dead ? 'dead' : ''}">
      <div class="enemy-emoji">${enemy.template.emoji}</div>
      <div class="enemy-name">${enemy.template.name}</div>
      <div class="enemy-hpbar"><div class="enemy-hpfill" style="width:${clamp((enemy.hp / enemy.maxHp) * 100, 0, 100)}%"></div></div>
      <div class="enemy-hptext">${Math.max(0, enemy.hp)}/${enemy.maxHp}</div>
      <div class="enemy-intent ${enemy.intent.cls}">${enemy.intent.icon} ${enemy.intent.label}</div>
      ${statusBits.length ? `<div class="enemy-status">${statusBits.join(' · ')}</div>` : ''}
    </div>`;

  const handWrap = $('#player-hand');
  handWrap.innerHTML = '';
  battle.hand.forEach((card) => handWrap.appendChild(renderCardEl(card, battle.selected.has(card.uid))));

  renderHandPreview();
}

function renderCardEl(card, selected) {
  const el = document.createElement('div');
  el.className = `card ${RED_SUITS.has(card.suit) ? 'red' : ''} ${selected ? 'selected' : ''}`;
  const label = `${card.rank}${SUIT_SYMBOL[card.suit]}`;
  el.innerHTML = `
    <div class="corner">${label}</div>
    <div class="pip">${SUIT_SYMBOL[card.suit]}</div>
    <div class="corner bottom">${label}</div>
    ${card.enh ? `<div class="enh-star" title="+${card.enh} power">★</div>` : ''}`;
  el.addEventListener('click', () => toggleCardSelect(card.uid));
  return el;
}

function renderHandPreview() {
  const cards = currentSelection();
  const preview = $('#hand-preview');
  const playBtn = $('#btn-play');
  if (cards.length === 0) {
    preview.textContent = 'Select up to 5 cards to form a poker hand';
    playBtn.disabled = true;
    return;
  }
  const handType = evaluateHand(cards);
  const result = computeDamage(cards, handType, false);
  const extras = [];
  if (result.healAmt) extras.push(`💚+${result.healAmt}`);
  if (result.guardGain) extras.push(`🛡+${result.guardGain}`);
  if (result.weakenApplied) extras.push('🌀weaken');
  preview.textContent = `${result.handName} — ${result.dmg} dmg${extras.length ? ' · ' + extras.join(' ') : ''}`;
  playBtn.disabled = false;
}

function showEnd(win) {
  $('#end-title').textContent = win ? 'Victory!' : 'You Have Fallen';
  $('#end-desc').textContent = win
    ? 'The Hollow King is banished. Your deck rests until the next run.'
    : `You reached stage ${runState.stageIndex + 1} of ${STAGE_PLAN.length}.`;
  switchScreen('end');
}

function showMap() {
  switchScreen('map');
  renderMap();
}

/* ==========================================================================
   SECTION: RUN FLOW / INPUT WIRING
   ========================================================================== */

function startRun() {
  runState = newRunState();
  showMap();
}

function wireStaticButtons() {
  $('#btn-start').addEventListener('click', () => { if (!paused) startRun(); });
  $('#btn-clear').addEventListener('click', () => {
    if (paused || !battle) return;
    battle.selected = new Set();
    renderBattle();
  });
  $('#btn-play').addEventListener('click', () => playHand());
  $('#btn-skip-reward').addEventListener('click', () => proceedAfterNode());
  $('#btn-restart').addEventListener('click', () => { switchScreen('title'); renderTitleBestLine(); });
  $('#chk-reduce-motion').addEventListener('change', (e) => {
    saveState.settings.reduceMotion = e.target.checked;
    persistSave();
  });
}

/* ==========================================================================
   SECTION: YOUTUBE PLAYABLES SDK INTEGRATION
   ========================================================================== */

// Safe wrapper: every call is a no-op (or a localStorage fallback) when the
// ytgame global is missing, so the game runs fine outside YouTube Playables.
const YT = (function () {
  const hasSDK = typeof ytgame !== 'undefined';
  return {
    hasSDK,
    async firstFrameReady() {
      if (!hasSDK) return;
      try { ytgame.game.firstFrameReady(); } catch (e) { /* ignore */ }
    },
    async gameReady() {
      if (!hasSDK) return;
      try { ytgame.game.gameReady(); } catch (e) { /* ignore */ }
    },
    onPause(cb) {
      if (hasSDK && ytgame.system && ytgame.system.onPause) {
        try { ytgame.system.onPause(cb); } catch (e) { /* ignore */ }
      }
    },
    onResume(cb) {
      if (hasSDK && ytgame.system && ytgame.system.onResume) {
        try { ytgame.system.onResume(cb); } catch (e) { /* ignore */ }
      }
    },
    async loadData() {
      if (!hasSDK) {
        const raw = localStorage.getItem('wyrddeck_save');
        return raw ? JSON.parse(raw) : null;
      }
      try {
        const data = await ytgame.game.loadData();
        return data ? JSON.parse(data) : null;
      } catch (e) { return null; }
    },
    async saveData(obj) {
      const str = JSON.stringify(obj);
      if (!hasSDK) { localStorage.setItem('wyrddeck_save', str); return; }
      try { await ytgame.game.saveData(str); } catch (e) { /* ignore */ }
    },
  };
})();

/* ==========================================================================
   SECTION: SAVE DATA
   ========================================================================== */

let saveState = null;
let loadPromise = null;
let loadedOnce = false;

function defaultSave() {
  return { bestStage: 1, unlockedRelics: [], settings: { reduceMotion: false } };
}

async function initSave() {
  loadPromise = YT.loadData();
  const loaded = await loadPromise;
  saveState = loaded || defaultSave();
  if (!saveState.settings) saveState.settings = { reduceMotion: false };
  if (!saveState.unlockedRelics) saveState.unlockedRelics = [];
  loadedOnce = true;
}

async function persistSave() {
  if (!loadedOnce) await loadPromise;
  await YT.saveData(saveState);
}

/* ==========================================================================
   SECTION: PAUSE / RESUME
   ========================================================================== */

let paused = false;
function setPaused(p) {
  paused = p;
  $('#pause-overlay').classList.toggle('active', p);
}

/* ==========================================================================
   SECTION: BOOTSTRAP
   ========================================================================== */

async function boot() {
  await initSave();
  wireStaticButtons();
  renderTitleBestLine();
  switchScreen('title');

  YT.onPause(() => setPaused(true));
  YT.onResume(() => setPaused(false));

  await YT.firstFrameReady();
  await YT.gameReady();
}

boot();
