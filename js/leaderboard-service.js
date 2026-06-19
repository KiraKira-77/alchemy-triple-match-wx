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

        const result = await this.wx.cloud.callFunction({
            name: 'submitScore',
            data: { score, levelId, nickname }
        });

        return result.result;
    }

    async getDailyLeaderboard({ levelId, limit = 50 }) {
        if (!this.available) {
            return { ok: false, code: 'CLOUD_UNAVAILABLE', entries: [] };
        }

        const result = await this.wx.cloud.callFunction({
            name: 'getLeaderboard',
            data: { levelId, limit }
        });

        return result.result;
    }
}
