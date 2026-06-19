const cloud = require('wx-server-sdk');
const {
    normalizeScoreSubmission,
    shouldReplaceScore,
    toPublicLeaderboardEntry
} = require('./leaderboard-rules');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const leaderboard = db.collection('leaderboard_daily');

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
    const existingResult = await leaderboard.doc(docId).get().catch(() => null);
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
};
