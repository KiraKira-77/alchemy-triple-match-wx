import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getCultivationTitle,
    getPlayerProgressBadge,
    getLobbyLevelIds,
    getEffectiveLevelSeed,
    getReviveTargetState,
    calculateRefineQualityScore,
    calculateFinalScore
} from '../js/game-rules.js';
import { LEVEL_CONFIGS } from '../js/match-engine.js';

test('cultivation title uses the highest matching threshold', () => {
    assert.equal(getCultivationTitle(0), '炼气一层');
    assert.equal(getCultivationTitle(500), '筑基后期');
    assert.equal(getCultivationTitle(1500), '结丹宗师');
});

test('player progress badge is derived from real experience', () => {
    assert.deepEqual(getPlayerProgressBadge(520), {
        title: '筑基后期',
        expText: '修为 520'
    });
});

test('lobby exposes every configured level in order', () => {
    assert.deepEqual(getLobbyLevelIds(LEVEL_CONFIGS), [0, 1, 2, 3]);
});

test('daily challenge seed changes by date and stays stable within the day', () => {
    const level = LEVEL_CONFIGS[3];
    const seedA = getEffectiveLevelSeed(level, new Date('2026-06-19T00:00:00+08:00'));
    const seedB = getEffectiveLevelSeed(level, new Date('2026-06-19T23:59:59+08:00'));
    const seedC = getEffectiveLevelSeed(level, new Date('2026-06-20T00:00:00+08:00'));

    assert.equal(seedA, seedB);
    assert.notEqual(seedA, seedC);
});

test('revive after refining failure returns to refining instead of an empty board', () => {
    assert.equal(getReviveTargetState({
        failedState: 'REFINING',
        cardsRemaining: 0,
        slotsRemaining: 0
    }), 'REFINING');
});

test('revive during match play returns to match play', () => {
    assert.equal(getReviveTargetState({
        failedState: 'PLAYING',
        cardsRemaining: 12,
        slotsRemaining: 7
    }), 'PLAYING');
});

test('refine quality rewards stable temperature control', () => {
    const stable = calculateRefineQualityScore({
        stableTime: 8,
        coldTime: 1,
        hotTime: 0,
        totalTime: 9
    });

    const unstable = calculateRefineQualityScore({
        stableTime: 4,
        coldTime: 3,
        hotTime: 2,
        totalTime: 9
    });

    assert.ok(stable > unstable);
    assert.equal(stable, 3117);
    assert.equal(unstable, 683);
});

test('final score includes match score and refine quality', () => {
    const score = calculateFinalScore({
        matchScore: 4600,
        slotsRemaining: 1,
        stepsRemaining: 12,
        refineStats: {
            stableTime: 8,
            coldTime: 1,
            hotTime: 0,
            totalTime: 9
        }
    });

    assert.equal(score, 24617);
});
