import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    getChinaDateKey,
    normalizeScoreSubmission,
    shouldReplaceScore,
    toPublicLeaderboardEntry
} = require('../cloudfunctions/submitScore/leaderboard-rules.js');

test('date key uses China calendar day', () => {
    assert.equal(getChinaDateKey(new Date('2026-06-19T15:59:59.000Z')), '20260619');
    assert.equal(getChinaDateKey(new Date('2026-06-19T16:00:00.000Z')), '20260620');
});

test('score submission keeps only safe leaderboard fields', () => {
    const result = normalizeScoreSubmission({
        score: 12345,
        levelId: 3,
        nickname: '  超长超长超长超长超长超长  ',
        extra: 'ignored'
    }, new Date('2026-06-19T12:00:00+08:00'));

    assert.deepEqual(result, {
        score: 12345,
        levelId: 3,
        dateKey: '20260619',
        nickname: '超长超长超长超长',
        boardKey: 'daily:20260619:3'
    });
});

test('invalid score submissions are rejected', () => {
    assert.throws(() => normalizeScoreSubmission({ score: -1, levelId: 3 }), /invalid score/);
    assert.throws(() => normalizeScoreSubmission({ score: 9999999, levelId: 3 }), /invalid score/);
    assert.throws(() => normalizeScoreSubmission({ score: 100, levelId: 99 }), /invalid level/);
});

test('higher score replaces existing score', () => {
    assert.equal(shouldReplaceScore(null, 100), true);
    assert.equal(shouldReplaceScore({ score: 100 }, 100), false);
    assert.equal(shouldReplaceScore({ score: 100 }, 101), true);
});

test('public entry does not expose openid or document internals', () => {
    const entry = toPublicLeaderboardEntry({
        _id: 'openid:daily:20260619:3',
        openid: 'secret-openid',
        nickname: '丹师A1B2',
        score: 800,
        updatedAt: new Date('2026-06-19T12:00:00Z')
    }, 0);

    assert.deepEqual(entry, {
        rank: 1,
        nickname: '丹师A1B2',
        score: 800
    });
});

test('cloud function rule copies stay in sync', () => {
    const submit = readFileSync('cloudfunctions/submitScore/leaderboard-rules.js', 'utf8');
    const query = readFileSync('cloudfunctions/getLeaderboard/leaderboard-rules.js', 'utf8');

    assert.equal(query, submit);
});
