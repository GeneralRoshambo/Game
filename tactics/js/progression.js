// ============================================================================
// ROGUELIKE PROGRESSION — map, enemy decks, relics, post-battle rewards.
// Pure data + small pure helpers; the battle engine and UI don't know this
// file exists (rewards just mutate the run's plain-object state).
// ============================================================================

import { RANKS, CARD_DB, getCardDef, instantiate, buildDeckFromCounts, buildStarterDeck, MAX_COPIES } from './cards.js';

export const RELICS = [
  { id: 'iron_banner', name: 'Iron Banner', icon: '🛡️', desc: 'Start each battle with 1 extra Shield.', extraShields: 1 },
  { id: 'arcane_battery', name: 'Arcane Battery', icon: '🔋', desc: 'Start each battle with 2 extra Mana.', extraMana: 2 },
  { id: 'hearth_sigil', name: 'Hearth Sigil', icon: '♥', desc: 'Hearts creatures cost 1 additional less mana.', suitDiscount: 'H' },
  { id: 'blood_standard', name: 'Blood Standard', icon: '♣', desc: 'Clubs creatures cost 1 additional less mana.', suitDiscount: 'C' },
  { id: 'gilded_ledger', name: 'Gilded Ledger', icon: '♦', desc: 'Diamonds creatures cost 1 additional less mana.', suitDiscount: 'D' },
  { id: 'veil_of_ash', name: 'Veil of Ash', icon: '♠', desc: 'Spades creatures cost 1 additional less mana.', suitDiscount: 'S' },
];
export function getRelic(id) { return RELICS.find((r) => r.id === id); }

export function relicBattleOpts(relicIds) {
  const opts = { extraShields: 0, extraMana: 0, suitDiscount: null };
  for (const id of relicIds) {
    const r = getRelic(id);
    if (!r) continue;
    if (r.extraShields) opts.extraShields += r.extraShields;
    if (r.extraMana) opts.extraMana += r.extraMana;
    if (r.suitDiscount) opts.suitDiscount = r.suitDiscount;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Enemy decks — smaller than the 40-card player deck, keeping fights snappy.
// ---------------------------------------------------------------------------
const ENEMY_DECKS = {
  goblin_warband: { name: 'Goblin Warband', icon: '👺', kind: 'fight',
    counts: { c_thorn: 3, c_rat: 3, c_boar: 2, c_wolf: 2, c_ent: 1, c_bloodlust: 2, c_rend: 2, c_collar: 1, h_sprite: 2, d_prospector: 2 } },
  bone_court: { name: 'Bone Court', icon: '💀', kind: 'fight',
    counts: { s_shade: 3, s_thief: 2, s_marionette: 2, s_silencer: 2, s_reaper: 1, s_nightmare: 2, s_drain: 2, s_blade: 1, h_sprite: 2, d_prospector: 2 } },
  candle_choir: { name: 'Candle Choir', icon: '🕯️', kind: 'fight',
    counts: { h_sprite: 3, h_healer: 2, h_maiden: 2, h_guardian: 1, h_cleric: 1, h_bless: 2, h_restore: 2, h_ward: 1, d_prospector: 2, c_thorn: 2 } },
  construct_vanguard: { name: 'Construct Vanguard', icon: '🗿', kind: 'elite', enemyExtraShields: 1, enemyExtraMana: 1,
    counts: { d_prospector: 2, d_smith: 2, d_vault: 2, d_forge: 2, d_sage: 2, d_blueprint: 2, d_salvage: 2, d_engine: 2, c_thorn: 2, h_healer: 2, s_shade: 2, h_sprite: 2 } },
  hollow_sovereign: { name: 'The Hollow Sovereign', icon: '👑', kind: 'boss', enemyExtraShields: 2, enemyExtraMana: 3,
    counts: { h_cleric: 2, h_guardian: 2, c_ent: 2, c_wolf: 2, d_sage: 2, d_forge: 2, s_reaper: 2, s_silencer: 2, h_healer: 2, c_boar: 2, d_vault: 2, s_marionette: 2, h_bless: 2, c_rend: 2, d_blueprint: 2, s_drain: 2 } },
};
export function buildEnemyDeck(key) {
  const def = ENEMY_DECKS[key];
  return buildDeckFromCounts(def.counts);
}
export function enemyInfo(key) { return ENEMY_DECKS[key]; }

// ---------------------------------------------------------------------------
// Map — a short branching path: 2 regular fights, one shop/event, one elite,
// one more regular fight, then the boss. ~10-15 minutes total.
// ---------------------------------------------------------------------------
export const STAGE_PLAN = [
  { type: 'fight', label: 'Duel', choices: ['goblin_warband', 'bone_court'] },
  { type: 'fight', label: 'Duel', choices: ['candle_choir', 'goblin_warband'] },
  { type: 'event', label: 'Wandering Merchant' },
  { type: 'elite', label: 'Elite Duel', choices: ['construct_vanguard'] },
  { type: 'fight', label: 'Duel', choices: ['bone_court', 'candle_choir'] },
  { type: 'boss', label: 'Boss Duel', choices: ['hollow_sovereign'] },
];

export function newRunState() {
  return {
    stageIndex: 0,
    deck: buildStarterDeck(),
    relics: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Post-battle rewards: add / remove / upgrade / transform / duplicate a
// card, or gain a relic. Elites bias the "add" pool toward higher ranks.
// ---------------------------------------------------------------------------
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function copyCountsInDeck(deck) {
  const counts = {};
  for (const c of deck) counts[c.defId] = (counts[c.defId] || 0) + 1;
  return counts;
}

function makeAddCardReward(runState, biasHighRank) {
  const counts = copyCountsInDeck(runState.deck);
  const pool = CARD_DB.filter((d) => (counts[d.id] || 0) < MAX_COPIES && (!biasHighRank || RANKS.indexOf(d.rank) >= RANKS.indexOf('8')));
  const def = pick(pool.length ? pool : CARD_DB);
  return {
    icon: '➕', name: 'Add a Card',
    desc: `Add ${def.name} (${def.rank}${def.suit}) to your deck.`,
    apply() { runState.deck.push(instantiate(def)); },
  };
}

function makeRemoveCardReward(runState) {
  const card = pick(runState.deck);
  return {
    icon: '➖', name: 'Remove a Card',
    desc: `Remove ${card.name} (${card.rank}${card.suit}) from your deck.`,
    apply() { runState.deck = runState.deck.filter((c) => c.uid !== card.uid); },
  };
}

function makeUpgradeCardReward(runState) {
  const candidates = runState.deck.filter((c) => c.rank !== 'A');
  const card = pick(candidates.length ? candidates : runState.deck);
  const nextRank = RANKS[Math.min(RANKS.length - 1, RANKS.indexOf(card.rank) + 1)];
  return {
    icon: '📈', name: 'Upgrade a Card',
    desc: `${card.name} permanently becomes rank ${nextRank} (same mana cost).`,
    apply() { card.rank = nextRank; },
  };
}

function makeTransformCardReward(runState) {
  const card = pick(runState.deck);
  const alt = pick(CARD_DB.filter((d) => d.id !== card.defId));
  return {
    icon: '🔀', name: 'Transform a Card',
    desc: `Replace ${card.name} with ${alt.name} (${alt.rank}${alt.suit}).`,
    apply() {
      const idx = runState.deck.findIndex((c) => c.uid === card.uid);
      if (idx !== -1) runState.deck.splice(idx, 1, instantiate(alt));
    },
  };
}

function makeDuplicateCardReward(runState) {
  const counts = copyCountsInDeck(runState.deck);
  const candidates = runState.deck.filter((c) => (counts[c.defId] || 0) < MAX_COPIES);
  const card = pick(candidates.length ? candidates : runState.deck);
  return {
    icon: '✨', name: 'Duplicate a Card',
    desc: `Add another copy of ${card.name} to your deck.`,
    apply() { runState.deck.push(instantiate(getCardDef(card.defId))); },
  };
}

function makeRelicReward(runState) {
  const owned = runState.relics;
  const options = RELICS.filter((r) => !owned.has(r.id));
  const relic = pick(options);
  return {
    icon: relic.icon, name: relic.name, desc: relic.desc,
    apply() { runState.relics.add(relic.id); },
  };
}

// The Wandering Merchant event: always the same three utility choices,
// rather than the randomized post-battle pool.
export function buildEventPool(runState) {
  const pool = [makeUpgradeCardReward(runState)];
  if (runState.deck.length > 24) pool.push(makeRemoveCardReward(runState));
  else pool.push(makeAddCardReward(runState, false));
  if (runState.relics.size < RELICS.length) pool.push(makeRelicReward(runState));
  else pool.push(makeDuplicateCardReward(runState));
  return pool;
}

export function buildRewardPool(runState, kind) {
  const pool = [
    makeAddCardReward(runState, kind === 'elite' || kind === 'boss'),
    makeUpgradeCardReward(runState),
    makeTransformCardReward(runState),
    makeDuplicateCardReward(runState),
  ];
  if (runState.deck.length > 24) pool.push(makeRemoveCardReward(runState));
  if (runState.relics.size < RELICS.length) pool.push(makeRelicReward(runState));
  // shuffle + take 3
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}
