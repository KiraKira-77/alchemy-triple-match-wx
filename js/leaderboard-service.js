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

export function normalizeCloudErrorCode(err) {
    const text = getErrorText(err).toLowerCase();
    if (text.includes('functionname not found')
        || text.includes('function not found')
        || text.includes('function_name_not_found')
        || text.includes('cloud_function_not_found')) {
        return 'FUNCTION_MISSING';
    }
    if (text.includes('database_collection_not_exist')
        || text.includes('collection not exist')
        || text.includes('collection not exists')) {
        return 'LEADERBOARD_COLLECTION_MISSING';
    }
    return 'CLOUD_CALL_FAILED';
}

export function getLeaderboardFailureText(code, action = 'load') {
    if (code === 'FUNCTION_MISSING') {
        return action === 'submit' ? '云函数未部署，成绩未入榜' : '云函数未部署，无法读取全服丹榜';
    }
    if (code === 'LEADERBOARD_COLLECTION_MISSING') {
        return action === 'submit' ? '排行榜集合未创建，成绩未入榜' : '排行榜集合未创建，无法读取全服丹榜';
    }
    if (code === 'CLOUD_UNAVAILABLE') {
        return action === 'submit' ? '云开发未配置，成绩未入榜' : '云开发未配置，无法读取全服丹榜';
    }
    return action === 'submit' ? '成绩同步失败' : '全服丹榜读取失败';
}

export class LeaderboardService {
    constructor(wxApi, envId = '') {
        this.wx = wxApi;
        this.available = false;

        if (!this.wx || !this.wx.cloud) return;

        try {
            const initOptions = envId ? { env: envId, traceUser: true } : { traceUser: true };
            this.wx.cloud.init(initOptions);
            this.available = true;
        } catch (err) {
            console.warn('云开发初始化失败:', err);
        }
    }

    isAvailable() {
        return this.available;
    }

    async submitScore({ score, levelId, nickname }) {
        if (!this.available) {
            return { ok: false, code: 'CLOUD_UNAVAILABLE' };
        }

        try {
            const result = await this.wx.cloud.callFunction({
                name: 'submitScore',
                data: { score, levelId, nickname }
            });

            return result.result;
        } catch (err) {
            return { ok: false, code: normalizeCloudErrorCode(err), message: getErrorText(err) };
        }
    }

    async getDailyLeaderboard({ levelId, limit = 50 }) {
        if (!this.available) {
            return { ok: false, code: 'CLOUD_UNAVAILABLE', entries: [] };
        }

        try {
            const result = await this.wx.cloud.callFunction({
                name: 'getLeaderboard',
                data: { levelId, limit }
            });

            return result.result;
        } catch (err) {
            return { ok: false, code: normalizeCloudErrorCode(err), message: getErrorText(err), entries: [] };
        }
    }
}
