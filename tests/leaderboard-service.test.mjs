import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCloudErrorCode, getLeaderboardFailureText } from '../js/leaderboard-service.js';

test('cloud errors identify missing functions and collections', () => {
    assert.equal(
        normalizeCloudErrorCode(new Error('cloud.callFunction:fail Error: errCode: -501000 FunctionName not found')),
        'FUNCTION_MISSING'
    );
    assert.equal(
        normalizeCloudErrorCode(new Error('DATABASE_COLLECTION_NOT_EXIST: collection not exists')),
        'LEADERBOARD_COLLECTION_MISSING'
    );
    assert.equal(
        normalizeCloudErrorCode(new Error('network timeout')),
        'CLOUD_CALL_FAILED'
    );
});

test('leaderboard failure text points to the missing setup step', () => {
    assert.equal(
        getLeaderboardFailureText('FUNCTION_MISSING', 'load'),
        '云函数未部署，无法读取全服丹榜'
    );
    assert.equal(
        getLeaderboardFailureText('LEADERBOARD_COLLECTION_MISSING', 'submit'),
        '排行榜集合未创建，成绩未入榜'
    );
    assert.equal(
        getLeaderboardFailureText('CLOUD_CALL_FAILED', 'submit'),
        '成绩同步失败'
    );
});
