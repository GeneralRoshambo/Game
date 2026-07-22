// ============================================================================
// ABILITY REGISTRY — every suit-restricted keyword and what it does.
// Resolvers only call the battle engine's public helper methods; they never
// touch the DOM and the engine never hardcodes per-ability logic, which is
// what keeps abilities/engine/UI independently swappable.
//
// Targets are always {kind, row, index} for board slots (row = physical
// position 'top'/'bottom', which can differ from the controlling side once a
// creature has advanced or been stolen) or {kind:'discard', side, uid, card}
// for pile lookups.
//
// Each entry:
//   suit        - which suit may print this ability
//   label       - short UI name
//   targetType  - 'none' | 'ownCreature' | 'enemyCreature' | 'ownDiscardCreature'
//                 | 'enemyDiscardCreature' | 'ownDiscardEquipment' | 'enemyEquipment'
//   desc(card)  - human-readable rules text, scaled to the card's magnitude
//   resolve(engine, side, card, target, selfLoc) - the actual effect;
//     selfLoc is {row, index} for the ability's own card when it's a
//     self-status effect (berserk, regen, ...), else null.
// ============================================================================

import { abilityMagnitude } from './cards.js';

export const ABILITY_INFO = {
  // ---------------------------------------------------------------- Hearts
  heal: {
    suit: 'H', label: 'Heal', targetType: 'none',
    desc: () => 'Return the top card of your discard pile to your Shield zone.',
    resolve: (engine, side) => engine.returnTopDiscardToShield(side),
  },
  shield_grant: {
    suit: 'H', label: 'Shield', targetType: 'none',
    desc: () => 'Gain an extra Shield from the top of your deck.',
    resolve: (engine, side) => engine.gainShields(side, 1),
  },
  revive: {
    suit: 'H', label: 'Revive', targetType: 'ownDiscardCreature',
    desc: () => 'Return a creature from your discard pile to your hand.',
    resolve: (engine, side, card, target) => engine.reviveFromDiscardToHand(side, target.uid),
  },
  regen: {
    suit: 'H', label: 'Regenerate', targetType: 'none',
    desc: () => 'The first time this creature would be destroyed, it survives instead.',
    resolve: (engine, side, card, target, selfLoc) => engine.setStatus(selfLoc.row, selfLoc.index, 'regen', true),
  },
  draw: {
    suit: 'H', label: 'Draw', targetType: 'none',
    desc: (c) => `Draw ${Math.min(2, abilityMagnitude(c))} card(s).`,
    resolve: (engine, side, card) => engine.drawCards(side, Math.min(2, abilityMagnitude(card))),
  },
  bless_buff: {
    suit: 'H', label: 'Bless', targetType: 'ownCreature',
    desc: (c) => `Target creature gains +${abilityMagnitude(c)} rank until end of turn.`,
    resolve: (engine, side, card, target) => engine.addTempRankBuff(target.row, target.index, abilityMagnitude(card)),
  },
  lifesteal: {
    suit: 'H', label: 'Lifesteal', targetType: 'none',
    desc: () => 'Whenever this creature wins combat, you regain a Shield.',
    resolve: (engine, side, card, target, selfLoc) => engine.setStatus(selfLoc.row, selfLoc.index, 'lifesteal', true),
  },
  protect: {
    suit: 'H', label: 'Protect', targetType: 'ownCreature',
    desc: () => 'Target creature cannot be attacked until your next turn.',
    resolve: (engine, side, card, target) => engine.setStatus(target.row, target.index, 'protected', true),
  },
  restore: {
    suit: 'H', label: 'Restore', targetType: 'none',
    desc: () => 'Shuffle up to 3 cards from your discard pile back into your deck.',
    resolve: (engine, side) => engine.shuffleDiscardIntoDeck(side, 3),
  },
  purify: {
    suit: 'H', label: 'Purify', targetType: 'ownCreature',
    desc: () => 'Remove all negative effects from target creature.',
    resolve: (engine, side, card, target) => engine.purifyCreature(target.row, target.index),
  },

  // ----------------------------------------------------------------- Clubs
  poison: {
    suit: 'C', label: 'Poison', targetType: 'enemyCreature',
    desc: (c) => `Target enemy creature is destroyed after ${abilityMagnitude(c) + 1} of its controller's turns.`,
    resolve: (engine, side, card, target) => engine.setStatus(target.row, target.index, 'poison', abilityMagnitude(card) + 1),
  },
  root: {
    suit: 'C', label: 'Root', targetType: 'enemyCreature',
    desc: () => 'Target enemy creature cannot move on its next turn.',
    resolve: (engine, side, card, target) => engine.setStatus(target.row, target.index, 'rooted', true),
  },
  berserk: {
    suit: 'C', label: 'Berserk', targetType: 'none',
    desc: (c) => `This creature gets +${abilityMagnitude(c) + 1} rank while attacking.`,
    resolve: (engine, side, card, target, selfLoc) => engine.setStatus(selfLoc.row, selfLoc.index, 'berserk', abilityMagnitude(card) + 1),
  },
  multi_attack: {
    suit: 'C', label: 'Multi Attack', targetType: 'none',
    desc: () => 'This creature may attack twice per turn.',
    resolve: (engine, side, card, target, selfLoc) => engine.setStatus(selfLoc.row, selfLoc.index, 'multiAttack', true),
  },
  counterattack: {
    suit: 'C', label: 'Counterattack', targetType: 'none',
    desc: () => 'If this creature loses combat, it destroys the attacker too.',
    resolve: (engine, side, card, target, selfLoc) => engine.setStatus(selfLoc.row, selfLoc.index, 'counterattack', true),
  },
  destroy_equipment: {
    suit: 'C', label: 'Sunder', targetType: 'enemyEquipment',
    desc: () => 'Destroy the Equipment attached to target enemy creature.',
    resolve: (engine, side, card, target) => engine.destroyEquipment(target.row, target.index),
  },
  bleed: {
    suit: 'C', label: 'Bleed', targetType: 'enemyCreature',
    desc: (c) => `Target enemy creature loses ${abilityMagnitude(c)} rank for the rest of the battle.`,
    resolve: (engine, side, card, target) => engine.addPermanentRankMod(target.row, target.index, -abilityMagnitude(card)),
  },
  enrage: {
    suit: 'C', label: 'Enrage', targetType: 'none',
    desc: (c) => `This creature gets +${abilityMagnitude(c) + 1} rank while defending.`,
    resolve: (engine, side, card, target, selfLoc) => engine.setStatus(selfLoc.row, selfLoc.index, 'enrage', abilityMagnitude(card) + 1),
  },
  fight_bonus: {
    suit: 'C', label: 'Provoke', targetType: 'enemyCreature',
    desc: () => 'Force target enemy creature into immediate combat with an adjacent creature of yours.',
    resolve: (engine, side, card, target) => engine.forceCombatAgainstAdjacent(side, target.row, target.index),
  },
  exile: {
    suit: 'C', label: 'Exile', targetType: 'enemyCreature',
    desc: () => 'Destroy target enemy creature. It cannot be revived, searched for, or reanimated.',
    resolve: (engine, side, card, target) => engine.destroyCreature(target.row, target.index, { toExile: true }),
  },

  // -------------------------------------------------------------- Diamonds
  search_deck: {
    suit: 'D', label: 'Search', targetType: 'none',
    desc: () => 'Search your deck for a matching-suit card and draw it.',
    resolve: (engine, side, card) => engine.searchDeckForSuitToHand(side, card.suit),
  },
  create_token: {
    suit: 'D', label: 'Construct', targetType: 'none',
    desc: () => 'Create a 3-rank Diamond token creature in an empty slot.',
    resolve: (engine, side) => engine.createTokenCreature(side),
  },
  copy: {
    suit: 'D', label: 'Mirror', targetType: 'ownCreature',
    desc: () => 'Create a copy of target friendly creature in an empty slot.',
    resolve: (engine, side, card, target) => engine.copyCreatureTo(target.row, target.index, side),
  },
  reinforce: {
    suit: 'D', label: 'Reinforce', targetType: 'ownCreature',
    desc: () => 'Target friendly creature gains +1 rank permanently.',
    resolve: (engine, side, card, target) => engine.addPermanentRankMod(target.row, target.index, 1),
  },
  mine_mana: {
    suit: 'D', label: 'Mine', targetType: 'none',
    desc: () => 'Gain 2 extra mana immediately.',
    resolve: (engine, side) => engine.gainMana(side, 2),
  },
  repair: {
    suit: 'D', label: 'Repair', targetType: 'ownDiscardEquipment',
    desc: () => 'Return an Equipment card from your discard pile to your hand.',
    resolve: (engine, side, card, target) => engine.repairEquipmentFromDiscardToHand(side, target.uid),
  },
  stealth: {
    suit: 'D', label: 'Stealth', targetType: 'none',
    desc: () => 'This creature cannot be attacked until it attacks.',
    resolve: (engine, side, card, target, selfLoc) => engine.setStatus(selfLoc.row, selfLoc.index, 'stealth', true),
  },
  fortify: {
    suit: 'D', label: 'Fortify', targetType: 'ownCreature',
    desc: () => 'Target friendly creature cannot be moved.',
    resolve: (engine, side, card, target) => engine.setStatus(target.row, target.index, 'fortified', true),
  },
  upgrade: {
    suit: 'D', label: 'Upgrade', targetType: 'ownCreature',
    desc: () => 'Target friendly creature permanently becomes one rank higher.',
    resolve: (engine, side, card, target) => engine.upgradeCreatureRank(target.row, target.index),
  },
  duplicate: {
    suit: 'D', label: 'Duplicate', targetType: 'none',
    desc: () => 'Put a copy of this card into your hand.',
    resolve: (engine, side, card) => engine.duplicateCardToHand(side, card),
  },

  // ---------------------------------------------------------------- Spades
  destroy: {
    suit: 'S', label: 'Destroy', targetType: 'enemyCreature',
    desc: () => 'Destroy target enemy creature, regardless of rank.',
    resolve: (engine, side, card, target) => engine.destroyCreature(target.row, target.index, {}),
  },
  steal: {
    suit: 'S', label: 'Steal', targetType: 'enemyCreature',
    desc: () => 'Take control of target enemy creature with lower rank than this card.',
    resolve: (engine, side, card, target) => {
      if (engine.rankOf(target.row, target.index) < engine.rankValue(card)) {
        engine.takeControlOfCreature(target.row, target.index, side);
      } else {
        engine.log('Steal fizzled: target rank too high.');
      }
    },
  },
  sacrifice: {
    suit: 'S', label: 'Sacrifice', targetType: 'ownCreature',
    desc: () => 'Destroy a friendly creature to draw 2 cards.',
    resolve: (engine, side, card, target) => engine.sacrificeCreatureDraw(target.row, target.index, 2),
  },
  curse: {
    suit: 'S', label: 'Curse', targetType: 'enemyCreature',
    desc: () => 'Target enemy creature loses 2 rank for the rest of the battle.',
    resolve: (engine, side, card, target) => engine.addPermanentRankMod(target.row, target.index, -2),
  },
  discard: {
    suit: 'S', label: 'Discard', targetType: 'none',
    desc: (c) => `Opponent discards ${abilityMagnitude(c)} random card(s) from hand.`,
    resolve: (engine, side, card) => engine.discardRandomFromHand(engine.other(side), abilityMagnitude(card)),
  },
  counter_spell: {
    suit: 'S', label: 'Counter', targetType: 'none',
    desc: () => "Negate the opponent's next spell.",
    resolve: (engine, side) => engine.setCounterSpell(side),
  },
  silence: {
    suit: 'S', label: 'Silence', targetType: 'enemyCreature',
    desc: () => "Target enemy creature's abilities are disabled for the rest of the battle.",
    resolve: (engine, side, card, target) => engine.silenceCreature(target.row, target.index),
  },
  fear: {
    suit: 'S', label: 'Fear', targetType: 'enemyCreature',
    desc: () => 'Target enemy creature cannot attack on its next turn.',
    resolve: (engine, side, card, target) => engine.setStatus(target.row, target.index, 'cannotAttack', true),
  },
  drain: {
    suit: 'S', label: 'Drain', targetType: 'none',
    desc: () => "Destroy one of the opponent's Shields, then gain a Shield yourself.",
    resolve: (engine, side) => engine.drainShield(side),
  },
  reanimate_enemy: {
    suit: 'S', label: 'Reanimate', targetType: 'enemyDiscardCreature',
    desc: () => "Put a creature from the opponent's discard pile onto your battlefield.",
    resolve: (engine, side, card, target) => engine.reanimateFromEnemyDiscardToBoard(side, target.uid),
  },
};

export function abilityTargetType(key) { return ABILITY_INFO[key]?.targetType || 'none'; }
export function abilityNeedsTarget(key) { return abilityTargetType(key) !== 'none'; }
export function resolveAbility(key, engine, side, card, target, selfLoc) {
  const info = ABILITY_INFO[key];
  if (!info) return;
  info.resolve(engine, side, card, target, selfLoc);
}
