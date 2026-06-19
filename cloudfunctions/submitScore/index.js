const cloud = require('wx-server-sdk');
const {
    normalizeScoreSubmission,
    shouldReplaceScore,
    toPublicLeaderboardEntry,
    isCollectionMissingError,
    isCollectionExistsError
} = require('./leaderboard-rules');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const LEADERBOARD_COLLECTION = 'leaderboard_daily';
const leaderboard = db.collection(LEADERBOARD_COLLECTION);
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

exports.main = async (event) => {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) {
        return { ok: false, code: 'NO_OPENID' };
    }

    let submission;
    try {
        submission = normalizeScoreSubmission(event, new Date(), OPENID);
    } catch (err) {
        return { ok: false, code: 'INVALID_SUBMISSION', message: err.message };
    }

    const docId = `${OPENID}:${submission.boardKey}`;
    try {
        await ensureLeaderboardCollection();

        const existingResult = await leaderboard.doc(docId).get().catch((err) => {
            if (isCollectionMissingError(err)) return null;
            throw err;
        });
        const existing = existingResult && existingResult.data;

        if (!shouldReplaceScore(existing, submission.score)) {
            return {
                ok: true,
                updated: false,
                entry: toPublicLeaderboardEntry(existing, 0)
            };
        }

        const data = {
            openid: OPENID,
            boardKey: submission.boardKey,
            dateKey: submission.dateKey,
            levelId: submission.levelId,
            nickname: submission.nickname,
            score: submission.score,
            updatedAt: db.serverDate()
        };

        if (existing) {
            await leaderboard.doc(docId).update({ data });
        } else {
            await leaderboard.doc(docId).set({ data });
        }

        return {
            ok: true,
            updated: true,
            entry: {
                nickname: data.nickname,
                score: data.score
            }
        };
    } catch (err) {
        if (isCollectionMissingError(err)) {
            return {
                ok: false,
                code: 'LEADERBOARD_COLLECTION_MISSING',
                message: 'leaderboard_daily collection is missing'
            };
        }
        throw err;
    }
};
