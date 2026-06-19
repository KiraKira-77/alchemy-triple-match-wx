const cloud = require('wx-server-sdk');
const {
    normalizeScoreSubmission,
    toPublicLeaderboardEntry
} = require('./leaderboard-rules');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
    let submission;
    try {
        submission = normalizeScoreSubmission({
            score: 0,
            levelId: event.levelId,
            nickname: ''
        });
    } catch (err) {
        return { ok: false, code: 'INVALID_BOARD', message: err.message, entries: [] };
    }

    const limit = Math.max(1, Math.min(Number(event.limit) || 50, 100));
    const result = await db.collection('leaderboard_daily')
        .where({ boardKey: submission.boardKey })
        .orderBy('score', 'desc')
        .orderBy('updatedAt', 'asc')
        .limit(limit)
        .get();

    return {
        ok: true,
        boardKey: submission.boardKey,
        entries: result.data.map(toPublicLeaderboardEntry)
    };
};
