// ============================================================================
// BATTLE ENGINE — battlefield, turns, mana, shields, movement, combat.
// Knows nothing about the DOM and nothing about ability *logic* (it dispatches
// through abilities.js). This is what lets abilities/AI/UI evolve independently.
// ============================================================================

import { RANK_VALUE, RANKS, effectiveRank, instantiate, getCardDef, computeBaseCost } from './cards.js';
import { ABILITY_INFO, resolveAbility, abilityTargetType } from './abilities.js';

const EQUIPMENT_RANK_BONUS = 1;
const OPENING_HAND_SIZE = 5;

// The board is a true 3x3 grid: each side's home row, plus a neutral middle
// row between them. ROW_SEQUENCE gives the path a creature walks from its
// owner's home row, through the middle, into the opponent's home row.
// PHYSICAL_NEIGHBORS gives simple up/down adjacency for combat, independent
// of who owns what (needed because Steal/invasion can put a creature in a
// row it doesn't "belong" to).
const ROW_SEQUENCE = { player: ['bottom', 'mid', 'top'], enemy: ['top', 'mid', 'bottom'] };
const PHYSICAL_NEIGHBORS = { top: ['mid'], mid: ['top', 'bottom'], bottom: ['mid'] };
const CENTER_COLUMN = 1;

// Abilities safe to auto-resolve straight off a flipped Shield card: no
// board target and no self-status flag to attach (there's no board slot to
// attach it to — the card was never played).
const SHIELD_TRIGGER_SAFE = new Set(['heal', 'shield_grant', 'draw', 'restore', 'mine_mana', 'discard', 'counter_spell', 'drain', 'search_deck', 'create_token', 'duplicate']);

export class BattleEngine {
  constructor(playerDeck, enemyDeck, opts = {}) {
    this.sides = {
      player: this.freshSide(playerDeck),
      enemy: this.freshSide(enemyDeck),
    };
    this.rows = { top: [null, null, null], mid: [null, null, null], bottom: [null, null, null] };
    this.active = 'player';
    this.winner = null;
    this.log_ = [];
    this.pendingAction = null;
    // Relic/difficulty hooks, applied once at setup.
    this.extraShields = opts.extraShields || 0;
    this.extraMana = opts.extraMana || 0;
    this.suitDiscount = opts.suitDiscount || null; // relic: -1 mana on creatures of this suit
    this.enemyExtraShields = opts.enemyExtraShields || 0;
    this.enemyExtraMana = opts.enemyExtraMana || 0;
    this.setup();
  }

  freshSide(deck) {
    return { deck: this.shuffle(deck.slice()), hand: [], discard: [], exile: [], shields: [], mana: 0, turnsTaken: 0, counterSpell: false };
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  setup() {
    for (const side of ['player', 'enemy']) {
      for (let i = 0; i < OPENING_HAND_SIZE; i++) this.drawCards(side, 1, true);
      const shieldCount = 3 + (side === 'player' ? this.extraShields : this.enemyExtraShields);
      for (let i = 0; i < shieldCount; i++) this.gainShields(side, 1, true);
    }
    this.sides.player.mana += this.extraMana;
    this.sides.enemy.mana += this.enemyExtraMana;
    this.beginTurn('player');
  }

  log(msg) { this.log_.push(msg); if (this.log_.length > 60) this.log_.shift(); }
  other(side) { return side === 'player' ? 'enemy' : 'player'; }
  homeRow(side) { return side === 'player' ? 'bottom' : 'top'; }
  rankValue(card) { return RANK_VALUE[card.rank]; }
  rankOf(row, index) { const c = this.rows[row][index]; return c ? Math.max(1, effectiveRank(c)) : 0; }

  // Row one step toward the opponent / back toward home, for this owner's
  // path (home -> mid -> opponent-home). Null if already at that end.
  forwardRowOf(owner, row) { const seq = ROW_SEQUENCE[owner]; const at = seq.indexOf(row); return at < seq.length - 1 ? seq[at + 1] : null; }
  backwardRowOf(owner, row) { const seq = ROW_SEQUENCE[owner]; const at = seq.indexOf(row); return at > 0 ? seq[at - 1] : null; }

  // ---------------------------------------------------------------- Board
  findCreature(uid) {
    for (const row of ['top', 'mid', 'bottom']) {
      for (let i = 0; i < 3; i++) if (this.rows[row][i] && this.rows[row][i].uid === uid) return { row, index: i };
    }
    return null;
  }

  emptyHomeSlots(side) {
    const row = this.homeRow(side);
    const out = [];
    for (let i = 0; i < 3; i++) if (!this.rows[row][i]) out.push({ row, index: i });
    return out;
  }

  ownedCreatures(side) {
    const out = [];
    for (const row of ['top', 'mid', 'bottom']) for (let i = 0; i < 3; i++) {
      const c = this.rows[row][i];
      if (c && c.owner === side) out.push({ row, index: i, creature: c });
    }
    return out;
  }

  getValidTargets(casterSide, targetType) {
    const opp = this.other(casterSide);
    if (targetType === 'ownCreature') return this.ownedCreatures(casterSide).map((t) => ({ kind: 'creature', row: t.row, index: t.index }));
    if (targetType === 'enemyCreature') return this.ownedCreatures(opp).map((t) => ({ kind: 'creature', row: t.row, index: t.index }));
    if (targetType === 'enemyEquipment') return this.ownedCreatures(opp).filter((t) => t.creature.equipment).map((t) => ({ kind: 'creature', row: t.row, index: t.index }));
    if (targetType === 'ownDiscardCreature') return this.sides[casterSide].discard.filter((c) => c.type === 'creature').map((c) => ({ kind: 'discard', side: casterSide, uid: c.uid, card: c }));
    if (targetType === 'enemyDiscardCreature') return this.sides[opp].discard.filter((c) => c.type === 'creature').map((c) => ({ kind: 'discard', side: opp, uid: c.uid, card: c }));
    if (targetType === 'ownDiscardEquipment') return this.sides[casterSide].discard.filter((c) => c.type === 'equipment').map((c) => ({ kind: 'discard', side: casterSide, uid: c.uid, card: c }));
    return [];
  }

  // ---------------------------------------------------------------- Turns
  beginTurn(side) {
    const s = this.sides[side];
    s.mana += 2;
    if (s.turnsTaken > 0) this.drawCards(side, 1);
    s.turnsTaken++;
    for (const { row, index, creature } of this.ownedCreatures(side)) {
      creature.movedThisTurn = false;
      creature.attacksUsed = 0;
      if (creature.statuses.protected) creature.statuses.protected = false;
      if (creature.statuses.poison) {
        creature.statuses.poison--;
        if (creature.statuses.poison <= 0) { this.log(`${creature.name} succumbs to poison.`); this.destroyCreature(row, index, {}); }
      }
    }
    this.active = side;
    this.pendingAction = null;
  }

  endTurn() {
    const side = this.active;
    for (const { creature } of this.ownedCreatures(side)) {
      creature.tempRankMod = 0;
      if (creature.statuses.rooted) creature.statuses.rooted = false;
      if (creature.statuses.cannotAttack) creature.statuses.cannotAttack = false;
    }
    if (this.winner) return;
    this.beginTurn(this.other(side));
  }

  // ------------------------------------------------------------- Mana/cost
  computeCreatureCost(side, card) {
    const count = this.ownedCreatures(side).filter((t) => t.creature.suit === card.suit).length;
    let discount = Math.min(2, count);
    if (side === 'player' && this.suitDiscount === card.suit) discount += 1;
    return Math.max(1, card.baseCost - discount);
  }

  // -------------------------------------------------------------- Playing
  // Step 1: player clicks a hand card. Returns a description of what UI must
  // do next ('place', 'target', or 'done').
  requestPlayCard(side, handIndex) {
    const s = this.sides[side];
    const card = s.hand[handIndex];
    if (!card) return { ok: false, reason: 'No such card.' };

    if (card.type === 'creature') {
      const cost = this.computeCreatureCost(side, card);
      if (s.mana < cost) return { ok: false, reason: 'Not enough mana.' };
      if (this.emptyHomeSlots(side).length === 0) return { ok: false, reason: 'No empty battlefield slot.' };
      this.pendingAction = { type: 'place', kind: 'creature', side, handIndex, cost };
      return { ok: true, step: 'place', slots: this.emptyHomeSlots(side) };
    }

    if (card.type === 'equipment') {
      const cost = card.baseCost;
      if (s.mana < cost) return { ok: false, reason: 'Not enough mana.' };
      const hosts = this.ownedCreatures(side);
      if (hosts.length === 0) return { ok: false, reason: 'No creature to equip.' };
      this.pendingAction = { type: 'place', kind: 'equipment', side, handIndex, cost };
      return { ok: true, step: 'place', slots: hosts.map((h) => ({ row: h.row, index: h.index })) };
    }

    // Spell: pay + discard immediately, then resolve (possibly after a target pick).
    const cost = card.baseCost;
    if (s.mana < cost) return { ok: false, reason: 'Not enough mana.' };
    const opp = this.other(side);
    s.mana -= cost;
    s.hand.splice(handIndex, 1);
    s.discard.push(card);
    if (this.sides[opp].counterSpell) {
      this.sides[opp].counterSpell = false;
      this.log(`${card.name} was negated by a Counter!`);
      this.pendingAction = null;
      return { ok: true, step: 'done', countered: true };
    }
    const rest = this.resolveAbilityQueue(side, card, null, card.abilities.slice());
    if (rest.needsTarget) return { ok: true, step: 'target', targetType: rest.targetType, targets: rest.targets };
    return { ok: true, step: 'done' };
  }

  // Step 2 (creature/equipment only): player clicks a slot.
  provideSlot(row, index) {
    const pa = this.pendingAction;
    if (!pa || pa.type !== 'place') return { ok: false, reason: 'Nothing pending.' };
    const s = this.sides[pa.side];
    const card = s.hand[pa.handIndex];

    if (pa.kind === 'creature') {
      if (this.rows[row][index]) return { ok: false, reason: 'Slot occupied.' };
      s.mana -= pa.cost;
      s.hand.splice(pa.handIndex, 1);
      const live = { ...card, owner: pa.side, movedThisTurn: false, attacksUsed: 0 };
      this.rows[row][index] = live;
      this.log(`${pa.side} summons ${live.name} (${live.rank}${live.suit}).`);
      const rest = this.resolveAbilityQueue(pa.side, live, { row, index }, live.abilities.slice());
      if (rest.needsTarget) return { ok: true, step: 'target', targetType: rest.targetType, targets: rest.targets };
      return { ok: true, step: 'done' };
    }

    // equipment
    const host = this.rows[row][index];
    if (!host || host.owner !== pa.side) return { ok: false, reason: 'Invalid host.' };
    s.mana -= pa.cost;
    s.hand.splice(pa.handIndex, 1);
    card.rankBonus = EQUIPMENT_RANK_BONUS;
    host.equipment = card;
    this.log(`${pa.side} equips ${card.name} onto ${host.name}.`);
    // Equipment abilities whose target is 'ownCreature' auto-target the host
    // (no extra prompt) — the whole point of equipping is to affect the host.
    const rest = this.resolveAbilityQueue(pa.side, card, { row, index }, card.abilities.slice(), { kind: 'creature', row, index });
    if (rest.needsTarget) return { ok: true, step: 'target', targetType: rest.targetType, targets: rest.targets };
    return { ok: true, step: 'done' };
  }

  // Resolves a card's ability list in order. 'none'-target abilities and (if
  // autoTarget is given) 'ownCreature' abilities resolve immediately; the
  // first ability that still needs a real target pauses the queue in
  // pendingAction until provideTarget() is called, then resumes with
  // whatever abilities remain.
  resolveAbilityQueue(side, card, selfLoc, keys, autoTarget) {
    while (keys.length > 0) {
      const key = keys[0];
      const targetType = abilityTargetType(key);
      if (targetType === 'none') { resolveAbility(key, this, side, card, null, selfLoc); keys = keys.slice(1); continue; }
      if (targetType === 'ownCreature' && autoTarget) { resolveAbility(key, this, side, card, autoTarget, selfLoc); keys = keys.slice(1); continue; }
      const targets = this.getValidTargets(side, targetType);
      if (targets.length === 0) {
        this.log(`${ABILITY_INFO[key].label} fizzles: no valid target.`);
        keys = keys.slice(1);
        continue;
      }
      this.pendingAction = { type: 'target', abilityKey: key, card, side, selfLoc, remainingKeys: keys.slice(1), autoTarget };
      return { needsTarget: true, targetType, targets };
    }
    this.pendingAction = null;
    return { needsTarget: false };
  }

  // Step 2/3: player clicks a valid target (creature slot or discard-pile card).
  provideTarget(target) {
    const pa = this.pendingAction;
    if (!pa || pa.type !== 'target') return { ok: false, reason: 'Nothing pending.' };
    resolveAbility(pa.abilityKey, this, pa.side, pa.card, target, pa.selfLoc);
    const rest = this.resolveAbilityQueue(pa.side, pa.card, pa.selfLoc, pa.remainingKeys || [], pa.autoTarget);
    if (rest.needsTarget) return { ok: true, step: 'target', targetType: rest.targetType, targets: rest.targets };
    return { ok: true, step: 'done' };
  }

  cancelPending() { this.pendingAction = null; }

  // ------------------------------------------------------------- Movement
  moveCreature(row, index, direction) {
    const c = this.rows[row][index];
    if (!c || c.owner !== this.active) return { ok: false, reason: 'Not your creature.' };
    if (c.movedThisTurn) return { ok: false, reason: 'Already moved.' };
    if (c.statuses.fortified) return { ok: false, reason: 'Fortified: cannot move.' };
    if (c.statuses.rooted) return { ok: false, reason: 'Rooted: cannot move.' };

    if (direction === 'left' || direction === 'right') {
      const dest = direction === 'left' ? index - 1 : index + 1;
      if (dest < 0 || dest > 2) return { ok: false, reason: 'Off the battlefield.' };
      if (this.rows[row][dest]) return { ok: false, reason: 'Slot occupied.' };
      this.rows[row][dest] = c; this.rows[row][index] = null;
      c.movedThisTurn = true;
      return { ok: true };
    }

    // Forward/backward walk the owner's path: home row -> middle row ->
    // opponent's home row (and back again).
    const seq = ROW_SEQUENCE[c.owner];
    const at = seq.indexOf(row);
    if (direction === 'forward') {
      if (at >= seq.length - 1) return { ok: false, reason: 'Already fully advanced.' };
      const dest = seq[at + 1];
      if (this.rows[dest][index]) return { ok: false, reason: 'Blocked by a creature.' };
      this.rows[dest][index] = c; this.rows[row][index] = null;
      c.movedThisTurn = true;
      if (at + 1 === seq.length - 1) this.log(`${c.name} advances into enemy territory!`);
      return { ok: true };
    }
    if (direction === 'backward') {
      if (at <= 0) return { ok: false, reason: 'Nowhere to retreat to.' };
      const dest = seq[at - 1];
      if (this.rows[dest][index]) return { ok: false, reason: 'Slot occupied.' };
      this.rows[dest][index] = c; this.rows[row][index] = null;
      c.movedThisTurn = true;
      return { ok: true };
    }
    return { ok: false, reason: 'Unknown direction.' };
  }

  // --------------------------------------------------------------- Combat
  // A creature can fight whatever enemy creature is physically adjacent
  // (one row up or down, same column) regardless of who "should" be there.
  // Only once fully advanced into the opponent's home row, in the CENTER
  // column, with nothing left to fight, can it hit the opponent directly —
  // the side lanes are skirmish-only and never reach the Shields.
  getAdjacentTarget(creature, row, index) {
    for (const nRow of PHYSICAL_NEIGHBORS[row]) {
      const slot = this.rows[nRow][index];
      if (slot && slot.owner !== creature.owner) return { kind: 'creature', row: nRow, index };
    }
    const seq = ROW_SEQUENCE[creature.owner];
    const fullyAdvanced = row === seq[seq.length - 1];
    if (fullyAdvanced && index === CENTER_COLUMN) return { kind: 'direct' };
    return { kind: 'none' };
  }

  attackCreature(row, index) {
    const c = this.rows[row][index];
    if (!c || c.owner !== this.active) return { ok: false, reason: 'Not your creature.' };
    const allowed = c.statuses.multiAttack ? 2 : 1;
    if (c.attacksUsed >= allowed) return { ok: false, reason: 'No attacks left.' };
    if (c.statuses.cannotAttack) return { ok: false, reason: 'Cannot attack this turn.' };
    const target = this.getAdjacentTarget(c, row, index);
    if (target.kind === 'none') return { ok: false, reason: 'No target adjacent.' };
    c.attacksUsed++;
    if (target.kind === 'direct') { this.dealDirectHit(this.other(c.owner)); return { ok: true, direct: true }; }
    this.resolveCombat(row, index, target.row, target.index);
    return { ok: true };
  }

  resolveCombat(aRow, aIndex, dRow, dIndex) {
    const attacker = this.rows[aRow][aIndex];
    const defender = this.rows[dRow][dIndex];
    const aRank = Math.max(1, effectiveRank(attacker) + (attacker.statuses.berserk || 0));
    const dRank = Math.max(1, effectiveRank(defender) + (defender.statuses.enrage || 0));
    this.log(`${attacker.name}(${aRank}) vs ${defender.name}(${dRank})`);

    if (aRank === dRank) {
      this.handleLoss(aRow, aIndex);
      this.handleLoss(dRow, dIndex);
      return;
    }
    const winnerLoc = aRank > dRank ? { row: aRow, index: aIndex } : { row: dRow, index: dIndex };
    const loserLoc = aRank > dRank ? { row: dRow, index: dIndex } : { row: aRow, index: aIndex };
    const loserCard = this.rows[loserLoc.row][loserLoc.index];
    const hadCounter = !!(loserCard && loserCard.statuses.counterattack);
    this.handleLoss(loserLoc.row, loserLoc.index);
    const winnerCard = this.rows[winnerLoc.row][winnerLoc.index];
    if (winnerCard && winnerCard.statuses.lifesteal) this.returnTopDiscardToShield(winnerCard.owner);
    if (hadCounter && this.rows[winnerLoc.row][winnerLoc.index]) this.handleLoss(winnerLoc.row, winnerLoc.index);
  }

  handleLoss(row, index) {
    const c = this.rows[row][index];
    if (!c) return;
    if (c.statuses.regen) { c.statuses.regen = false; this.log(`${c.name} regenerates!`); return; }
    this.destroyCreature(row, index, {});
  }

  forceCombatAgainstAdjacent(casterSide, targetRow, targetIndex) {
    for (const nRow of PHYSICAL_NEIGHBORS[targetRow]) {
      const facing = this.rows[nRow][targetIndex];
      if (facing && facing.owner === casterSide) { this.resolveCombat(nRow, targetIndex, targetRow, targetIndex); return; }
    }
    this.log('Provoke fizzled: no adjacent creature.');
  }

  // ------------------------------------------------------------ Shields
  dealDirectHit(defendingSide) {
    const s = this.sides[defendingSide];
    if (s.shields.length === 0) { this.winner = this.other(defendingSide); this.log(`${defendingSide} takes a direct hit with no Shields left!`); return; }
    const shield = s.shields.pop();
    s.discard.push(shield);
    this.log(`${defendingSide}'s Shield (${shield.name}) is destroyed!`);
    for (const key of shield.abilities) {
      if (key && SHIELD_TRIGGER_SAFE.has(key)) {
        this.log(`Shield Trigger: ${ABILITY_INFO[key].label}!`);
        resolveAbility(key, this, defendingSide, shield, null, null);
      }
    }
  }

  // -------------------------------------------------------- Ability helpers
  drawCards(side, n, silent) {
    const s = this.sides[side];
    for (let i = 0; i < n; i++) {
      if (s.deck.length === 0) { if (s.discard.length === 0) break; s.deck = this.shuffle(s.discard); s.discard = []; }
      if (s.deck.length === 0) break;
      s.hand.push(s.deck.pop());
    }
    if (!silent) this.log(`${side} draws.`);
  }

  gainShields(side, n, silent) {
    const s = this.sides[side];
    for (let i = 0; i < n; i++) {
      if (s.deck.length === 0) { if (s.discard.length === 0) break; s.deck = this.shuffle(s.discard); s.discard = []; }
      if (s.deck.length === 0) break;
      s.shields.push(s.deck.pop());
    }
    if (!silent) this.log(`${side} gains a Shield.`);
  }

  returnTopDiscardToShield(side) {
    const s = this.sides[side];
    if (s.discard.length === 0) return;
    s.shields.push(s.discard.pop());
    this.log(`${side} returns a card from discard to their Shield zone.`);
  }

  shuffleDiscardIntoDeck(side, n) {
    const s = this.sides[side];
    const moved = s.discard.splice(0, Math.min(n, s.discard.length));
    s.deck.push(...moved);
    this.shuffle(s.deck);
  }

  searchDeckForSuitToHand(side, suit) {
    const s = this.sides[side];
    const idx = s.deck.findIndex((c) => c.suit === suit);
    if (idx === -1) { this.log('Search found nothing.'); return; }
    const [card] = s.deck.splice(idx, 1);
    s.hand.push(card);
    this.shuffle(s.deck);
  }

  discardRandomFromHand(side, n) {
    const s = this.sides[side];
    for (let i = 0; i < n && s.hand.length > 0; i++) {
      const idx = Math.floor(Math.random() * s.hand.length);
      s.discard.push(s.hand.splice(idx, 1)[0]);
    }
  }

  duplicateCardToHand(side, card) {
    const def = getCardDef(card.defId);
    if (def) this.sides[side].hand.push(instantiate(def));
  }

  reviveFromDiscardToHand(side, uid) {
    const s = this.sides[side];
    const idx = s.discard.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const card = s.discard.splice(idx, 1)[0];
    card.rankMod = 0; card.tempRankMod = 0; card.statuses = {}; card.equipment = null; card.attacksUsed = 0;
    s.hand.push(card);
  }

  repairEquipmentFromDiscardToHand(side, uid) {
    const s = this.sides[side];
    const idx = s.discard.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    s.hand.push(s.discard.splice(idx, 1)[0]);
  }

  reanimateFromEnemyDiscardToBoard(side, uid) {
    const opp = this.other(side);
    const s = this.sides[opp];
    const idx = s.discard.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const slots = this.emptyHomeSlots(side);
    if (slots.length === 0) { this.log('No room to reanimate.'); return; }
    const [card] = s.discard.splice(idx, 1);
    const live = { ...card, owner: side, movedThisTurn: false, attacksUsed: 0, statuses: {}, rankMod: 0, tempRankMod: 0, equipment: null };
    const slot = slots[0];
    this.rows[slot.row][slot.index] = live;
  }

  gainMana(side, n) { this.sides[side].mana += n; }
  setStatus(row, index, key, value) { const c = this.rows[row][index]; if (c) c.statuses[key] = value; }
  addPermanentRankMod(row, index, amount) { const c = this.rows[row][index]; if (c) c.rankMod = (c.rankMod || 0) + amount; }
  addTempRankBuff(row, index, amount) { const c = this.rows[row][index]; if (c) c.tempRankMod = (c.tempRankMod || 0) + amount; }

  upgradeCreatureRank(row, index) {
    const c = this.rows[row][index];
    if (!c) return;
    const i = RANKS.indexOf(c.rank);
    if (i < RANKS.length - 1) c.rank = RANKS[i + 1];
  }

  destroyEquipment(row, index) {
    const c = this.rows[row][index];
    if (!c || !c.equipment) return;
    this.sides[c.owner].discard.push(c.equipment);
    c.equipment = null;
  }

  destroyCreature(row, index, opts) {
    const c = this.rows[row][index];
    if (!c) return;
    if (c.equipment) { this.sides[c.owner].discard.push(c.equipment); c.equipment = null; }
    (opts.toExile ? this.sides[c.owner].exile : this.sides[c.owner].discard).push(c);
    this.rows[row][index] = null;
    this.log(`${c.name} is destroyed.`);
  }

  sacrificeCreatureDraw(row, index, n) {
    const c = this.rows[row][index];
    if (!c) return;
    const owner = c.owner;
    this.destroyCreature(row, index, {});
    this.drawCards(owner, n);
  }

  createTokenCreature(side) {
    const slots = this.emptyHomeSlots(side);
    if (slots.length === 0) return;
    const tokenDef = { id: 'token_diamond', type: 'creature', name: 'Diamond Golem', suit: 'D', rank: '3', abilities: [], flavor: 'A construct of pure mana.', baseCost: computeBaseCost('3') };
    const live = instantiate(tokenDef);
    live.owner = side; live.movedThisTurn = false; live.attacksUsed = 0;
    const slot = slots[0];
    this.rows[slot.row][slot.index] = live;
  }

  copyCreatureTo(fromRow, fromIndex, toSide) {
    const src = this.rows[fromRow][fromIndex];
    if (!src) return;
    const def = getCardDef(src.defId);
    if (!def) return;
    const slots = this.emptyHomeSlots(toSide);
    if (slots.length === 0) return;
    const live = instantiate(def);
    live.owner = toSide; live.movedThisTurn = false; live.attacksUsed = 0;
    const slot = slots[0];
    this.rows[slot.row][slot.index] = live;
  }

  takeControlOfCreature(row, index, toSide) {
    const c = this.rows[row][index];
    if (!c) return;
    c.owner = toSide;
  }

  setCounterSpell(side) { this.sides[side].counterSpell = true; }

  drainShield(side) {
    const opp = this.other(side);
    const os = this.sides[opp];
    if (os.shields.length > 0) os.discard.push(os.shields.pop());
    this.gainShields(side, 1);
  }

  purifyCreature(row, index) {
    const c = this.rows[row][index];
    if (!c) return;
    c.statuses.poison = 0;
    c.statuses.rooted = false;
    c.statuses.cannotAttack = false;
    c.statuses.silenced = false;
  }

  silenceCreature(row, index) {
    const c = this.rows[row][index];
    if (!c) return;
    c.statuses.silenced = true;
    c.statuses.berserk = 0; c.statuses.enrage = 0;
    c.statuses.multiAttack = false; c.statuses.counterattack = false;
    c.statuses.lifesteal = false; c.statuses.regen = false;
    c.statuses.stealth = false; c.statuses.protected = false; c.statuses.fortified = false;
  }
}
