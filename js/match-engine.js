// js/match-engine.js

import { getEffectiveLevelSeed } from './game-rules.js';

// Mulberry32 伪随机数生成器 (保证全服挑战种子一致)
export function createRandom(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

// 药材卡牌静态信息
export const HERB_DATABASE = {
    1: { name: '人参', stars: '★★★', png: 'assets/herbs/ginseng.png' },
    2: { name: '灵芝', stars: '★★★★', png: 'assets/herbs/lingzhi.png' },
    3: { name: '当归', stars: '★★', png: 'assets/herbs/danggui.png' },
    4: { name: '枸杞', stars: '★', png: 'assets/herbs/wolfberry.png' },
    5: { name: '雪莲', stars: '★★★★★', png: 'assets/herbs/snow_lotus.png' },
    6: { name: '鹿茸', stars: '★★★★', png: 'assets/herbs/deer_horn.png' },
    7: { name: '冬虫草', stars: '★★★★★', png: 'assets/herbs/caterpillar_fungus.png' },
    8: { name: '何首乌', stars: '★★★', png: 'assets/herbs/heshouwu.png' }
};

// 关卡配置
export const LEVEL_CONFIGS = {
    0: {
        name: '教学关：初试泥炉',
        targetElixir: '筑基丹',
        elixirGrade: '地字下品',
        maxSteps: 30,
        cardTypes: [1, 2, 3],
        totalGroups: 4,      // 12张牌
        maxLayers: 2,
        seed: 888
    },
    1: {
        name: '常驻挑战：青铜炼丹',
        targetElixir: '九转还魂丹',
        elixirGrade: '地字上品',
        maxSteps: 50,
        cardTypes: [1, 2, 3, 4, 6], // 5种
        totalGroups: 15,     // 45张牌
        maxLayers: 3,
        seed: 1234
    },
    2: {
        name: '常驻挑战：火候大成',
        targetElixir: '太乙飞仙丹',
        elixirGrade: '天字下品',
        maxSteps: 80,
        cardTypes: [1, 2, 3, 4, 5, 6, 8],
        totalGroups: 26,     // 78张牌
        maxLayers: 5,
        seed: 5678
    },
    3: {
        name: '每日挑战：全服九转炉',
        targetElixir: '九转金丹',
        elixirGrade: '天字上品',
        maxSteps: 110,
        cardTypes: [1, 2, 3, 4, 5, 6, 7, 8],
        totalGroups: 36,     // 108张牌
        maxLayers: 6,
        seed: 9999,
        dailyChallenge: true
    }
};

export class MatchEngine {
    constructor(levelId, options = {}) {
        this.levelId = levelId;
        this.level = LEVEL_CONFIGS[levelId];
        this.levelSeed = getEffectiveLevelSeed(this.level, options.challengeDate);
        this.cards = [];
        this.slots = [];
        this.steps = this.level.maxSteps;
        this.score = 0;
        this.history = [];
        this.currentCombo = 0;
        this.maxCombo = 0;

        // 各种道具使用计数
        this.reviveCount = 0;
        this.hintCount = 0;
        this.shuffleCount = 0;
        this.undoCount = 0;

        this.generateLevelCards();
    }

    generateLevelCards() {
        this.cards = [];
        const prng = createRandom(this.levelSeed);
        const cardTypes = this.level.levelId === 0 ? [1, 2, 3] : this.level.cardTypes;
        
        const totalCards = this.level.totalGroups * 3;
        const cardPool = [];
        for (let i = 0; i < this.level.totalGroups; i++) {
            const type = cardTypes[Math.floor(prng() * cardTypes.length)];
            cardPool.push(type, type, type);
        }
        
        // 洗牌
        for (let i = cardPool.length - 1; i > 0; i--) {
            const j = Math.floor(prng() * (i + 1));
            [cardPool[i], cardPool[j]] = [cardPool[j], cardPool[i]];
        }
        
        const cardW = 54;
        const cardH = 70;
        // 小游戏模拟虚拟宽度 360 x 500
        const containerW = 360;
        const containerH = 340;
        
        let poolIndex = 0;
        
        for (let layer = 0; layer < this.level.maxLayers; layer++) {
            const rowCount = 5 - Math.min(2, layer); 
            const colCount = 5 - Math.min(2, layer);
            const xSpacing = 58;
            const ySpacing = 68;
            
            const xOffset = (containerW - (rowCount - 1) * xSpacing - cardW) / 2;
            const yOffset = (containerH - (colCount - 1) * ySpacing - cardH) / 2;

            for (let r = 0; r < rowCount; r++) {
                for (let c = 0; c < colCount; c++) {
                    if (poolIndex >= totalCards) break;
                    
                    const jitterX = (prng() - 0.5) * 8;
                    const jitterY = (prng() - 0.5) * 8;
                    
                    const posX = xOffset + r * xSpacing + jitterX;
                    const posY = yOffset + c * ySpacing + jitterY;
                    
                    this.cards.push({
                        id: `card_${poolIndex}`,
                        typeId: cardPool[poolIndex],
                        x: Math.max(10, Math.min(posX, containerW - cardW - 10)),
                        y: Math.max(10, Math.min(posY, containerH - cardH - 10)),
                        level: layer,
                        isBlocked: false
                    });
                    poolIndex++;
                }
            }
        }

        while (poolIndex < totalCards) {
            const posX = containerW / 2 + (prng() - 0.5) * 100 - cardW / 2;
            const posY = containerH / 2 + (prng() - 0.5) * 100 - cardH / 2;
            this.cards.push({
                id: `card_${poolIndex}`,
                typeId: cardPool[poolIndex],
                x: posX,
                y: posY,
                level: 0,
                isBlocked: false
            });
            poolIndex++;
        }

        this.refreshBlockedStatus();
    }

    refreshBlockedStatus() {
        const cardW = 54;
        const cardH = 70;
        
        for (let i = 0; i < this.cards.length; i++) {
            const cardA = this.cards[i];
            cardA.isBlocked = false;
            
            for (let j = 0; j < this.cards.length; j++) {
                const cardB = this.cards[j];
                if (cardA.id === cardB.id) continue;
                
                if (cardB.level > cardA.level) {
                    const xOverlap = Math.abs(cardA.x - cardB.x) < cardW - 5;
                    const yOverlap = Math.abs(cardA.y - cardB.y) < cardH - 6;
                    if (xOverlap && yOverlap) {
                        cardA.isBlocked = true;
                        break;
                    }
                }
            }
        }
    }

    // 辅助历史状态保存 (撤回用)
    saveHistorySnapshot() {
        this.history.push({
            cards: JSON.parse(JSON.stringify(this.cards)),
            slots: JSON.parse(JSON.stringify(this.slots)),
            steps: this.steps,
            score: this.score
        });
    }

    // 撤回
    undo() {
        if (this.history.length === 0) return false;
        this.undoCount++;
        const prev = this.history.pop();
        this.cards = prev.cards;
        this.slots = prev.slots;
        this.steps = prev.steps;
        this.score = prev.score;
        this.refreshBlockedStatus();
        return true;
    }

    // 提示 (寻找可以点击飞入并消除的匹配组)
    getHintCardId() {
        this.hintCount++;
        let targetTypeId = -1;
        
        if (this.slots.length > 0) {
            for (let card of this.slots) {
                if (this.cards.some(c => c.typeId === card.typeId && !c.isBlocked)) {
                    targetTypeId = card.typeId;
                    break;
                }
            }
        }
        
        if (targetTypeId === -1) {
            const visible = this.cards.filter(c => !c.isBlocked);
            const counts = {};
            visible.forEach(c => counts[c.typeId] = (counts[c.typeId] || 0) + 1);
            for (let type in counts) {
                if (counts[type] >= 2) targetTypeId = parseInt(type);
            }
            if (targetTypeId === -1 && visible.length > 0) {
                targetTypeId = visible[0].typeId;
            }
        }

        return targetTypeId;
    }

    // 洗牌
    shuffle() {
        if (this.cards.length === 0) return;
        this.shuffleCount++;
        const pool = this.cards.map(c => c.typeId);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        this.cards.forEach((c, idx) => {
            c.typeId = pool[idx];
        });
        this.refreshBlockedStatus();
    }

    // 广告复活 (恢复2个槽位，加10步火力)
    revive() {
        this.reviveCount++;
        if (this.slots.length >= 2) {
            const popCards = this.slots.splice(this.slots.length - 2, 2);
            popCards.forEach((c, idx) => {
                c.level += 1;
                c.x += (idx === 0 ? -30 : 30);
                this.cards.push(c);
            });
        }
        this.steps += 10;
        this.refreshBlockedStatus();
    }

    findSlotInsertIndex(typeId) {
        let index = this.slots.length;
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i].typeId === typeId) {
                index = i + 1;
            }
        }
        return index;
    }

    checkMatchThree(typeId) {
        const matches = this.slots.filter(card => card.typeId === typeId);
        if (matches.length >= 3) {
            let removeCount = 0;
            this.slots = this.slots.filter(card => {
                if (card.typeId === typeId && removeCount < 3) {
                    removeCount++;
                    return false;
                }
                return true;
            });
            this.currentCombo++;
            this.maxCombo = Math.max(this.maxCombo, this.currentCombo);
            const comboBonus = (this.currentCombo - 1) * 200;
            this.score += 1000 + comboBonus;
            return true;
        } else {
            this.currentCombo = 0;
            return false;
        }
    }
}
