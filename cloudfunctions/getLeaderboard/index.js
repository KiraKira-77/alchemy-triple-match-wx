const cloud = require('wx-server-sdk');
const {
    normalizeScoreSubmission,
    toPublicLeaderboardEntry,
    isCollectionMissingError,
    isCollectionExistsError
} = require('./leaderboard-rules');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const LEADERBOARD_COLLECTION = 'leaderboard_daily';
let leaderboardCollectionReady = false;

async function ensureLeaderboardCollection() {
    if (leaderboardCollectionReady) return;
    if (typeof db.createCollection !== 'function') return;

    try {
        await db.createCollection(LEADERBOARD_COLLECTION);
    } catch (err) {
        if (!isCollectionExistsError(err)) throw err;
    }

    leaderboardCollectionReady = true;
}

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
    let result;

    try {
        await ensureLeaderboardCollection();
        result = await db.collection(LEADERBOARD_COLLECTION)
            .where({ boardKey: submission.boardKey })
            .orderBy('score', 'desc')
            .orderBy('updatedAt', 'asc')
            .limit(limit)
            .get();
    } catch (err) {
        if (isCollectionMissingError(err)) {
            return {
                ok: false,
                code: 'LEADERBOARD_COLLECTION_MISSING',
                message: 'leaderboard_daily collection is missing',
                entries: []
            };
        }
        throw err;
    }

    return {
        ok: true,
        boardKey: submission.boardKey,
        entries: result.data.map(toPublicLeaderboardEntry)
    };
};
