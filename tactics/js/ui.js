// ============================================================================
// BATTLE UI — renders the battlefield/hand/log and turns clicks into engine
// calls. Owns the player<->AI turn loop for the battle screen, but the AI's
// own decision logic lives entirely in ai.js (no DOM code there).
// ============================================================================

import { SUITS, effectiveRank } from './cards.js';
import { ABILITY_INFO } from './abilities.js';
import { runAITurn } from './ai.js';

const $ = (sel) => document.querySelector(sel);

let engine = null;
let onDone = null;
let selectedUid = null;
let mounted = false;

export function mountBattleUI() {
  if (mounted) return;
  mounted = true;
  $('#battlefield-enemy').addEventListener('click', (e) => handleSlotClick(e, 'top'));
  $('#battlefield-player').addEventListener('click', (e) => handleSlotClick(e, 'bottom'));
  $('#player-hand').addEventListener('click', handleHandClick);
  $('#btn-end-turn').addEventListener('click', handleEndTurn);
  $('#btn-cancel-action').addEventListener('click', () => { engine.cancelPending(); selectedUid = null; renderAll(); });
  $('#btn-target-cancel').addEventListener('click', () => { engine.cancelPending(); renderAll(); });
}

export function startBattleUI(newEngine, doneCallback) {
  engine = newEngine;
  onDone = doneCallback;
  selectedUid = null;
  renderAll();
}

function handleSlotClick(e, physicalRow) {
  if (!engine || engine.winner) return;
  const el = e.target.closest('.slot');
  if (!el) return;
  const index = Number(el.dataset.index);

  if (engine.pendingAction && engine.pendingAction.type === 'place') {
    const result = engine.provideSlot(physicalRow, index);
    afterEngineAction(result);
    return;
  }
  if (engine.pendingAction && engine.pendingAction.type === 'target') {
    const valid = engine.getValidTargets(engine.pendingAction.side, requestedTargetType());
    const match = valid.find((t) => t.kind === 'creature' && t.row === physicalRow && t.index === index);
    if (match) { const r = engine.provideTarget(match); afterEngineAction(r); }
    return;
  }
  // Free selection of one's own creature.
  const creature = engine.rows[physicalRow][index];
  if (engine.active !== 'player') return;
  if (!creature || creature.owner !== 'player') { selectedUid = null; renderAll(); return; }
  selectedUid = selectedUid === creature.uid ? null : creature.uid;
  renderAll();
}

function requestedTargetType() {
  return engine.pendingAction ? (engine.pendingAction.targetType || inferTargetTypeFromPending()) : null;
}
function inferTargetTypeFromPending() {
  // requestPlayCard/provideSlot store targetType implicitly on the pending
  // 'target' action via the caller; battle.js doesn't stash it, so we
  // recompute from the ability key it already stored.
  const key = engine.pendingAction.abilityKey;
  return ABILITY_INFO[key]?.targetType;
}

function handleHandClick(e) {
  if (!engine || engine.winner || engine.active !== 'player') return;
  if (engine.pendingAction) return;
  const el = e.target.closest('.card');
  if (!el) return;
  const idx = Number(el.dataset.index);
  const result = engine.requestPlayCard('player', idx);
  if (!result.ok) { engine.log(result.reason); renderAll(); return; }
  afterEngineAction(result);
}

function afterEngineAction(result) {
  if (result && !result.ok) { engine.log(result.reason || 'Invalid action.'); renderAll(); return; }
  if (result && result.ok && result.step === 'target' && requestedTargetType() && isDiscardTargetType(requestedTargetType())) {
    openTargetOverlay(result.targetType, result.targets);
  } else {
    closeTargetOverlay();
  }
  renderAll();
  checkWinner();
}

function isDiscardTargetType(t) { return t === 'ownDiscardCreature' || t === 'enemyDiscardCreature' || t === 'ownDiscardEquipment'; }

function openTargetOverlay(targetType, targets) {
  const overlay = $('#target-overlay');
  const list = $('#target-list');
  $('#target-title').textContent = 'Choose a target';
  list.innerHTML = '';
  if (targets.length === 0) {
    list.innerHTML = '<div class="target-chip">No valid targets.</div>';
  }
  targets.forEach((t) => {
    const chip = document.createElement('button');
    chip.className = 'target-chip';
    chip.textContent = `${t.card.name} (${t.card.rank}${SUITS[t.card.suit].symbol})`;
    chip.addEventListener('click', () => { const r = engine.provideTarget(t); closeTargetOverlay(); renderAll(); checkWinner(); });
    list.appendChild(chip);
  });
  overlay.classList.add('active');
}
function closeTargetOverlay() { $('#target-overlay').classList.remove('active'); }

function handleEndTurn() {
  if (!engine || engine.winner || engine.active !== 'player' || engine.pendingAction) return;
  selectedUid = null;
  engine.endTurn();
  renderAll();
  if (engine.winner) { checkWinner(); return; }
  setTimeout(() => {
    if (!engine || engine.winner) return;
    runAITurn(engine);
    if (!engine.winner) engine.endTurn();
    renderAll();
    checkWinner();
  }, 450);
}

function checkWinner() {
  if (engine && engine.winner && onDone) { const w = engine.winner; setTimeout(() => onDone(w), 500); }
}

// ------------------------------------------------------------------- Render
function renderAll() {
  if (!engine) return;
  renderStatusPills();
  renderBoard('top', 'battlefield-enemy');
  renderBoard('bottom', 'battlefield-player');
  renderActionPanel();
  renderHand();
  renderLog();
  const canEndTurn = engine.active === 'player' && !engine.pendingAction && !engine.winner;
  $('#btn-end-turn').disabled = !canEndTurn;
  $('#btn-cancel-action').disabled = !engine.pendingAction;
  if (!engine.pendingAction || !isDiscardTargetType(requestedTargetType())) closeTargetOverlay();
}

function renderStatusPills() {
  const p = engine.sides.player, e = engine.sides.enemy;
  $('#battle-player-status').textContent = `You: ${p.mana}💧 ${p.shields.length}🛡 ${p.hand.length}🂠`;
  $('#battle-enemy-status').textContent = `Foe: ${e.mana}💧 ${e.shields.length}🛡 ${e.hand.length}🂠`;
  $('#battle-turn').textContent = engine.active === 'player' ? 'Your Turn' : "Enemy's Turn";
}

function statusIcons(c) {
  const bits = [];
  if (c.statuses.protected) bits.push('🛡');
  if (c.statuses.fortified) bits.push('⚓');
  if (c.statuses.rooted) bits.push('🌿');
  if (c.statuses.poison) bits.push(`☠${c.statuses.poison}`);
  if (c.statuses.cannotAttack) bits.push('😨');
  if (c.statuses.silenced) bits.push('🔇');
  if (c.statuses.stealth) bits.push('👻');
  if (c.statuses.berserk) bits.push('😡');
  if (c.statuses.enrage) bits.push('🔥');
  if (c.statuses.multiAttack) bits.push('⚔⚔');
  if (c.statuses.counterattack) bits.push('↩');
  if (c.statuses.lifesteal) bits.push('♥');
  if (c.statuses.regen) bits.push('💫');
  return bits.join(' ');
}

function renderBoard(physicalRow, containerId) {
  const el = $(`#${containerId}`);
  el.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const c = engine.rows[physicalRow][i];
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.index = i;
    if (selectableSlot(physicalRow, i)) slot.classList.add('selectable');
    if (c && c.uid === selectedUid) slot.classList.add('selected');
    if (c) {
      const rank = Math.max(1, effectiveRank(c));
      slot.innerHTML = `
        <div class="mini-card suit-${c.suit}">
          ${c.equipment ? '<div class="mc-equip">🗡</div>' : ''}
          <div class="mc-top"><span>${c.owner === 'player' ? '🧍' : '👹'}</span><span>${SUITS[c.suit].symbol}</span></div>
          <div class="mc-rank">${rank}</div>
          <div class="mc-name">${c.name}</div>
          <div class="mc-status">${statusIcons(c)}</div>
        </div>`;
    }
    el.appendChild(slot);
  }
}

function selectableSlot(row, index) {
  if (!engine.pendingAction) return false;
  const pa = engine.pendingAction;
  if (pa.type === 'place') {
    if (pa.kind === 'creature') return !engine.rows[row][index] && row === engine.homeRow(pa.side);
    const c = engine.rows[row][index];
    return !!c && c.owner === pa.side;
  }
  if (pa.type === 'target') {
    const tt = inferTargetTypeFromPending();
    if (tt === 'ownCreature' || tt === 'enemyCreature' || tt === 'enemyEquipment') {
      const targets = engine.getValidTargets(pa.side, tt);
      return targets.some((t) => t.row === row && t.index === index);
    }
  }
  return false;
}

function renderActionPanel() {
  const panel = $('#action-panel');
  panel.innerHTML = '';
  if (engine.pendingAction || engine.active !== 'player' || !selectedUid) return;
  const loc = engine.findCreature(selectedUid);
  if (!loc) { selectedUid = null; return; }
  const { row, index } = loc;
  const c = engine.rows[row][index];
  const home = engine.homeRow('player');

  const canMove = !c.movedThisTurn && !c.statuses.fortified && !c.statuses.rooted;
  const leftOk = canMove && index > 0 && !engine.rows[row][index - 1];
  const rightOk = canMove && index < 2 && !engine.rows[row][index + 1];
  const fwdOk = canMove && row === home && !engine.rows[row === 'top' ? 'bottom' : 'top'][index];
  const backOk = canMove && row !== home && !engine.rows[home][index];

  const allowedAtk = c.statuses.multiAttack ? 2 : 1;
  const target = engine.getAdjacentTarget(c, row, index);
  const canAttack = c.attacksUsed < allowedAtk && !c.statuses.cannotAttack && target.kind !== 'none';

  const mkBtn = (label, enabled, fn) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label; b.disabled = !enabled;
    b.addEventListener('click', fn);
    return b;
  };
  panel.appendChild(mkBtn('◀ Left', leftOk, () => { engine.moveCreature(row, index, 'left'); renderAll(); }));
  panel.appendChild(mkBtn('Right ▶', rightOk, () => { engine.moveCreature(row, index, 'right'); renderAll(); }));
  panel.appendChild(mkBtn('▲ Advance', fwdOk, () => { engine.moveCreature(row, index, 'forward'); renderAll(); }));
  panel.appendChild(mkBtn('▼ Retreat', backOk, () => { engine.moveCreature(row, index, 'backward'); renderAll(); }));
  panel.appendChild(mkBtn(target.kind === 'direct' ? 'Attack (Direct!)' : 'Attack', canAttack, () => { engine.attackCreature(row, index); renderAll(); checkWinner(); }));
}

function renderHand() {
  const hand = $('#player-hand');
  hand.innerHTML = '';
  engine.sides.player.hand.forEach((card, i) => {
    const cost = card.type === 'creature' ? engine.computeCreatureCost('player', card) : card.baseCost;
    const affordable = engine.sides.player.mana >= cost;
    const el = document.createElement('div');
    el.className = `card suit-${card.suit} ${affordable ? 'affordable' : 'unaffordable'}`;
    el.dataset.index = i;
    const abilityLabel = card.abilities[0] ? ABILITY_INFO[card.abilities[0]].label : '';
    el.innerHTML = `
      <div class="c-top"><span>${cost}💧</span><span>${SUITS[card.suit].symbol}</span></div>
      <div class="c-rank">${card.rank}</div>
      <div class="c-name">${card.name}</div>
      <div class="c-type">${card.type}${abilityLabel ? ' · ' + abilityLabel : ''}</div>`;
    hand.appendChild(el);
  });
}

function renderLog() {
  const panel = $('#log-panel');
  panel.innerHTML = engine.log_.slice(-5).map((l) => `<div>${l}</div>`).join('');
  panel.scrollTop = panel.scrollHeight;
}
