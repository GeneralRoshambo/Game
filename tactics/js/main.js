// ============================================================================
// BOOTSTRAP — screen routing, run/map/reward/event flow, persistence, and
// YouTube Playables SDK integration. This is the only file that knows about
// all the other systems; none of them import each other except through the
// battle engine's public API.
// ============================================================================

import { getCardDef, instantiate } from './cards.js';
import { BattleEngine } from './battle.js';
import { mountBattleUI, startBattleUI } from './ui.js';
import { mountDeckbuilder, showDeckbuilder } from './deckbuilder.js';
import { RELICS, STAGE_PLAN, enemyInfo, buildEnemyDeck, newRunState, relicBattleOpts, buildRewardPool, buildEventPool } from './progression.js';

const $ = (sel) => document.querySelector(sel);

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${id}`).classList.add('active');
}

/* ==========================================================================
   YOUTUBE PLAYABLES SDK INTEGRATION (safe wrapper — no-ops without ytgame)
   ========================================================================== */
const YT = (function () {
  const hasSDK = typeof ytgame !== 'undefined';
  return {
    hasSDK,
    async firstFrameReady() { if (hasSDK) try { ytgame.game.firstFrameReady(); } catch (e) {} },
    async gameReady() { if (hasSDK) try { ytgame.game.gameReady(); } catch (e) {} },
    onPause(cb) { if (hasSDK && ytgame.system?.onPause) try { ytgame.system.onPause(cb); } catch (e) {} },
    onResume(cb) { if (hasSDK && ytgame.system?.onResume) try { ytgame.system.onResume(cb); } catch (e) {} },
    async loadData() {
      if (!hasSDK) { const raw = localStorage.getItem('rank_ruin_save'); return raw ? JSON.parse(raw) : null; }
      try { const data = await ytgame.game.loadData(); return data ? JSON.parse(data) : null; } catch (e) { return null; }
    },
    async saveData(obj) {
      const str = JSON.stringify(obj);
      if (!hasSDK) { localStorage.setItem('rank_ruin_save', str); return; }
      try { await ytgame.game.saveData(str); } catch (e) {}
    },
  };
})();

/* ==========================================================================
   SAVE DATA
   ========================================================================== */
let saveState = null;
let loadPromise = null;
let loadedOnce = false;

function defaultSave() { return { bestStage: 1, unlockedRelics: [], customCards: [], deckCounts: null }; }

async function initSave() {
  loadPromise = YT.loadData();
  saveState = (await loadPromise) || defaultSave();
  if (!saveState.customCards) saveState.customCards = [];
  if (!saveState.unlockedRelics) saveState.unlockedRelics = [];
  loadedOnce = true;
}
async function persistSave() {
  if (!loadedOnce) await loadPromise;
  await YT.saveData(saveState);
}

/* ==========================================================================
   PAUSE / RESUME
   ========================================================================== */
function setPaused(p) { $('#pause-overlay').classList.toggle('active', p); }

/* ==========================================================================
   RUN STATE
   ========================================================================== */
let runState = null;

function buildPlayerDeck() {
  const list = [];
  for (const [id, n] of Object.entries(saveState.deckCounts)) {
    if (!n) continue;
    const def = getCardDef(id) || saveState.customCards.find((c) => c.id === id);
    if (!def) continue;
    for (let i = 0; i < n; i++) list.push(instantiate(def));
  }
  return list;
}

function startRun() {
  runState = newRunState();
  runState.deck = buildPlayerDeck();
  showMap();
}

// Reunites every card the player still owns (deck/hand/discard/shields/board)
// back into one pool for the next battle, resetting battle-only state.
// Anything the opponent Exiled is left out on purpose — a permanent loss.
function reconcileDeckAfterBattle(engine) {
  const s = engine.sides.player;
  const list = [...s.deck, ...s.hand, ...s.discard, ...s.shields];
  for (const row of ['top', 'bottom']) {
    for (let i = 0; i < 3; i++) {
      const c = engine.rows[row][i];
      if (c && c.owner === 'player') { list.push(c); if (c.equipment) list.push(c.equipment); }
    }
  }
  for (const c of list) { c.rankMod = 0; c.tempRankMod = 0; c.statuses = {}; c.equipment = null; c.attacksUsed = 0; c.movedThisTurn = false; }
  runState.deck = list;
}

function unlockRelicsSeen() {
  let changed = false;
  for (const id of runState.relics) if (!saveState.unlockedRelics.includes(id)) { saveState.unlockedRelics.push(id); changed = true; }
  if (changed) persistSave();
}

/* ==========================================================================
   BATTLE FLOW
   ========================================================================== */
function enterBattle(enemyKey, stageType) {
  const info = enemyInfo(enemyKey);
  const enemyDeck = buildEnemyDeck(enemyKey);
  const opts = relicBattleOpts(runState.relics);
  opts.enemyExtraShields = info.enemyExtraShields || 0;
  opts.enemyExtraMana = info.enemyExtraMana || 0;
  const engine = new BattleEngine(runState.deck, enemyDeck, opts);
  switchScreen('battle');
  startBattleUI(engine, (winner) => onBattleDone(winner, engine, stageType));
}

function onBattleDone(winner, engine, stageType) {
  reconcileDeckAfterBattle(engine);
  if (winner === 'enemy') {
    persistSave();
    showEnd(false);
    return;
  }
  if (stageType === 'boss') {
    saveState.bestStage = Math.max(saveState.bestStage, STAGE_PLAN.length + 1);
    persistSave();
    showEnd(true);
    return;
  }
  showRewardScreen(stageType);
}

/* ==========================================================================
   MAP
   ========================================================================== */
function showMap() {
  switchScreen('map');
  const stage = STAGE_PLAN[runState.stageIndex];
  $('#map-stage').textContent = `Stage ${runState.stageIndex + 1} / ${STAGE_PLAN.length} — ${stage.label}`;
  const wrap = $('#map-nodes');
  wrap.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'map-row';
  if (stage.type === 'event') {
    const node = document.createElement('button');
    node.className = 'map-node clickable';
    node.innerHTML = `<span class="node-icon">❓</span><span class="node-name">Wandering Merchant</span><span class="node-sub">Pick one boon</span>`;
    node.addEventListener('click', showEvent);
    row.appendChild(node);
  } else {
    stage.choices.forEach((key) => {
      const info = enemyInfo(key);
      const node = document.createElement('button');
      node.className = 'map-node clickable';
      node.innerHTML = `<span class="node-icon">${info.icon}</span><span class="node-name">${info.name}</span><span class="node-sub">${stage.type}</span>`;
      node.addEventListener('click', () => enterBattle(key, stage.type));
      row.appendChild(node);
    });
  }
  wrap.appendChild(row);
}

function proceedAfterNode() {
  runState.stageIndex++;
  saveState.bestStage = Math.max(saveState.bestStage, runState.stageIndex + 1);
  persistSave();
  showMap();
}

/* ==========================================================================
   REWARD / EVENT
   ========================================================================== */
function renderChoiceRow(containerId, pool) {
  const row = $(`#${containerId}`);
  row.innerHTML = '';
  pool.forEach((opt) => {
    const el = document.createElement('button');
    el.className = 'choice-card';
    el.innerHTML = `<div class="choice-icon">${opt.icon}</div><div class="choice-name">${opt.name}</div><div class="choice-desc">${opt.desc}</div>`;
    el.addEventListener('click', () => {
      opt.apply();
      unlockRelicsSeen();
      proceedAfterNode();
    });
    row.appendChild(el);
  });
}

function showRewardScreen(stageType) {
  renderChoiceRow('reward-choices', buildRewardPool(runState, stageType));
  switchScreen('reward');
}

function showEvent() {
  $('#event-title').textContent = 'Wandering Merchant';
  $('#event-desc').textContent = 'A quiet stop on the road. Choose one boon before moving on.';
  renderChoiceRow('event-choices', buildEventPool(runState));
  switchScreen('event');
}

/* ==========================================================================
   TITLE / END
   ========================================================================== */
function renderTitle() {
  $('#best-line').textContent = `Best stage reached: ${saveState.bestStage} / ${STAGE_PLAN.length + 1} · Relics discovered: ${saveState.unlockedRelics.length}/${RELICS.length}`;
}

function showEnd(win) {
  $('#end-title').textContent = win ? 'Victory!' : 'Your Shields Are Shattered';
  $('#end-desc').textContent = win
    ? 'The Hollow Sovereign falls. Your deck rests until the next run.'
    : `You reached stage ${runState.stageIndex + 1} of ${STAGE_PLAN.length}.`;
  switchScreen('end');
}

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */
function wireStaticButtons() {
  $('#btn-start').addEventListener('click', () => startRun());
  $('#btn-deckbuilder').addEventListener('click', () => showDeckbuilder());
  $('#btn-skip-reward').addEventListener('click', () => proceedAfterNode());
  $('#btn-restart').addEventListener('click', () => { switchScreen('title'); renderTitle(); });
}

async function boot() {
  await initSave();
  mountBattleUI();
  mountDeckbuilder(saveState, persistSave, () => { switchScreen('title'); renderTitle(); });
  wireStaticButtons();
  renderTitle();
  switchScreen('title');

  YT.onPause(() => setPaused(true));
  YT.onResume(() => setPaused(false));

  await YT.firstFrameReady();
  await YT.gameReady();
}

boot();
