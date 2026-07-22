// ============================================================================
// AI OPPONENT — simple rule-based decision-making for the 'enemy' side.
// Only calls the same public engine methods the UI calls for a human player,
// so the AI can be swapped out or made smarter without touching the engine.
// ============================================================================

const AGGRESSIVE_TARGET_KEYS = new Set(['destroy', 'curse', 'silence', 'poison', 'bleed', 'exile', 'fear', 'root', 'destroy_equipment', 'fight_bonus']);

function pickTarget(engine, side, targetType, key) {
  const targets = engine.getValidTargets(side, targetType);
  if (targets.length === 0) return null;
  if (targetType === 'enemyCreature' && key === 'steal') {
    // Steal needs a target weaker than the caster; just try the weakest.
    return targets.slice().sort((a, b) => engine.rankOf(a.row, a.index) - engine.rankOf(b.row, b.index))[0];
  }
  if (targetType === 'enemyCreature' && AGGRESSIVE_TARGET_KEYS.has(key)) {
    return targets.slice().sort((a, b) => engine.rankOf(b.row, b.index) - engine.rankOf(a.row, a.index))[0];
  }
  if (targetType === 'ownCreature') {
    return targets.slice().sort((a, b) => engine.rankOf(a.row, a.index) - engine.rankOf(b.row, b.index))[0];
  }
  if (targetType === 'ownDiscardCreature' || targetType === 'enemyDiscardCreature') {
    return targets.slice().sort((a, b) => engine.rankValue(b.card) - engine.rankValue(a.card))[0];
  }
  return targets[0];
}

function tryPlayHand(engine) {
  const side = 'enemy';
  let guard = 0;
  // Loop because playing a card changes hand indices; keep retrying until
  // nothing more is affordable/placeable.
  while (guard++ < 20) {
    const hand = engine.sides[side].hand;
    let played = false;
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const result = engine.requestPlayCard(side, i);
      if (!result.ok) continue;
      if (result.step === 'place') {
        const slot = result.slots[0];
        const placeResult = engine.provideSlot(slot.row, slot.index);
        if (placeResult.ok && placeResult.step === 'target') {
          const target = pickTarget(engine, side, placeResult.targetType, card.abilities[0]);
          if (target) engine.provideTarget(target);
          else engine.cancelPending();
        }
        played = true;
        break;
      }
      if (result.step === 'target') {
        const target = pickTarget(engine, side, result.targetType, card.abilities[0]);
        if (target) engine.provideTarget(target);
        else engine.cancelPending();
        played = true;
        break;
      }
      // step === 'done' (spell with no target, or countered) already resolved.
      played = true;
      break;
    }
    if (!played) break;
  }
}

function tryMove(engine) {
  const side = 'enemy';
  for (const { row, index, creature } of engine.ownedCreatures(side)) {
    if (creature.movedThisTurn || creature.statuses.fortified || creature.statuses.rooted) continue;
    const target = engine.getAdjacentTarget(creature, row, index);
    if (target.kind === 'creature') continue; // already has something to fight
    if (target.kind === 'direct') continue; // already invading, no need to move again
    // No target: try to move forward to threaten shields directly.
    engine.moveCreature(row, index, 'forward');
  }
}

function tryAttack(engine) {
  const side = 'enemy';
  for (const { row, index, creature } of engine.ownedCreatures(side)) {
    const allowed = creature.statuses.multiAttack ? 2 : 1;
    while (creature.attacksUsed < allowed && !creature.statuses.cannotAttack) {
      const target = engine.getAdjacentTarget(creature, row, index);
      if (target.kind === 'none') break;
      if (target.kind === 'direct') { engine.attackCreature(row, index); continue; }
      const myRank = engine.rankOf(row, index) + (creature.statuses.berserk || 0);
      const theirs = engine.rows[target.row][target.index];
      const theirRank = engine.rankOf(target.row, target.index) + (theirs.statuses.enrage || 0);
      if (myRank >= theirRank) engine.attackCreature(row, index);
      else break;
    }
  }
}

export function runAITurn(engine) {
  tryPlayHand(engine);
  tryMove(engine);
  tryAttack(engine);
  tryPlayHand(engine); // leftover mana after combat tricks, if any
}
