// ============================================================================
// CARD DATA LAYER — ranks, suits, cost curve, ability whitelists, card
// database. Purely data + small pure helpers: no battle logic lives here,
// so new cards/suits/costs can be added without touching the engine.
// ============================================================================

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Strength used for combat comparisons. Ace is highest (beats King).
export const RANK_VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };

// Suggested mana cost curve, before suit-affinity discounts.
export const RANK_BASE_COST = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 7: 3, 8: 5, 9: 5, 10: 6, J: 7, Q: 8, K: 9, A: 10 };

export const SUITS = {
  H: { name: 'Hearts', symbol: '♥', color: 'red', theme: 'Healing, protection, revival, support' },
  C: { name: 'Clubs', symbol: '♣', color: 'black', theme: 'Aggression, poison, pressure, board control' },
  D: { name: 'Diamonds', symbol: '♦', color: 'blue', theme: 'Economy, artifacts, construction, buffing' },
  S: { name: 'Spades', symbol: '♠', color: 'purple', theme: 'Control, sacrifice, removal, manipulation' },
};

// Every ability keyword a suit is allowed to print. The custom card creator
// enforces this; the premade database only ever uses legal combinations too.
export const SUIT_ABILITIES = {
  H: ['heal', 'shield_grant', 'revive', 'regen', 'draw', 'bless_buff', 'lifesteal', 'protect', 'restore', 'purify'],
  C: ['poison', 'root', 'berserk', 'multi_attack', 'counterattack', 'destroy_equipment', 'bleed', 'enrage', 'fight_bonus', 'exile'],
  D: ['search_deck', 'create_token', 'copy', 'reinforce', 'mine_mana', 'repair', 'stealth', 'fortify', 'upgrade', 'duplicate'],
  S: ['destroy', 'steal', 'sacrifice', 'curse', 'discard', 'counter_spell', 'silence', 'fear', 'drain', 'reanimate_enemy'],
};

export function rankIndex(rank) { return RANKS.indexOf(rank); }

// Scales an ability's numeric magnitude off the card's rank so premade cards
// and custom-built cards balance the same way with zero manual tuning.
export function abilityMagnitude(card) {
  return Math.max(1, Math.round(RANK_VALUE[card.rank] / 4));
}

export function computeBaseCost(rank) {
  return RANK_BASE_COST[rank];
}

let uid = 1;
function def(id, type, name, suit, rank, abilities, flavor) {
  return { id, type, name, suit, rank, abilities, flavor, baseCost: computeBaseCost(rank) };
}

// Instantiates a live copy of a card definition (fresh uid, no battle state).
export function instantiate(cardDef) {
  return {
    uid: uid++,
    defId: cardDef.id,
    type: cardDef.type,
    name: cardDef.name,
    suit: cardDef.suit,
    rank: cardDef.rank,
    abilities: cardDef.abilities.slice(),
    flavor: cardDef.flavor,
    baseCost: cardDef.baseCost,
    // Live battle state (only meaningful once on the battlefield):
    rankMod: 0, tempRankMod: 0, statuses: {}, equipment: null, attacksUsed: 0,
  };
}

export function effectiveRank(card) {
  return RANK_VALUE[card.rank] + (card.rankMod || 0) + (card.tempRankMod || 0) + (card.equipment ? card.equipment.rankBonus : 0);
}

// ---------------------------------------------------------------------------
// Card database. A small, representative spread per suit (curve + identity)
// rather than an exhaustive set — the custom card creator lets players fill
// in any other suit-legal combination.
// ---------------------------------------------------------------------------
export const CARD_DB = [
  // Hearts
  def('h_sprite', 'creature', 'Meadow Sprite', 'H', '2', ['draw'], 'A gentle wisp of light.'),
  def('h_healer', 'creature', 'Healing Sprite', 'H', '4', ['heal'], 'Its touch mends what was broken.'),
  def('h_maiden', 'creature', 'Shield Maiden', 'H', '6', ['shield_grant'], 'She stands so others need not fall.'),
  def('h_guardian', 'creature', 'Temple Guardian', 'H', '8', ['protect'], 'Ancient stone, patient watch.'),
  def('h_cleric', 'creature', 'Grand Cleric', 'H', 'K', ['revive'], 'Death is a suggestion, not a rule.'),
  def('h_bless', 'spell', 'Blessing', 'H', '5', ['bless_buff'], 'A moment of borrowed strength.'),
  def('h_restore', 'spell', 'Restoration', 'H', '3', ['restore'], 'What was lost, returns.'),
  def('h_ward', 'equipment', 'Sacred Ward', 'H', '3', ['purify'], 'Cleanses the wearer of old hexes.'),

  // Clubs
  def('c_thorn', 'creature', 'Thornling', 'C', '2', ['root'], 'Roots snake underfoot.'),
  def('c_rat', 'creature', 'Venom Rat', 'C', '4', ['poison'], 'Small teeth, slow ruin.'),
  def('c_boar', 'creature', 'Berserk Boar', 'C', '6', ['berserk'], 'Charges without thinking twice.'),
  def('c_wolf', 'creature', 'Twin Fang Wolf', 'C', '8', ['multi_attack'], 'One bite is never enough.'),
  def('c_ent', 'creature', 'Rampaging Ent', 'C', 'A', ['enrage'], 'The forest remembers every axe.'),
  def('c_bloodlust', 'spell', 'Bloodlust', 'C', '5', ['fight_bonus'], 'Force the issue.'),
  def('c_rend', 'spell', 'Rend', 'C', '3', ['bleed'], 'A wound that will not close.'),
  def('c_collar', 'equipment', 'Barbed Collar', 'C', '4', ['counterattack'], 'Even in defeat, it bites back.'),

  // Diamonds
  def('d_prospector', 'creature', 'Prospector', 'D', '2', ['mine_mana'], 'Strikes gold, strikes mana.'),
  def('d_smith', 'creature', 'Rune Smith', 'D', '4', ['reinforce'], 'Every strike, a little stronger.'),
  def('d_vault', 'creature', 'Vault Keeper', 'D', '6', ['search_deck'], 'Knows exactly where everything is.'),
  def('d_forge', 'creature', 'Golem Forge', 'D', '8', ['create_token'], 'Never stops building.'),
  def('d_sage', 'creature', 'Mirror Sage', 'D', 'Q', ['copy'], 'Reflects what it sees, perfectly.'),
  def('d_blueprint', 'spell', 'Upgrade Blueprint', 'D', '4', ['upgrade'], 'A better design, permanently applied.'),
  def('d_salvage', 'spell', 'Salvage', 'D', '3', ['repair'], 'Nothing is truly discarded.'),
  def('d_engine', 'equipment', 'Duplication Engine', 'D', '5', ['duplicate'], 'One becomes two.'),

  // Spades
  def('s_shade', 'creature', 'Shade', 'S', '2', ['fear'], 'A shape at the edge of sight.'),
  def('s_thief', 'creature', 'Grave Thief', 'S', '4', ['steal'], 'Takes what it did not earn.'),
  def('s_marionette', 'creature', 'Cursed Marionette', 'S', '6', ['curse'], 'Strings pulled by something unseen.'),
  def('s_silencer', 'creature', 'Silencer', 'S', '8', ['silence'], 'It speaks, and others cannot.'),
  def('s_reaper', 'creature', 'Death Reaper', 'S', 'A', ['destroy'], 'The last thing many things see.'),
  def('s_nightmare', 'spell', 'Nightmare', 'S', '5', ['discard'], 'Wakes up holding less than before.'),
  def('s_drain', 'spell', 'Soul Drain', 'S', '4', ['drain'], 'Their loss, your gain.'),
  def('s_blade', 'equipment', 'Cursed Blade', 'S', '4', ['sacrifice'], 'Power, for a price.'),
];

export function getCardDef(id) { return CARD_DB.find((c) => c.id === id); }

// Builds a deck from {defId: copyCount}. Used for the player's starter deck
// and for every enemy deck in progression.js — one shared, data-driven path.
export function buildDeckFromCounts(counts) {
  const list = [];
  for (const [id, n] of Object.entries(counts)) {
    const cardDef = getCardDef(id);
    if (!cardDef) continue;
    for (let i = 0; i < n; i++) list.push(instantiate(cardDef));
  }
  return list;
}

// The canonical 40-card starter deck (10 cards per suit, evenly spread across
// the database). This is the single source of truth for that count table —
// both buildStarterDeck() and the deckbuilder's default deck read from it, so
// the two can never drift out of sync with each other or with DECK_SIZE.
export const STARTER_DECK_COUNTS = {
  h_sprite: 2, h_healer: 2, h_maiden: 1, h_guardian: 1, h_cleric: 1, h_bless: 1, h_restore: 1, h_ward: 1,
  c_thorn: 2, c_rat: 2, c_boar: 1, c_wolf: 1, c_ent: 1, c_bloodlust: 1, c_rend: 1, c_collar: 1,
  d_prospector: 2, d_smith: 2, d_vault: 1, d_forge: 1, d_sage: 1, d_blueprint: 1, d_salvage: 1, d_engine: 1,
  s_shade: 2, s_thief: 2, s_marionette: 1, s_silencer: 1, s_reaper: 1, s_nightmare: 1, s_drain: 1, s_blade: 1,
};

// A ready-to-play 40-card starter deck spanning all four suits evenly.
export function buildStarterDeck() {
  return buildDeckFromCounts(STARTER_DECK_COUNTS);
}

export const DECK_SIZE = 40;
export const MAX_COPIES = 4;

export function validateDeck(deckDefIds) {
  const errors = [];
  if (deckDefIds.length !== DECK_SIZE) errors.push(`Deck must contain exactly ${DECK_SIZE} cards (has ${deckDefIds.length}).`);
  const counts = {};
  for (const id of deckDefIds) counts[id] = (counts[id] || 0) + 1;
  for (const [id, n] of Object.entries(counts)) {
    if (n > MAX_COPIES) errors.push(`Too many copies of ${getCardDef(id)?.name || id} (${n}/${MAX_COPIES}).`);
  }
  return errors;
}
