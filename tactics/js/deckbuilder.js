// ============================================================================
// DECKBUILDER + CUSTOM CARD CREATOR — between-run deck editing. Every card
// the player can own (premade + player-authored) lives in one pool; the
// creator only ever offers suit-legal abilities, so no custom card can
// violate the suit-restriction rule.
// ============================================================================

import { SUITS, RANKS, SUIT_ABILITIES, CARD_DB, computeBaseCost, MAX_COPIES, DECK_SIZE, getCardDef, STARTER_DECK_COUNTS } from './cards.js';
import { ABILITY_INFO } from './abilities.js';

const $ = (sel) => document.querySelector(sel);

let saveState = null;
let persist = null;
let onBack = null;
let mounted = false;

export function mountDeckbuilder(state, persistFn, backFn) {
  saveState = state; persist = persistFn; onBack = backFn;
  if (!saveState.deckCounts) saveState.deckCounts = defaultDeckCounts();
  if (!saveState.customCards) saveState.customCards = [];
  if (mounted) return;
  mounted = true;
  $('#btn-create-card').addEventListener('click', showCreator);
  $('#btn-deck-back').addEventListener('click', () => onBack());
  $('#btn-deck-save').addEventListener('click', saveDeckAndBack);
  $('#btn-creator-cancel').addEventListener('click', () => { switchTo('deckbuilder'); });
  $('#btn-creator-save').addEventListener('click', saveCustomCard);
  $('#cc-type').addEventListener('change', renderCreatorAbilities);
  $('#cc-suit').addEventListener('change', renderCreatorAbilities);
  $('#cc-rank').addEventListener('change', renderCreatorCost);
  fillCreatorSelects();
}

function switchTo(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${id}`).classList.add('active');
}

function defaultDeckCounts() {
  const counts = {};
  for (const c of CARD_DB) counts[c.id] = 0;
  // Single source of truth (cards.js) — see STARTER_DECK_COUNTS.
  Object.assign(counts, STARTER_DECK_COUNTS);
  return counts;
}

export function pool() { return CARD_DB.concat(saveState.customCards); }
function findDef(id) { return getCardDef(id) || saveState.customCards.find((c) => c.id === id); }

export function currentDeckTotal() {
  return Object.values(saveState.deckCounts).reduce((a, b) => a + b, 0);
}

export function showDeckbuilder() {
  switchTo('deckbuilder');
  renderDeckList();
}

function renderDeckList() {
  const total = currentDeckTotal();
  $('#deck-count-pill').textContent = `${total} / ${DECK_SIZE} cards`;
  $('#deck-count-pill').style.color = total === DECK_SIZE ? '' : '#e05a6d';
  $('#btn-deck-save').disabled = total !== DECK_SIZE;

  const list = $('#deck-list');
  list.innerHTML = '';
  pool().forEach((def) => {
    const count = saveState.deckCounts[def.id] || 0;
    const row = document.createElement('div');
    row.className = 'deck-row';
    row.innerHTML = `
      <button data-act="dec">−</button>
      <div class="dr-count">${count}</div>
      <button data-act="inc">+</button>
      <div class="dr-name">${def.name} <span class="dr-meta">${def.rank}${SUITS[def.suit].symbol} · ${def.type} · ${def.baseCost}💧</span></div>`;
    row.querySelector('[data-act="inc"]').addEventListener('click', () => {
      if (count >= MAX_COPIES || total >= DECK_SIZE) return;
      saveState.deckCounts[def.id] = count + 1;
      renderDeckList();
    });
    row.querySelector('[data-act="dec"]').addEventListener('click', () => {
      if (count <= 0) return;
      saveState.deckCounts[def.id] = count - 1;
      renderDeckList();
    });
    list.appendChild(row);
  });
}

function saveDeckAndBack() {
  if (currentDeckTotal() !== DECK_SIZE) return;
  persist();
  onBack();
}

// ------------------------------------------------------------- Card Creator
function fillCreatorSelects() {
  const suitSel = $('#cc-suit');
  suitSel.innerHTML = Object.entries(SUITS).map(([k, v]) => `<option value="${k}">${v.symbol} ${v.name}</option>`).join('');
  const rankSel = $('#cc-rank');
  rankSel.innerHTML = RANKS.map((r) => `<option value="${r}">${r}</option>`).join('');
}

function showCreator() {
  $('#cc-name').value = '';
  $('#cc-type').value = 'creature';
  $('#cc-suit').value = 'H';
  $('#cc-rank').value = '5';
  $('#cc-flavor').value = '';
  renderCreatorAbilities();
  switchTo('creator');
}

function renderCreatorCost() {
  $('#cc-cost-pill').textContent = `Mana Cost: ${computeBaseCost($('#cc-rank').value)}`;
}

function renderCreatorAbilities() {
  renderCreatorCost();
  const suit = $('#cc-suit').value;
  const keys = SUIT_ABILITIES[suit];
  const wrap = $('#cc-abilities');
  wrap.innerHTML = `<div class="cc-ab-desc">Pick up to 3 abilities (only ${SUITS[suit].name} abilities are legal on this card):</div>`;
  keys.forEach((key) => {
    const info = ABILITY_INFO[key];
    const row = document.createElement('label');
    row.className = 'cc-ability-row';
    row.innerHTML = `<input type="checkbox" value="${key}" /><span><b>${info.label}</b><br><span class="cc-ab-desc">${info.desc({ rank: $('#cc-rank').value })}</span></span>`;
    const box = row.querySelector('input');
    box.addEventListener('change', () => {
      const checked = wrap.querySelectorAll('input:checked');
      if (checked.length > 3) box.checked = false;
    });
    wrap.appendChild(row);
  });
}

function saveCustomCard() {
  const name = $('#cc-name').value.trim() || 'Unnamed Card';
  const type = $('#cc-type').value;
  const suit = $('#cc-suit').value;
  const rank = $('#cc-rank').value;
  const flavor = $('#cc-flavor').value.trim();
  const abilities = [...document.querySelectorAll('#cc-abilities input:checked')].map((el) => el.value).slice(0, 3);
  const id = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const def = { id, type, name, suit, rank, abilities, flavor, baseCost: computeBaseCost(rank) };
  saveState.customCards.push(def);
  saveState.deckCounts[id] = 0;
  persist();
  showDeckbuilder();
}
