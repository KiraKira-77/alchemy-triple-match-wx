export function getCultivationTitle(exp) {
    if (exp >= 1500) return '结丹宗师';
    if (exp >= 500) return '筑基后期';
    return '炼气一层';
}

export function getPlayerProgressBadge(exp) {
    const safeExp = Number.isFinite(Number(exp)) ? Math.max(0, Math.floor(Number(exp))) : 0;
    return {
        title: getCultivationTitle(safeExp),
        expText: `修为 ${safeExp}`
    };
}

export function getLobbyLevelIds(levelConfigs) {
    return Object.keys(levelConfigs)
        .map(Number)
        .sort((a, b) => a - b);
}

function getChinaDateKey(date = new Date()) {
    const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const year = chinaTime.getUTCFullYear();
    const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(chinaTime.getUTCDate()).padStart(2, '0');
    return Number(`${year}${month}${day}`);
}

export function getEffectiveLevelSeed(level, date = new Date()) {
    if (!level.dailyChallenge) return level.seed;

    const dateKey = getChinaDateKey(date);
    const mixed = Math.imul(level.seed ^ dateKey, 0x45d9f3b);
    return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function getReviveTargetState({ failedState, cardsRemaining, slotsRemaining }) {
    if (failedState === 'REFINING') return 'REFINING';
    if (cardsRemaining === 0 && slotsRemaining === 0) return 'REFINING';
    return 'PLAYING';
}

function toSafeNonNegativeNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, number);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function calculateRefineQualityScore(stats = {}) {
    const stableTime = toSafeNonNegativeNumber(stats.stableTime);
    const coldTime = toSafeNonNegativeNumber(stats.coldTime);
    const hotTime = toSafeNonNegativeNumber(stats.hotTime);
    const measuredTotal = stableTime + coldTime + hotTime;
    const totalTime = Math.max(toSafeNonNegativeNumber(stats.totalTime), measuredTotal);

    if (totalTime <= 0) return 0;

    const stableRatio = stableTime / totalTime;
    const stableBonus = Math.round(stableRatio * 3000);
    const speedBonus = clamp(Math.round((12 - totalTime) * 200), 0, 600);
    const coldPenalty = Math.round(coldTime * 150);
    const hotPenalty = Math.round(hotTime * 400);

    return clamp(stableBonus + speedBonus - coldPenalty - hotPenalty, 0, 3600);
}

export function calculateFinalScore({
    matchScore = 0,
    slotsRemaining = 0,
    stepsRemaining = 0,
    refineStats = {}
} = {}) {
    const baseScore = 10000;
    const completionBonus = 1500;
    const safeSlots = clamp(Math.floor(toSafeNonNegativeNumber(slotsRemaining)), 0, 7);
    const safeSteps = Math.floor(toSafeNonNegativeNumber(stepsRemaining));
    const safeMatchScore = Math.floor(toSafeNonNegativeNumber(matchScore));
    const slotBonus = (7 - safeSlots) * 800;
    const stepBonus = safeSteps * 50;
    const refineBonus = calculateRefineQualityScore(refineStats);

    return baseScore + completionBonus + safeMatchScore + slotBonus + stepBonus + refineBonus;
}
