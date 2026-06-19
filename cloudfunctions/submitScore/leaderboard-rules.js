const MAX_SCORE = 200000;
const VALID_LEVEL_IDS = new Set([0, 1, 2, 3]);

function getChinaDateKey(date = new Date()) {
    const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const year = chinaTime.getUTCFullYear();
    const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(chinaTime.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

function normalizeNickname(nickname) {
    const value = String(nickname || '').trim();
    if (!value) return '';
    return value.slice(0, 8);
}

function getAnonymousNickname(openid = '') {
    const suffix = String(openid).slice(-4).toUpperCase() || '0000';
    return `丹师${suffix}`;
}

function normalizeScoreSubmission(input = {}, date = new Date(), openid = '') {
    const score = Number(input.score);
    const levelId = Number(input.levelId);

    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
        throw new Error('invalid score');
    }

    if (!Number.isInteger(levelId) || !VALID_LEVEL_IDS.has(levelId)) {
        throw new Error('invalid level');
    }

    const dateKey = getChinaDateKey(date);
    const nickname = normalizeNickname(input.nickname) || getAnonymousNickname(openid);

    return {
        score,
        levelId,
        dateKey,
        nickname,
        boardKey: `daily:${dateKey}:${levelId}`
    };
}

function shouldReplaceScore(existing, nextScore) {
    if (!existing) return true;
    return Number(nextScore) > Number(existing.score || 0);
}

function toPublicLeaderboardEntry(record, index) {
    return {
        rank: index + 1,
        nickname: record.nickname,
        score: record.score
    };
}

function getErrorText(err) {
    return [
        err && err.errCode,
        err && err.errcode,
        err && err.code,
        err && err.message,
        err && err.errMsg,
        err && String(err)
    ].filter(Boolean).join(' ');
}

function isCollectionMissingError(err) {
    const text = getErrorText(err).toLowerCase();
    return text.includes('-502005')
        || text.includes('database_collection_not_exist')
        || text.includes('collection not exist')
        || text.includes('collection not exists');
}

function isCollectionExistsError(err) {
    const text = getErrorText(err).toLowerCase();
    return text.includes('-502001')
        || text.includes('already exist')
        || text.includes('already exists')
        || text.includes('collection exist');
}

module.exports = {
    getChinaDateKey,
    normalizeScoreSubmission,
    shouldReplaceScore,
    toPublicLeaderboardEntry,
    isCollectionMissingError,
    isCollectionExistsError,
    MAX_SCORE
};
