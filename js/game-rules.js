export function getCultivationTitle(exp) {
    if (exp >= 1500) return '结丹宗师';
    if (exp >= 500) return '筑基后期';
    return '炼气一层';
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
