// js/main.js
import { MatchEngine, HERB_DATABASE, LEVEL_CONFIGS } from './match-engine.js';
import { RefinePhysics } from './refine-physics.js';
import { getCultivationTitle, getPlayerProgressBadge, getLobbyLevelIds, getReviveTargetState, calculateFinalScore } from './game-rules.js';
import { LeaderboardService, getLeaderboardFailureText } from './leaderboard-service.js';

// --- 1. 微信原生小游戏组件系统 ---
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

wx.onError((err) => {
    console.error("小游戏运行错误:", err);
    try {
        const safeDpr = (typeof sysInfo !== 'undefined' ? sysInfo.pixelRatio : 2) || 2;
        ctx.fillStyle = '#ff5252';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = `${12 * safeDpr}px monospace`;
        ctx.textAlign = 'left';
        const errStr = err.stack || err.message || String(err);
        const words = errStr.split('\n');
        let y = 30 * safeDpr;
        words.forEach(line => {
            for (let i = 0; i < line.length; i += 35) {
                ctx.fillText(line.substring(i, i + 35), 10 * safeDpr, y);
                y += 18 * safeDpr;
            }
        });
    } catch(e) {
        console.error("渲染错误失败:", e);
    }
});

const sysInfo = wx.getSystemInfoSync();
const dpr = sysInfo.pixelRatio || 1;

canvas.width = sysInfo.windowWidth * dpr;
canvas.height = sysInfo.windowHeight * dpr;

console.log(`[Init] Canvas dimensions: ${canvas.width}x${canvas.height}, Screen size: ${sysInfo.windowWidth}x${sysInfo.windowHeight}, DPR: ${dpr}`);

// 设计基准尺寸 (以 375x667 为标准，自动按比例缩放适配不同全面屏)
const designWidth = 375;
const designHeight = 667;
const scaleX = canvas.width / designWidth;
const scaleY = canvas.height / designHeight;

const ASSETS_TO_LOAD = {
    cauldron: 'assets/cauldron.png',
    thermometer: 'assets/thermometer.png',
    scroll: 'assets/scroll.png',
    slot_frame: 'assets/slot_frame.png',
    ginseng: 'assets/herbs/ginseng.png',
    lingzhi: 'assets/herbs/lingzhi.png',
    danggui: 'assets/herbs/danggui.png',
    wolfberry: 'assets/herbs/wolfberry.png',
    snow_lotus: 'assets/herbs/snow_lotus.png',
    deer_horn: 'assets/herbs/deer_horn.png',
    caterpillar_fungus: 'assets/herbs/caterpillar_fungus.png',
    heshouwu: 'assets/herbs/heshouwu.png',
    
    // UI 美术强化资产
    cave_bg: 'assets/cave_bg.jpg',
    card_bg: 'assets/card_bg.png',
    card_locked_bg: 'assets/card_locked_bg.png',
    scroll_paper_bg: 'assets/scroll_paper_bg.jpg',
    elixir_zhujidan: 'assets/elixirs/zhujidan.png',
    elixir_huanhundan: 'assets/elixirs/huanhundan.png',
    elixir_feixiandan: 'assets/elixirs/feixiandan.png',
    elixir_jindan: 'assets/elixirs/jindan.png'
};

const REVIVE_AD_UNIT_ID = '';
const CLOUD_ENV_ID = 'cloud1-d8g0evrmw5ed97fc1';
const DAILY_LEADERBOARD_LEVEL_ID = 3;

class AudioManager {
    constructor() {
        this.bgm = null;
        this.currentScene = null;
        this.bgmPaths = {
            LOBBY: 'assets/audio/bgm_lobby.mp3',
            PLAYING: 'assets/audio/bgm_playing.mp3',
            REFINING: 'assets/audio/bgm_refining.mp3',
            VICTORY: 'assets/audio/bgm_lobby.mp3',
            FAIL: 'assets/audio/bgm_playing.mp3'
        };
    }

    playBGM(scene) {
        if (this.currentScene === scene) return;
        this.currentScene = scene;

        if (this.bgm) {
            try { this.bgm.stop(); } catch(e){}
            try { this.bgm.destroy(); } catch(e){}
            this.bgm = null;
        }

        const path = this.bgmPaths[scene];
        if (!path) return;

        console.log(`[Audio] Switching BGM to: ${scene} (${path})`);
        try {
            this.bgm = wx.createInnerAudioContext();
            this.bgm.src = path;
            this.bgm.loop = (scene === 'LOBBY' || scene === 'PLAYING' || scene === 'REFINING');
            this.bgm.autoplay = true;
            this.bgm.play();
            
            this.bgm.onError((res) => {
                console.warn(`[Audio] BGM play failed for scene ${scene}:`, res.errMsg);
            });
        } catch(e) {
            console.error(`[Audio] Failed to create inner audio context:`, e);
        }
    }

    stopBGM() {
        if (this.bgm) {
            try { this.bgm.stop(); } catch(e){}
            try { this.bgm.destroy(); } catch(e){}
            this.bgm = null;
            this.currentScene = null;
        }
    }
}

class MainGame {
    constructor() {
        this.gameState = 'LOBBY'; // LOBBY, PLAYING, REFINING, FAIL, VICTORY, POSTER, LEADERBOARD
        this.loadedImages = {};
        this.currentLevelId = 0;
        
        this.engine = null;
        this.physics = null;
        this.isPreloaded = false;
        
        this.hintTypeId = -1;
        
        // 游戏点击区域热区绑定 (x, y, w, h, callback)
        this.touchZones = [];
        this.tempInputLastY = 0;
        this.isDraggingTemp = false;
        this.exp = parseInt(wx.getStorageSync('liandan_exp')) || 0;
        this.loadingProgress = 0;
        this.lastFailedState = null;
        this.leaderboard = new LeaderboardService(wx, CLOUD_ENV_ID);
        this.leaderboardEntries = [];
        this.leaderboardStatus = '排行榜未加载';
        this.leaderboardLoading = false;
        this.lastLeaderboardSubmitStatus = '';

        // BGM 播放器初始化
        this.audio = new AudioManager();

        this.preloadAssets();
    }

    preloadAssets() {
        console.log('开始预加载小游戏美术资产...');
        this.drawLoadingScreen(); // 立即绘制首帧，避免黑屏
        
        let loaded = 0;
        const keys = Object.keys(ASSETS_TO_LOAD);
        
        keys.forEach(key => {
            const img = wx.createImage();
            
            let alreadyIncremented = false;
            const handleLoad = () => {
                if (alreadyIncremented) return;
                alreadyIncremented = true;
                console.log(`资产加载成功: ${key} -> ${ASSETS_TO_LOAD[key]}`);
                this.loadedImages[key] = img;
                loaded++;
                this.loadingProgress = loaded / keys.length;
                this.drawLoadingScreen();
                if (loaded === keys.length) {
                    console.log('所有美术资产加载完毕，进入大厅！');
                    this.isPreloaded = true;
                    this.audio.playBGM('LOBBY');
                    this.initGameLoop();
                }
            };
            
            const handleError = (err) => {
                if (alreadyIncremented) return;
                alreadyIncremented = true;
                console.error(`资产加载失败!!! 键名: ${key}, 路径: ${ASSETS_TO_LOAD[key]}`, err);
                loaded++;
                this.loadingProgress = loaded / keys.length;
                this.drawLoadingScreen();
                if (loaded === keys.length) {
                    console.log('美术资产加载完毕（含失败项），强行进入大厅！');
                    this.isPreloaded = true;
                    this.audio.playBGM('LOBBY');
                    this.initGameLoop();
                }
            };

            img.onload = handleLoad;
            img.onerror = handleError;
            img.src = ASSETS_TO_LOAD[key];
            
            // 处理缓存或同步加载情况
            if (img.complete) {
                handleLoad();
            }
        });
    }

    drawLoadingScreen() {
        ctx.fillStyle = '#07080a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#d4af37';
        ctx.font = `${20 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('正在载入洞府药理...', canvas.width / 2, canvas.height / 2 - 20 * scaleY);
        
        // 进度条
        const barW = 200 * scaleX;
        const barH = 8 * scaleY;
        const barX = (canvas.width - barW) / 2;
        const barY = canvas.height / 2 + 10 * scaleY;
        
        ctx.strokeStyle = '#4a3c2c';
        ctx.lineWidth = 1.5 * scaleX;
        ctx.strokeRect(barX, barY, barW, barH);
        ctx.fillStyle = '#277c54';
        ctx.fillRect(barX, barY, barW * this.loadingProgress, barH);
    }

    initGameLoop() {
        // 绑定触屏手势
        wx.onTouchStart(this.onTouchStart.bind(this));
        wx.onTouchMove(this.onTouchMove.bind(this));
        wx.onTouchEnd(this.onTouchEnd.bind(this));
        
        // 绑定重力感应/加速度计 (摇晃手机控温)
        wx.startAccelerometer({
            interval: 'normal',
            fail: (err) => console.warn('开启加速度计失败:', err)
        });
        let lastX = 0, lastY = 0, lastZ = 0;
        wx.onAccelerometerChange((res) => {
            if (this.gameState === 'REFINING' && this.physics) {
                const deltaX = Math.abs(res.x - lastX);
                const deltaY = Math.abs(res.y - lastY);
                const deltaZ = Math.abs(res.z - lastZ);
                // 微信加速度单位为 g (约 9.8 m/s^2)，乘以 9.8 换算为 m/s^2 与 H5 阈值 14 保持一致
                const shakeSpeed = (deltaX + deltaY + deltaZ) * 9.8;
                if (shakeSpeed > 14) {
                    this.physics.addHeat(shakeSpeed * 0.18);
                    this.triggerHaptic(false);
                }
            }
            lastX = res.x;
            lastY = res.y;
            lastZ = res.z;
        });

        // 开启游戏循环
        let lastTime = Date.now();
        const loop = () => {
            const now = Date.now();
            const dt = (now - lastTime) / 1000;
            lastTime = now;
            
            this.update(dt);
            this.render();
            
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    startGame(levelId) {
        this.gameState = 'PLAYING';
        this.currentLevelId = levelId;
        this.engine = new MatchEngine(levelId);
        this.score = 0;
        this.hintTypeId = -1;
        this.failReason = "";
        this.lastFailedState = null;
        this.lastLeaderboardSubmitStatus = "";
        this.triggerHaptic(false);
        this.audio.playBGM('PLAYING');
    }

    backToLobby() {
        this.gameState = 'LOBBY';
        this.engine = null;
        this.physics = null;
        this.hintTypeId = -1;
        this.triggerHaptic(false);
        this.audio.playBGM('LOBBY');
    }

    // --- 2. 状态更新逻辑 ---
    update(dt) {
        if (this.gameState === 'REFINING') {
            const result = this.physics.update(dt);
            
            // 触觉振动反馈逻辑
            if (result.temp > 90) {
                // 超温：高频短震警告 (每 0.35 秒触发一次)
                if (!this.lastVibrateTime || Date.now() - this.lastVibrateTime > 350) {
                    this.lastVibrateTime = Date.now();
                    this.triggerHaptic(false); // 轻快震动
                }
            } else if (result.temp < 50) {
                // 火力不足：每 1.5 秒轻轻震动一下提示火小了
                if (!this.lastVibrateTime || Date.now() - this.lastVibrateTime > 1500) {
                    this.lastVibrateTime = Date.now();
                    wx.vibrateShort({ type: 'light' });
                }
            } else {
                // 稳定火候区间：刚切入完美区间时，给一个明显的顿挫震动提示已进入安全火候
                if (this.wasOutsideStable === undefined) this.wasOutsideStable = true;
                if (this.wasOutsideStable) {
                    this.wasOutsideStable = false;
                    wx.vibrateShort({ type: 'medium' });
                }
            }
            
            // 标记是否处于非稳定区
            if (result.temp < 50 || result.temp > 90) {
                this.wasOutsideStable = true;
            }
            
            if (result.status === 'SUCCESS') {
                this.endGame(true);
            } else if (result.status === 'EXPLODE') {
                this.endGame(false, '炉火烈焰过猛烧穿炉耳，丹药炸裂！');
            }
        }
    }

    // --- 3. Canvas 核心渲染层 (像素级还原) ---
    render() {
        if (!this.isPreloaded) return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.touchZones = []; // 重置点击热区

        // 绘制通用洞府石壁背景
        this.drawCaveBackground();

        switch (this.gameState) {
            case 'LOBBY':
                this.renderLobby();
                break;
            case 'PLAYING':
                this.renderPlayScreen();
                break;
            case 'REFINING':
                this.renderRefiningScreen();
                break;
            case 'FAIL':
                this.renderFailScreen();
                break;
            case 'VICTORY':
                this.renderVictoryScreen();
                break;
            case 'POSTER':
                this.renderPosterScreen();
                break;
            case 'LEADERBOARD':
                this.renderLeaderboardScreen();
                break;
        }
    }

    drawCaveBackground() {
        const bgImg = this.loadedImages['cave_bg'];
        if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
        } else {
            // 备用纯色渐变
            const grad = ctx.createRadialGradient(
                canvas.width / 2, canvas.height * 0.4, 
                20 * scaleX, 
                canvas.width / 2, canvas.height / 2, 
                canvas.height / 2
            );
            grad.addColorStop(0, '#16201b');
            grad.addColorStop(0.5, '#0a0d10');
            grad.addColorStop(1, '#050608');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }

    // --- 4. 界面绘制：主大厅 (Lobby) ---
    renderLobby() {
        // 1. 顶部个人修为栏
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.3)';
        ctx.lineWidth = 1.5;
        
        const infoX = 16 * scaleX;
        const infoY = 32 * scaleY;
        const infoW = 180 * scaleX;
        const infoH = 44 * scaleY;
        this.roundRect(infoX, infoY, infoW, infoH, 22 * scaleY, true, true);

        // 太极头像与文字
        ctx.fillStyle = '#fff';
        ctx.font = `${18 * scaleY}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('☯️', infoX + 12 * scaleX, infoY + 28 * scaleY);
        
        ctx.fillStyle = '#ffd700';
        ctx.font = `bold ${11 * scaleY}px sans-serif`;
        ctx.fillText('云游散修', infoX + 38 * scaleX, infoY + 20 * scaleY);
        
        ctx.fillStyle = '#8fa095';
        ctx.font = `${9 * scaleY}px sans-serif`;
        const expTitle = getCultivationTitle(this.exp);
        ctx.fillText(`修为: ${this.exp} (${expTitle})`, infoX + 38 * scaleX, infoY + 34 * scaleY);

        // 2. 主标题
        ctx.fillStyle = '#f7eacc';
        ctx.font = `bold ${44 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(212, 175, 55, 0.5)';
        ctx.shadowBlur = 15;
        ctx.fillText('渡劫丹师', canvas.width / 2, canvas.height * 0.35);
        ctx.shadowBlur = 0; // 重置阴影

        ctx.fillStyle = '#8fa597';
        ctx.font = `${11 * scaleY}px sans-serif`;
        ctx.fillText('—— 堆叠三消 · 控温炼神丹 ——', canvas.width / 2, canvas.height * 0.4);

        // 3. 菜单按钮排布
        const btnW = 200 * scaleX;
        const btnH = 40 * scaleY;
        const startY = canvas.height * 0.48;
        const gap = 12 * scaleY;

        const levelLabels = {
            0: '初入丹途 (教学关)',
            1: '常驻挑战 (第一炉)',
            2: '常驻挑战 (第二炉)',
            3: '每日全服挑战'
        };
        const levelIds = getLobbyLevelIds(LEVEL_CONFIGS);
        levelIds.forEach((levelId, idx) => {
            const isSpecial = LEVEL_CONFIGS[levelId].dailyChallenge === true;
            this.drawLobbyButton(
                canvas.width / 2 - btnW / 2,
                startY + (btnH + gap) * idx,
                btnW,
                btnH,
                levelLabels[levelId] || LEVEL_CONFIGS[levelId].name,
                () => this.startGame(levelId),
                isSpecial
            );
        });

        this.drawLobbyButton(
            canvas.width / 2 - btnW / 2,
            startY + (btnH + gap) * levelIds.length,
            btnW,
            btnH,
            '全服丹榜',
            () => this.openLeaderboard(),
            true
        );
    }

    drawLobbyButton(x, y, w, h, text, callback, isSpecial = false) {
        const grad = ctx.createLinearGradient(x, y, x, y + h);
        if (isSpecial) {
            grad.addColorStop(0, '#a63a3a');
            grad.addColorStop(1, '#6e2727');
        } else {
            grad.addColorStop(0, '#317f54');
            grad.addColorStop(1, '#1e4f34');
        }
        ctx.fillStyle = grad;
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 1.5;
        this.roundRect(x, y, w, h, 4, true, true);

        ctx.fillStyle = '#ffd700';
        ctx.font = `bold ${13 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(text, x + w / 2, y + h / 2 + 5 * scaleY);

        this.touchZones.push({ x, y, w, h, callback });
    }

    // --- 5. 界面绘制：消除游玩页 (Playing) ---
    renderPlayScreen() {
        // A. 顶部真实对局信息
        const topBarGrad = ctx.createLinearGradient(0, 0, 0, 60 * scaleY);
        topBarGrad.addColorStop(0, '#1d1b18');
        topBarGrad.addColorStop(1, '#11100e');
        ctx.fillStyle = topBarGrad;
        ctx.fillRect(0, 0, canvas.width, 60 * scaleY);
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 60 * scaleY);
        ctx.lineTo(canvas.width, 60 * scaleY);
        ctx.stroke();

        // 顶部左侧徽章：玩家真实修为
        const badgeR = 21 * scaleY;
        const badgeX = 35 * scaleX;
        const badgeY = 30 * scaleY;
        const progressBadge = getPlayerProgressBadge(this.exp);
        
        // 外青玉圈
        ctx.fillStyle = '#1d5134';
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = '#ffd700';
        ctx.font = `bold ${9.5 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(progressBadge.title, badgeX, badgeY - 2 * scaleY);
        ctx.fillStyle = '#e5dcc6';
        ctx.font = `bold ${7.5 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", sans-serif`;
        ctx.fillText(progressBadge.expText, badgeX, badgeY + 9 * scaleY);

        // 顶部右侧只展示真实局内状态，不展示未实现的货币/体力。
        const startResX = 118 * scaleX;
        const resW = 96 * scaleX;
        const resH = 22 * scaleY;
        const resGap = 8 * scaleX;
        
        const drawMetric = (x, label, val) => {
            ctx.fillStyle = '#09090b';
            ctx.strokeStyle = '#4a3c2c';
            ctx.lineWidth = 1;
            this.roundRect(x, 19 * scaleY, resW, resH, 11 * scaleY, true, true);

            ctx.fillStyle = '#8fa597';
            ctx.font = `bold ${7 * scaleY}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(label, x + 8 * scaleX, 19 * scaleY + 14 * scaleY);

            ctx.fillStyle = '#e5dcc6';
            ctx.font = `bold ${8 * scaleY}px sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText(val, x + resW - 6 * scaleX, 19 * scaleY + 15 * scaleY);
        };
        
        drawMetric(startResX, '丹分', String(this.engine.score || 0));
        drawMetric(startResX + resW + resGap, '炉位', `${this.engine.slots.length}/7`);

        // B. 关卡挂幅与剩余火力
        ctx.fillStyle = 'rgba(74, 63, 49, 0.85)';
        ctx.fillRect(canvas.width / 2 - 80 * scaleX, 70 * scaleY, 160 * scaleX, 24 * scaleY);
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
        ctx.strokeRect(canvas.width / 2 - 80 * scaleX, 70 * scaleY, 160 * scaleX, 24 * scaleY);
        ctx.fillStyle = '#ffd700';
        ctx.font = `bold ${10 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(this.engine.level.name, canvas.width / 2, 70 * scaleY + 16 * scaleY);

        ctx.fillStyle = '#ff8f00';
        ctx.font = `bold ${9 * scaleY}px sans-serif`;
        ctx.fillText(`剩余柴薪: ${this.engine.steps} 步`, canvas.width / 2, 70 * scaleY + 36 * scaleY);

        // 返回 & 重新开始图标按钮
        this.drawIconBtn(12 * scaleX, 70 * scaleY, '🏠', () => this.backToLobby());
        this.drawIconBtn(canvas.width - 42 * scaleX, 70 * scaleY, '🔄', () => this.startGame(this.currentLevelId));

        // C. 绘制上方博古架 (Fanned Tray)
        this.drawTopShelf();

        // D. 绘制中部炼丹炉 (冒绿烟)
        this.drawCenterCauldron();

        // E. 绘制 3D 透视平铺牌堆 (核心算法渲染)
        this.drawPerspectiveTableCards();

        // F. 绘制底部 7格 插槽栏
        this.drawBottomSlotBar();

        // G. 绘制道具工具栏
        this.drawToolBar();
    }

    drawIconBtn(x, y, icon, callback) {
        ctx.fillStyle = 'rgba(42, 42, 53, 0.6)';
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x + 15 * scaleX, y + 12 * scaleY, 15 * scaleY, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffd700';
        ctx.font = `${12 * scaleY}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(icon, x + 15 * scaleX, y + 16 * scaleY);

        this.touchZones.push({
            x: x, y: y - 5 * scaleY, w: 30 * scaleX, h: 30 * scaleY, callback
        });
    }

    drawTopShelf() {
        const shelfY = 175 * scaleY;
        const img = this.loadedImages['slot_frame'];
        if (img) {
            // 用插槽背景图缩水模拟小木架
            ctx.drawImage(img, 20 * scaleX, shelfY, canvas.width - 40 * scaleX, 12 * scaleY);
        }

        // 绘制 9 张扇形排列的静态卡牌
        const cardW = 34 * scaleX;
        const cardH = 46 * scaleY;
        const centerX = canvas.width / 2;
        const centerY = shelfY - 5 * scaleY;

        const fannedCardTypes = [1, 2, 3, 4, 5, 6, 8, 3, 2];
        fannedCardTypes.forEach((typeId, idx) => {
            ctx.save();
            ctx.translate(centerX, centerY);
            
            // 扇形分布旋转角度
            const angle = (idx - 4) * 6 * Math.PI / 180;
            const radiusOffset = -35 * scaleY;
            ctx.rotate(angle);
            ctx.translate((idx - 4) * 8 * scaleX, radiusOffset);

            // 绘制宣纸纸面背景图
            const imgCardBg = this.loadedImages['card_bg'];
            if (imgCardBg) {
                ctx.drawImage(imgCardBg, -cardW / 2, -cardH / 2, cardW, cardH);
            } else {
                ctx.fillStyle = '#fdf6e2';
                ctx.strokeStyle = '#3c3024';
                ctx.lineWidth = 1;
                this.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 2, true, true);
            }

            // 插图 (无名字，完美垂直居中)
            const imgHerb = this.loadedImages[Object.keys(ASSETS_TO_LOAD)[typeId + 3]]; // 索引映射
            if (imgHerb) {
                ctx.drawImage(imgHerb, -12 * scaleX, -12 * scaleY, 24 * scaleX, 24 * scaleY);
            }
            
            ctx.restore();
        });
    }

    drawCenterCauldron() {
        const cX = canvas.width / 2;
        const cY = 230 * scaleY;
        
        // 绿雾环境光
        const grad = ctx.createRadialGradient(cX, cY, 10, cX, cY, 50);
        grad.addColorStop(0, 'rgba(82, 150, 110, 0.35)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cX, cY, 50, 0, Math.PI * 2);
        ctx.fill();

        // 嵌入鼎
        const img = this.loadedImages['cauldron'];
        if (img) {
            ctx.drawImage(img, cX - 40 * scaleX, cY - 45 * scaleY, 80 * scaleX, 85 * scaleY);
        }

        // 铭牌
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 1;
        this.roundRect(cX - 30 * scaleX, cY + 36 * scaleY, 60 * scaleX, 14 * scaleY, 2, true, true);
        
        ctx.fillStyle = '#ffd700';
        ctx.font = `bold ${9 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('青铜炼丹炉', cX, cY + 46 * scaleY);
    }

    drawPerspectiveTableCards() {
        // 我们在 3D 透视台面中绘制牌堆
        // 核心透视投影数学：
        const cardW = 60 * scaleX;
        const cardH = 78 * scaleY;
        const perspectiveYScale = 0.84;
        
        const tableCenterX = canvas.width / 2;
        const tableBaseY = canvas.height * 0.44; // 平铺台面原点Y

        // 排序确保 level 低的先画，level 高的压在上面
        this.engine.cards.sort((a,b) => a.level - b.level);

        this.engine.cards.forEach(card => {
            // 2D 逻辑坐标 nx from -180 to 180, ny from 0 to 340
            // 归一化自游戏引擎
            const nx = (card.x + 27 - 180) / 180;
            const ny = (card.y + 35 - 170) / 170;

            // 透视深度缩放 (近大远小)
            const ny_tilt = ny * 0.65; // 控制倾斜纵深
            const scale = 1.0 - ny_tilt * 0.16;

            // 平铺透视倾斜偏角
            const skew_x = nx + ny_tilt * 0.16;

            const renderX = Math.round(tableCenterX + skew_x * 140 * scaleX);
            const renderY = Math.round(tableBaseY + ny_tilt * 105 * scaleY - card.level * 4 * scaleY);

            // 记录当前卡牌的屏幕投射包围盒，用于触控判定。
            const actualW = cardW * scale;
            const actualH = cardH * scale * perspectiveYScale;
            card.screenRect = {
                x: renderX - actualW / 2,
                y: renderY - actualH / 2,
                w: actualW,
                h: actualH
            };

            ctx.save();
            ctx.translate(renderX, renderY);
            
            // 轻量透视即可，过度压扁会让卡牌图和文字发糊。
            ctx.transform(scale, -0.035 * scale, 0.08 * scale, perspectiveYScale * scale, 0, 0);

            // 1. 绘制卡牌背景图与阴影
            const cardBgKey = card.isBlocked ? 'card_locked_bg' : 'card_bg';
            const imgCardBg = this.loadedImages[cardBgKey];
            
            ctx.save();
            // 应用自然的模糊投影
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = 6 * scaleX;
            ctx.shadowOffsetX = 2 * scaleX;
            ctx.shadowOffsetY = 3 * scaleY;

            if (imgCardBg) {
                ctx.drawImage(imgCardBg, -cardW / 2, -cardH / 2, cardW, cardH);
                ctx.restore(); // 立即恢复，防止后续文字与插图产生模糊阴影
                
                if (card.typeId === this.hintTypeId) {
                    ctx.strokeStyle = '#ff4500'; // 橘红色高亮提示
                    ctx.lineWidth = 3;
                    this.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3, false, true);
                }
            } else {
                ctx.fillStyle = card.isBlocked ? '#c0c0c0' : '#fdf6e2';
                this.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3, true, false);
                ctx.restore(); // 立即恢复
                
                if (card.typeId === this.hintTypeId) {
                    ctx.strokeStyle = '#ff4500';
                    ctx.lineWidth = 3;
                } else {
                    ctx.strokeStyle = '#3c3024';
                    ctx.lineWidth = 1.5;
                }
                this.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3, false, true);
            }

            // 3. 药材名称与插图。文字和药材图不参与透视矩阵，优先保证清晰度。
            ctx.restore();

            const herb = HERB_DATABASE[card.typeId];
            const contentW = actualW;
            const contentH = actualH;
            
            // 星级 (已移除中文药材名字)
            ctx.fillStyle = '#8c6e2b';
            ctx.font = `bold ${9 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", sans-serif`;
            ctx.fillText(herb.stars, renderX, renderY + contentH * 0.37);

            // 绘制本草 PNG 插图 (无名字，完美居中并适当放大)
            const imgHerb = this.loadedImages[Object.keys(ASSETS_TO_LOAD)[card.typeId + 3]];
            if (imgHerb) {
                const herbSize = Math.min(48 * scaleX, contentW * 0.70);
                ctx.drawImage(imgHerb, renderX - herbSize / 2, renderY - herbSize / 2 - 5 * scaleY, herbSize, herbSize);
            }
            
            // 被遮挡的卡牌在插图之上再覆盖一层半透明暗灰，显示“锁定”状态，但仍保持可见
            if (card.isBlocked) {
                ctx.fillStyle = 'rgba(20, 20, 25, 0.55)';
                this.roundRect(renderX - contentW / 2, renderY - contentH / 2, contentW, contentH, 3 * scaleX, true, false);
            }
        });
    }

    drawBottomSlotBar() {
        const slotFrameW = canvas.width - 24 * scaleX;
        const slotFrameH = 72 * scaleY;
        const slotFrameX = 12 * scaleX;
        const slotFrameY = canvas.height - 132 * scaleY;

        // 1. 绘制玉佩架背景
        const img = this.loadedImages['slot_frame'];
        if (img) {
            ctx.drawImage(img, slotFrameX, slotFrameY, slotFrameW, slotFrameH);
        }

        // 2. 绘制 7 个插槽内药材
        // 算出插槽内起点的X (木板左右缩进)
        const slotStartX = slotFrameX + 44 * scaleX;
        const slotSpacing = 34 * scaleX;
        const slotW = 28 * scaleX;
        const slotH = 38 * scaleY;
        const slotY = slotFrameY + 18 * scaleY;

        this.engine.slots.forEach((card, idx) => {
            if (idx >= 7) return;
            const x = slotStartX + idx * slotSpacing;

            // 绘制卡牌背景图
            const imgCardBg = this.loadedImages['card_bg'];
            if (imgCardBg) {
                ctx.drawImage(imgCardBg, x, slotY, slotW, slotH);
            } else {
                ctx.fillStyle = '#fdf6e2';
                ctx.strokeStyle = '#3c3024';
                ctx.lineWidth = 1.2;
                this.roundRect(x, slotY, slotW, slotH, 2, true, true);
            }

            const herb = HERB_DATABASE[card.typeId];
            
            // 缩微卡牌插图 (已移除中文药材名字，完美居中)
            const imgHerb = this.loadedImages[Object.keys(ASSETS_TO_LOAD)[card.typeId + 3]];
            if (imgHerb) {
                ctx.drawImage(imgHerb, x + slotW / 2 - 10 * scaleX, slotY + 8 * scaleY, 20 * scaleX, 22 * scaleY);
            }
        });
    }

    drawToolBar() {
        // A. 道具按钮 (经过高度与样式的重大提升，更显著且极具国风质感)
        const toolW = 96 * scaleX;
        const toolH = 36 * scaleY;
        const toolY = canvas.height - 52 * scaleY;
        const toolStartX = (canvas.width - toolW * 3 - 16 * scaleX) / 2;
        const gap = 8 * scaleX;

        const drawTool = (idx, icon, name, callback) => {
            const x = toolStartX + idx * (toolW + gap);
            
            // 绘制按钮主体模糊阴影
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            ctx.shadowBlur = 8 * scaleX;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 3 * scaleY;
            
            // 精美漆红木纹渐变
            const btnGrad = ctx.createLinearGradient(x, toolY, x, toolY + toolH);
            btnGrad.addColorStop(0, '#8c2c20'); // 亮漆红
            btnGrad.addColorStop(1, '#3a110d'); // 暗红木
            ctx.fillStyle = btnGrad;
            ctx.strokeStyle = '#e5c158'; // 耀眼金边
            ctx.lineWidth = 1.8 * scaleX;
            this.roundRect(x, toolY, toolW, toolH, 6 * scaleX, true, true);
            ctx.restore(); // 恢复阴影

            // 绘制按钮内侧高光细边框，营造立体微浮雕质感
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 230, 150, 0.25)';
            ctx.lineWidth = 1 * scaleX;
            this.roundRect(x + 2 * scaleX, toolY + 2 * scaleY, toolW - 4 * scaleX, toolH - 4 * scaleY, 4 * scaleX, false, true);
            ctx.restore();

            // 绘制文字 (高清晰亮金字)
            ctx.fillStyle = '#fff6d6';
            ctx.font = `bold ${12 * scaleY}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(`${icon} ${name}`, x + toolW / 2, toolY + 22 * scaleY);

            this.touchZones.push({ x, y: toolY, w: toolW, h: toolH, callback });
        };

        drawTool(0, '↩️', '撤回', () => this.useUndo());
        drawTool(1, '💡', '提示', () => this.useHint());
        drawTool(2, '🔀', '洗牌', () => this.useShuffle());
    }

    // --- 6. 界面绘制：挂轴控温室 (Refining) ---
    renderRefiningScreen() {
        // 1. 宣纸画轴框 (WeChat Canvas 模拟)
        const frameW = canvas.width - 24 * scaleX;
        const frameH = canvas.height - 130 * scaleY;
        const frameX = 12 * scaleX;
        const frameY = 65 * scaleY;

        // 左右木轴条
        ctx.fillStyle = '#362214';
        ctx.fillRect(frameX, frameY, 10 * scaleX, frameH);
        ctx.fillRect(frameX + frameW - 10 * scaleX, frameY, 10 * scaleX, frameH);

        // 宣纸背景图：绘制精美的水墨山水画卷背景，完全贴合效果图
        const imgPaperBg = this.loadedImages['scroll_paper_bg'];
        if (imgPaperBg) {
            ctx.drawImage(imgPaperBg, frameX + 10 * scaleX, frameY, frameW - 20 * scaleX, frameH);
        } else {
            // 备用立体渐变
            const paperGrad = ctx.createLinearGradient(frameX + 10 * scaleX, frameY, frameX + frameW - 20 * scaleX, frameY);
            paperGrad.addColorStop(0, '#d2c5a2');
            paperGrad.addColorStop(0.12, '#f5ecd5');
            paperGrad.addColorStop(0.5, '#eae2ca');
            paperGrad.addColorStop(0.88, '#f5ecd5');
            paperGrad.addColorStop(1, '#d2c5a2');
            ctx.fillStyle = paperGrad;
            ctx.fillRect(frameX + 10 * scaleX, frameY, frameW - 20 * scaleX, frameH);
        }
        
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(frameX + 10 * scaleX, frameY, frameW - 20 * scaleX, frameH);

        // 2. 标题与状态区
        ctx.fillStyle = '#1c1511';
        ctx.font = `bold ${13 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('准备合凝', canvas.width / 2, frameY + 24 * scaleY);

        // 凝丹进度条 (升级为效果图对应的细长金底暗纹能量条)
        const pW = 160 * scaleX;
        const pH = 8 * scaleY;
        const pX = (canvas.width - pW) / 2;
        const pY = frameY + 32 * scaleY;
        
        ctx.fillStyle = '#2b231b';
        ctx.strokeStyle = '#8c7355';
        ctx.lineWidth = 1;
        this.roundRect(pX, pY, pW, pH, 4, true, true);
        
        if (this.physics.progress > 0) {
            const progressGrad = ctx.createLinearGradient(pX, pY, pX + pW * (this.physics.progress / 100), pY);
            progressGrad.addColorStop(0, '#d4af37');
            progressGrad.addColorStop(1, '#ffe891');
            ctx.fillStyle = progressGrad;
            this.roundRect(pX, pY, pW * (this.physics.progress / 100), pH, 4, true, false);
        }

        ctx.fillStyle = '#5d432b';
        ctx.font = `bold ${8 * scaleY}px sans-serif`;
        ctx.fillText(`凝丹进度: ${Math.floor(this.physics.progress)}%`, canvas.width / 2, pY + 18 * scaleY);

        // 3. 中央炉鼎及八角符文石台座 (完美还原效果图)
        const platformX = canvas.width / 2;
        const platformY = frameY + frameH * 0.52; // 垂直移动至画面核心中心
        
        // 八角立体石座绘制
        const baseW = 90 * scaleX;
        const baseH = 26 * scaleY;
        
        // 下层石台厚度
        ctx.fillStyle = '#1c1815';
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(platformX - baseW * 0.7, platformY + baseH);
        ctx.lineTo(platformX + baseW * 0.7, platformY + baseH);
        ctx.lineTo(platformX + baseW, platformY + baseH * 0.3);
        ctx.lineTo(platformX + baseW, platformY + baseH * 0.3 + 12 * scaleY);
        ctx.lineTo(platformX + baseW * 0.7, platformY + baseH + 12 * scaleY);
        ctx.lineTo(platformX - baseW * 0.7, platformY + baseH + 12 * scaleY);
        ctx.lineTo(platformX - baseW, platformY + baseH * 0.3 + 12 * scaleY);
        ctx.lineTo(platformX - baseW, platformY + baseH * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 上层石台面
        ctx.fillStyle = '#2f2822';
        ctx.beginPath();
        ctx.moveTo(platformX - baseW * 0.7, platformY + baseH);
        ctx.lineTo(platformX + baseW * 0.7, platformY + baseH);
        ctx.lineTo(platformX + baseW, platformY + baseH * 0.3);
        ctx.lineTo(platformX + baseW * 0.7, platformY - baseH * 0.4);
        ctx.lineTo(platformX - baseW * 0.7, platformY - baseH * 0.4);
        ctx.lineTo(platformX - baseW, platformY + baseH * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 绘制石台边缘刻印文字
        ctx.fillStyle = '#d4af37';
        ctx.font = `bold ${9.5 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('巽 离 坤 兑 乾 坎 艮 震', platformX, platformY + baseH + 8 * scaleY);

        // 动态绘制八角台座与炉底周身的熊熊烈火特效
        ctx.save();
        
        const tempRatio = Math.min(1.4, (this.physics.temp - 20) / 70);
        const isStable = this.physics.temp >= 50 && this.physics.temp <= 90;
        const isHot = this.physics.temp > 90;
        const isCold = this.physics.temp < 50;

        // 炉子根据火候震动/发光特效
        let cauldronX = platformX;
        let cauldronY = platformY;
        let glowColor = 'transparent';
        
        if (isStable) {
            glowColor = 'rgba(76, 175, 80, 0.45)'; // 祥云绿光
        } else if (isHot) {
            // 武火剧烈抖动
            cauldronX += (Math.random() - 0.5) * 6 * scaleX;
            cauldronY += (Math.random() - 0.5) * 6 * scaleY;
            glowColor = 'rgba(211, 47, 47, 0.75)'; // 暴躁红光
        } else {
            glowColor = 'rgba(0, 0, 0, 0.2)'; // 冰冷黯淡
        }

        // 1. 底盘环绕真火
        ctx.shadowColor = isHot ? '#ff1e00' : (isStable ? '#ffd700' : '#4a90e2');
        ctx.shadowBlur = isCold ? 5 : 20;
        const ringFlameW = 100 * scaleX * tempRatio * (isCold ? 0.35 : 1.0);
        const ringFlameH = 36 * scaleY * tempRatio * (isCold ? 0.35 : 1.0);
        if (ringFlameW > 10) {
            const flameGrad = ctx.createRadialGradient(
                cauldronX, cauldronY - 8 * scaleY, 5,
                cauldronX, cauldronY - 8 * scaleY, ringFlameW
            );
            if (isHot) {
                flameGrad.addColorStop(0, 'rgba(255, 50, 50, 0.95)');
                flameGrad.addColorStop(0.3, 'rgba(200, 10, 10, 0.85)');
                flameGrad.addColorStop(1, 'rgba(0,0,0,0)');
            } else if (isStable) {
                flameGrad.addColorStop(0, 'rgba(255, 235, 120, 0.95)');
                flameGrad.addColorStop(0.3, 'rgba(255, 120, 0, 0.8)');
                flameGrad.addColorStop(0.7, 'rgba(214, 34, 0, 0.5)');
                flameGrad.addColorStop(1, 'rgba(0,0,0,0)');
            } else {
                // 冰冷幽蓝色火光
                flameGrad.addColorStop(0, 'rgba(100, 180, 255, 0.6)');
                flameGrad.addColorStop(0.5, 'rgba(40, 80, 160, 0.3)');
                flameGrad.addColorStop(1, 'rgba(0,0,0,0)');
            }
            
            ctx.fillStyle = flameGrad;
            ctx.beginPath();
            ctx.ellipse(cauldronX, cauldronY - 6 * scaleY, ringFlameW, ringFlameH, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 2. 绘制炉鼎主体 (放大至 170x150)
        const cauldronW = 170 * scaleX;
        const cauldronH = 150 * scaleY;
        const imgCauldron = this.loadedImages['cauldron'];
        
        ctx.save();
        // 炉身发光渲染
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 18 * scaleX;
        if (imgCauldron) {
            ctx.drawImage(imgCauldron, cauldronX - cauldronW / 2, cauldronY - cauldronH + 20 * scaleY, cauldronW, cauldronH);
        }
        ctx.restore();

        // 3. 鼎口升腾的大火 / 氤氲仙气
        ctx.save();
        ctx.shadowColor = isHot ? '#ff3d00' : (isStable ? '#78ffb4' : 'transparent');
        ctx.shadowBlur = isCold ? 0 : 15;
        const topFlameSize = 35 * scaleX * tempRatio * (isCold ? 0.1 : 1.0);
        if (topFlameSize > 5) {
            const topFlameGrad = ctx.createRadialGradient(
                cauldronX, cauldronY - cauldronH + 42 * scaleY, 2,
                cauldronX, cauldronY - cauldronH + 42 * scaleY, topFlameSize
            );
            if (isHot) {
                topFlameGrad.addColorStop(0, 'rgba(255, 120, 100, 0.95)');
                topFlameGrad.addColorStop(0.4, 'rgba(120, 10, 10, 0.8)');
                topFlameGrad.addColorStop(0.8, 'rgba(40, 0, 0, 0.5)'); // 滚滚黑红烟
                topFlameGrad.addColorStop(1, 'rgba(0,0,0,0)');
            } else if (isStable) {
                // 金绿仙气
                topFlameGrad.addColorStop(0, 'rgba(120, 255, 180, 0.9)');
                topFlameGrad.addColorStop(0.4, 'rgba(46, 125, 50, 0.6)');
                topFlameGrad.addColorStop(0.8, 'rgba(212, 175, 55, 0.25)');
                topFlameGrad.addColorStop(1, 'rgba(0,0,0,0)');
            } else {
                topFlameGrad.addColorStop(0, 'rgba(200, 220, 255, 0.3)');
                topFlameGrad.addColorStop(1, 'rgba(0,0,0,0)');
            }
            ctx.fillStyle = topFlameGrad;
            ctx.beginPath();
            ctx.arc(cauldronX, cauldronY - cauldronH + 36 * scaleY, topFlameSize, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 3.5 绘制悬浮的水墨“火候印章”大字 (凝、燥、冷)
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let sealChar = "";
        let sealColor = "";
        let sealGlow = "";
        
        if (isCold) {
            sealChar = "冷";
            sealColor = 'rgba(74, 144, 226, 0.85)';
            sealGlow = 'rgba(74, 144, 226, 0.4)';
        } else if (isHot) {
            sealChar = "燥";
            sealColor = 'rgba(211, 47, 47, 0.9)';
            sealGlow = 'rgba(211, 47, 47, 0.5)';
        } else {
            sealChar = "凝";
            sealColor = 'rgba(46, 125, 50, 0.9)';
            sealGlow = 'rgba(120, 255, 180, 0.6)';
        }
        
        ctx.shadowColor = sealGlow;
        ctx.shadowBlur = 15 * scaleX;
        ctx.fillStyle = sealColor;
        ctx.font = `bold ${30 * scaleY}px KaiTi, STKaiti, "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        // 浮动动画，让汉字上下微颤
        const floatY = Math.sin(Date.now() / 200) * 3 * scaleY;
        ctx.fillText(sealChar, cauldronX, cauldronY - cauldronH - 22 * scaleY + floatY);
        ctx.restore();

        // 4. 左侧立式温控表 (完美还原效果图：带武火/文武火/文火背底字样及碧玉框架)
        const thermoW = 66 * scaleX;
        const thermoH = 240 * scaleY;
        const thermoX = frameX + 20 * scaleX;
        const thermoY = platformY - thermoH / 2 - 10 * scaleY; // 与炉鼎垂直对齐
        
        const imgThermo = this.loadedImages['thermometer'];
        if (imgThermo) {
            ctx.drawImage(imgThermo, thermoX, thermoY, thermoW, thermoH);
        }

        // 绘制三色指示背板
        const activeBarX = thermoX + 22 * scaleX;
        const activeBarY = thermoY + 28 * scaleY;
        const activeBarW = 22 * scaleX;
        const activeBarH = 155 * scaleY;
        
        // A. 武火区 (顶部 22%)
        ctx.fillStyle = 'rgba(211, 47, 47, 0.18)';
        this.roundRect(activeBarX, activeBarY, activeBarW, activeBarH * 0.22, 2, true, false);
        // B. 文武火区 (中部 45%)
        ctx.fillStyle = 'rgba(76, 175, 80, 0.25)';
        this.roundRect(activeBarX, activeBarY + activeBarH * 0.22, activeBarW, activeBarH * 0.46, 2, true, false);
        // C. 文火区 (底部 33%)
        ctx.fillStyle = 'rgba(74, 144, 226, 0.18)';
        this.roundRect(activeBarX, activeBarY + activeBarH * 0.68, activeBarW, activeBarH * 0.32, 2, true, false);

        // 绘制对应的温控标注文字 (垂直书写在测温条左侧)
        ctx.font = `bold ${8 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        
        ctx.fillStyle = '#b71c1c';
        ctx.fillText('武火', thermoX + 11 * scaleX, activeBarY + 16 * scaleY);
        
        ctx.fillStyle = '#1b5e20';
        ctx.fillText('文武火', thermoX + 11 * scaleX, activeBarY + 60 * scaleY);
        
        ctx.fillStyle = '#0d47a1';
        ctx.fillText('文火', thermoX + 11 * scaleX, activeBarY + 124 * scaleY);

        // 绘制温度计内的实际水银柱
        const tempPercent = Math.min(1.0, Math.max(0.0, (this.physics.temp - 20) / 90));
        const mercuryH = tempPercent * (activeBarH - 10 * scaleY);
        const liquidBottomY = activeBarY + activeBarH - 5 * scaleY;
        const liquidTopY = liquidBottomY - mercuryH;
        
        // 绘制亮红色的火候柱
        const mercuryGrad = ctx.createLinearGradient(0, liquidBottomY, 0, liquidTopY);
        mercuryGrad.addColorStop(0, '#d32f2f');
        mercuryGrad.addColorStop(1, '#ff7b00');
        ctx.fillStyle = mercuryGrad;
        ctx.fillRect(activeBarX + 9 * scaleX, liquidTopY, 4 * scaleX, mercuryH);

        // 钻石火候游标指针
        ctx.save();
        ctx.translate(activeBarX + 11 * scaleX, liquidTopY);
        ctx.rotate(45 * Math.PI / 180);
        ctx.fillStyle = '#ff3d00';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.fillRect(-5, -5, 10, 10);
        ctx.stroke();
        ctx.restore();

        // 当前温度读数 (深褐墨字，完美适配宣纸山水底色)
        ctx.fillStyle = '#1c1511';
        ctx.font = `bold ${8 * scaleY}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(`${Math.floor(this.physics.temp)}℃`, activeBarX + 26 * scaleX, liquidTopY + 3 * scaleY);

        // 5. 右侧材料槽 (展示当前放入炼制的 3 种水墨风格本草植物)
        const sideStartX = frameX + frameW - 74 * scaleX;
        const sideStartY = platformY - 96 * scaleY; // 与中央炉鼎完美居中平衡
        const slotBoxW = 48 * scaleX;
        const slotBoxH = 46 * scaleY;
        const slotBoxGap = 12 * scaleY;

        const drawSideSlot = (idx, imgKey, name, active = false) => {
            const y = sideStartY + idx * (slotBoxH + slotBoxGap);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.strokeStyle = active ? '#d4af37' : '#8c7355';
            ctx.lineWidth = active ? 2 : 1;
            this.roundRect(sideStartX, y, slotBoxW, slotBoxH, 4, true, true);
            
            // 使用高品质 PNG 资产
            const imgHerb = this.loadedImages[imgKey];
            if (imgHerb) {
                ctx.drawImage(imgHerb, sideStartX + slotBoxW / 2 - 15 * scaleX, y + 4 * scaleY, 30 * scaleX, 30 * scaleY);
            }

            ctx.fillStyle = '#3e2723';
            ctx.font = `bold ${8 * scaleY}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(name, sideStartX + slotBoxW / 2, y + 40 * scaleY);
        };

        drawSideSlot(0, 'ginseng', '人参', true);
        drawSideSlot(1, 'lingzhi', '灵芝');
        drawSideSlot(2, 'danggui', '当归');

        // 6. 右侧三大木纹操作按钮垂直叠放（炼制, 加速, 退出）—— 完美还原效果图右下角按钮列
        const btnStartX = sideStartX;
        const btnStartY = sideStartY + 3 * (slotBoxH + slotBoxGap) + 12 * scaleY;
        const subBtnW = 48 * scaleX;
        const subBtnH = 22 * scaleY;
        const subBtnGap = 6 * scaleY;

        const drawWoodButton = (idx, text, callback) => {
            const y = btnStartY + idx * (subBtnH + subBtnGap);
            
            const grad = ctx.createLinearGradient(btnStartX, y, btnStartX, y + subBtnH);
            grad.addColorStop(0, '#5c4033');
            grad.addColorStop(1, '#3d2b1f');
            ctx.fillStyle = grad;
            ctx.strokeStyle = '#d4af37';
            ctx.lineWidth = 1;
            this.roundRect(btnStartX, y, subBtnW, subBtnH, 4, true, true);

            ctx.fillStyle = '#ffd700';
            ctx.font = `bold ${12.5 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(text, btnStartX + subBtnW / 2, y + subBtnH / 2 + 3 * scaleY);

            this.touchZones.push({
                x: btnStartX, y: y, w: subBtnW, h: subBtnH, callback
            });
        };

        drawWoodButton(0, '退出', () => {
            this.gameState = 'LOBBY';
            this.backToLobby();
        });

        // 7. 底部摇晃图标与金字引导 (对应效果图最底部的圆形手机图标与巨大的“摇晃手机以控温”书法金字)
        const phoneIconRadius = 20 * scaleY;
        const phoneIconX = canvas.width / 2;
        const phoneIconY = frameY + frameH - 56 * scaleY;
        
        // 绘制高阶水墨描边金色震动手机图标
        ctx.save();
        
        // A. 绘制暗底金边圆圈
        ctx.fillStyle = '#11100e';
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 2 * scaleX;
        ctx.shadowColor = 'rgba(212, 175, 55, 0.45)';
        ctx.shadowBlur = 8 * scaleX;
        ctx.beginPath();
        ctx.arc(phoneIconX, phoneIconY, phoneIconRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        
        ctx.save();
        ctx.translate(phoneIconX, phoneIconY);
        
        // B. 绘制左右两侧金色震动声波纹
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.8 * scaleX;
        ctx.lineCap = 'round';
        // 左波纹
        ctx.beginPath();
        ctx.arc(-phoneIconRadius * 0.3, 0, phoneIconRadius * 0.45, 2.3, 3.98);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-phoneIconRadius * 0.3, 0, phoneIconRadius * 0.65, 2.45, 3.83);
        ctx.stroke();
        // 右波纹
        ctx.beginPath();
        ctx.arc(phoneIconRadius * 0.3, 0, phoneIconRadius * 0.45, -0.84, 0.84);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(phoneIconRadius * 0.3, 0, phoneIconRadius * 0.65, -0.68, 0.68);
        ctx.stroke();
        
        // C. 倾斜 12 度绘制手机和手掌 (营造晃动中的动感)
        ctx.rotate(-12 * Math.PI / 180);
        
        const phoneW = 10 * scaleX;
        const phoneH = 20 * scaleY;
        const phoneX = -phoneW / 2;
        const phoneY = -phoneH / 2;
        
        // 手机本体
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#2b1a0a';
        ctx.lineWidth = 0.8 * scaleX;
        this.roundRect(phoneX, phoneY, phoneW, phoneH, 2 * scaleX, true, true);
        
        // 手机屏幕 (暗色)
        ctx.fillStyle = '#1c1511';
        this.roundRect(phoneX + 1 * scaleX, phoneY + 1.8 * scaleY, phoneW - 2 * scaleX, phoneH - 3.6 * scaleY, 1 * scaleX, true, false);
        
        // 绘制金手执机
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#2b1a0a';
        ctx.lineWidth = 0.8 * scaleX;
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(2 * scaleX, 7 * scaleY);
        ctx.lineTo(6 * scaleX, 13 * scaleY);
        ctx.lineTo(2 * scaleX, 16 * scaleY);
        ctx.lineTo(-2 * scaleX, 11 * scaleY);
        ctx.quadraticCurveTo(-4 * scaleX, 7 * scaleY, -4 * scaleX, 4 * scaleY);
        ctx.lineTo(-6 * scaleX, 2 * scaleY);
        ctx.lineTo(-4 * scaleX, 0 * scaleY);
        ctx.lineTo(-3 * scaleX, 2 * scaleY);
        ctx.lineTo(-1 * scaleX, 3 * scaleY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // 绘制包围在右侧的四个指头
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2 * scaleX;
        ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(6.5 * scaleX, (-1.5 + i * 2.5) * scaleY);
            ctx.lineTo(3 * scaleX, (-1.5 + i * 2.5) * scaleY);
            ctx.stroke();
        }
        ctx.restore();

        // 8. 绘制金色水墨书法感引导文字
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `bold ${15 * scaleY}px KaiTi, STKaiti, "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        
        // 渐变金色字填充
        const gradText = ctx.createLinearGradient(
            canvas.width / 2, frameY + frameH - 26 * scaleY,
            canvas.width / 2, frameY + frameH - 10 * scaleY
        );
        gradText.addColorStop(0, '#ffe891');
        gradText.addColorStop(0.5, '#d4af37');
        gradText.addColorStop(1, '#8c7355');
        
        ctx.fillStyle = gradText;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.lineWidth = 3 * scaleX;
        
        ctx.strokeText('摇晃手机以控温', canvas.width / 2, frameY + frameH - 16 * scaleY);
        ctx.fillText('摇晃手机以控温', canvas.width / 2, frameY + frameH - 16 * scaleY);
        ctx.restore();

        // 整个底部做成隐藏滑块感应热区，以支持同时摇晃和触摸滑动控温
        this.touchZones.push({
            x: frameX + 20 * scaleX,
            y: frameY + frameH - 80 * scaleY,
            w: frameW - 40 * scaleX,
            h: 70 * scaleY,
            isSlider: true
        });

        // 9. 绘制屏幕边缘氛围呼吸光晕 (Vignette Glow Overlay)
        ctx.save();
        let borderGlow = 'transparent';
        if (isCold) {
            borderGlow = 'rgba(74, 144, 226, 0.45)';
        } else if (isHot) {
            // 警示红光呼吸闪烁
            const pulse = 0.4 + Math.sin(Date.now() / 150) * 0.2;
            borderGlow = `rgba(211, 47, 47, ${pulse})`;
        } else {
            // 金绿微光
            borderGlow = 'rgba(76, 175, 80, 0.25)';
        }
        
        ctx.shadowColor = borderGlow;
        ctx.shadowBlur = 25 * scaleX;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.02)';
        ctx.lineWidth = 12 * scaleX;
        // 在屏幕外沿稍微描边，通过阴影虚化渗透进屏幕边缘
        ctx.strokeRect(-6 * scaleX, -6 * scaleY, canvas.width + 12 * scaleX, canvas.height + 12 * scaleY);
        ctx.restore();
    }

    // --- 7. 界面绘制：失败弹窗 (Fail) ---
    renderFailScreen() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const w = 280 * scaleX;
        const h = 260 * scaleY;
        const x = (canvas.width - w) / 2;
        const y = (canvas.height - h) / 2;

        ctx.fillStyle = '#ebdcb2';
        ctx.strokeStyle = '#1c1511';
        ctx.lineWidth = 3;
        this.roundRect(x, y, w, h, 8, true, true);

        ctx.fillStyle = '#a63a3a';
        ctx.font = `bold ${16 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('💥 炸炉了！ 💥', canvas.width / 2, y + 36 * scaleY);

        ctx.fillStyle = '#3e2723';
        ctx.font = `bold ${20 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText('丹毁人伤', canvas.width / 2, y + 68 * scaleY);

        ctx.fillStyle = '#4e3629';
        ctx.font = `${10 * scaleY}px sans-serif`;
        this.drawWrapText(this.failReason || '炉内药草之息驳杂不纯，真火骤盛，当场炸裂！', canvas.width / 2, y + 100 * scaleY, w - 40 * scaleX, 16 * scaleY);

        // 按钮
        this.drawLobbyButton(canvas.width / 2 - 90 * scaleX, y + 144 * scaleY, 180 * scaleX, 32 * scaleY, '📺 炉神保佑 (广告复活)', () => this.useReviveAd(), true);
        this.drawLobbyButton(canvas.width / 2 - 90 * scaleX, y + 188 * scaleY, 80 * scaleX, 28 * scaleY, '重来', () => this.startGame(this.currentLevelId));
        this.drawLobbyButton(canvas.width / 2 + 10 * scaleX, y + 188 * scaleY, 80 * scaleX, 28 * scaleY, '回洞府', () => this.backToLobby());
    }

    // --- 8. 界面绘制：成功结算页 (Victory Scroll) ---
    renderVictoryScreen() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const scrollW = canvas.width - 20 * scaleX;
        const scrollH = 280 * scaleY;
        const scrollX = 10 * scaleX;
        const scrollY = (canvas.height - scrollH) / 2 - 30 * scaleY;

        // 绘制画轴背景
        const imgScroll = this.loadedImages['scroll'];
        if (imgScroll) {
            ctx.drawImage(imgScroll, scrollX, scrollY, scrollW, scrollH);
        }

        const cX = canvas.width / 2;
        
        // 呼吸效果的背景金光
        const glowRadius = (32 + Math.sin(Date.now() / 300) * 3) * scaleY;
        ctx.fillStyle = 'rgba(212, 175, 55, 0.35)';
        ctx.beginPath();
        ctx.arc(cX, scrollY + 95 * scaleY, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // 根据成丹类型加载对应原画
        let elixirKey = 'elixir_zhujidan';
        const target = this.engine.level.targetElixir;
        if (target === '九转还魂丹') elixirKey = 'elixir_huanhundan';
        else if (target === '太乙飞仙丹') elixirKey = 'elixir_feixiandan';
        else if (target === '九转金丹') elixirKey = 'elixir_jindan';

        const imgElixir = this.loadedImages[elixirKey];
        const rotAngle = (Date.now() / 1500) % (Math.PI * 2);
        const elixirSize = 64 * scaleY;

        ctx.save();
        ctx.translate(cX, scrollY + 95 * scaleY);
        ctx.rotate(rotAngle);
        if (imgElixir) {
            ctx.drawImage(imgElixir, -elixirSize / 2, -elixirSize / 2, elixirSize, elixirSize);
        } else {
            // 降级使用黄球Emoji
            ctx.fillStyle = '#ffd700';
            ctx.font = `${40 * scaleY}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('🟡', 0, 11 * scaleY);
        }
        ctx.restore();

        // 书法大字
        ctx.fillStyle = '#4e2712';
        ctx.font = `bold ${18 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText(`恭喜炼制${this.engine.level.targetElixir}`, cX, scrollY + 162 * scaleY);
        
        ctx.fillStyle = '#7b5b3f';
        ctx.font = `bold ${10 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText('仅0.3%修士达成此成就', cX, scrollY + 182 * scaleY);

        ctx.fillStyle = '#5d3f2e';
        ctx.font = `bold ${12 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText(`总分: ${this.score.toLocaleString()}`, cX, scrollY + 215 * scaleY);

        ctx.fillStyle = '#7b5b3f';
        ctx.font = `${8 * scaleY}px sans-serif`;
        const submitStatus = this.currentLevelId === DAILY_LEADERBOARD_LEVEL_ID
            ? (this.lastLeaderboardSubmitStatus || '正在同步全服丹榜...')
            : '每日全服挑战成绩可入榜';
        ctx.fillText(submitStatus, cX, scrollY + 236 * scaleY);

        // 按钮并排摆在卷轴下方
        const btnY = scrollY + scrollH + 15 * scaleY;
        const btnW = 90 * scaleX;
        const btnH = 32 * scaleY;

        // 蓝绿色分享按钮
        const gradShare = ctx.createLinearGradient(cX - 105 * scaleX, btnY, cX - 105 * scaleX, btnY + btnH);
        gradShare.addColorStop(0, '#4b89bd');
        gradShare.addColorStop(1, '#204e76');
        ctx.fillStyle = gradShare;
        ctx.strokeStyle = '#ffd700';
        this.roundRect(cX - 105 * scaleX, btnY, btnW, btnH, 4, true, true);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${11 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText('🪷 分享', cX - 105 * scaleX + btnW / 2, btnY + 20 * scaleY);
        this.touchZones.push({ x: cX - 105 * scaleX, y: btnY, w: btnW, h: btnH, callback: () => this.showPoster() });

        // 绿色返回大厅按钮
        const gradReturn = ctx.createLinearGradient(cX + 15 * scaleX, btnY, cX + 15 * scaleX, btnY + btnH);
        gradReturn.addColorStop(0, '#317f54');
        gradReturn.addColorStop(1, '#1e4f34');
        ctx.fillStyle = gradReturn;
        ctx.strokeStyle = '#ffd700';
        this.roundRect(cX + 15 * scaleX, btnY, btnW, btnH, 4, true, true);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${11 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText('🚪 返回', cX + 15 * scaleX + btnW / 2, btnY + 20 * scaleY);
        this.touchZones.push({ x: cX + 15 * scaleX, y: btnY, w: btnW, h: btnH, callback: () => this.backToLobby() });

        if (this.currentLevelId === DAILY_LEADERBOARD_LEVEL_ID) {
            this.drawLobbyButton(cX - 80 * scaleX, btnY + 44 * scaleY, 160 * scaleX, 30 * scaleY, '查看全服丹榜', () => this.openLeaderboard(), true);
        }
    }

    async openLeaderboard() {
        this.gameState = 'LEADERBOARD';
        await this.loadLeaderboard();
    }

    async loadLeaderboard() {
        this.leaderboardLoading = true;
        this.leaderboardStatus = '正在读取全服丹榜...';
        this.leaderboardEntries = [];

        if (!this.leaderboard.isAvailable()) {
            this.leaderboardLoading = false;
            this.leaderboardStatus = getLeaderboardFailureText('CLOUD_UNAVAILABLE', 'load');
            return;
        }

        try {
            const result = await this.leaderboard.getDailyLeaderboard({
                levelId: DAILY_LEADERBOARD_LEVEL_ID,
                limit: 50
            });
            this.leaderboardLoading = false;
            if (!result || !result.ok) {
                this.leaderboardStatus = getLeaderboardFailureText(result && result.code, 'load');
                return;
            }
            this.leaderboardEntries = result.entries || [];
            this.leaderboardStatus = this.leaderboardEntries.length ? '' : '今日暂无上榜记录';
        } catch (err) {
            console.warn('读取排行榜失败:', err);
            this.leaderboardLoading = false;
            this.leaderboardStatus = getLeaderboardFailureText('CLOUD_CALL_FAILED', 'load');
        }
    }

    renderLeaderboardScreen() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const w = canvas.width - 34 * scaleX;
        const h = Math.min(460 * scaleY, canvas.height - 96 * scaleY);
        const x = (canvas.width - w) / 2;
        const y = (canvas.height - h) / 2;

        ctx.fillStyle = '#ebdcb2';
        ctx.strokeStyle = '#1c1511';
        ctx.lineWidth = 3 * scaleX;
        this.roundRect(x, y, w, h, 8 * scaleX, true, true);

        ctx.fillStyle = '#4e2712';
        ctx.font = `bold ${20 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('全服丹榜', canvas.width / 2, y + 38 * scaleY);

        ctx.fillStyle = '#7b5b3f';
        ctx.font = `${10 * scaleY}px sans-serif`;
        ctx.fillText('每日全服挑战 · 今日最高分', canvas.width / 2, y + 58 * scaleY);

        if (this.leaderboardStatus) {
            ctx.fillStyle = '#5d3f2e';
            ctx.font = `${12 * scaleY}px sans-serif`;
            ctx.fillText(this.leaderboardStatus, canvas.width / 2, y + 116 * scaleY);
        }

        const listX = x + 22 * scaleX;
        let rowY = y + 88 * scaleY;
        const rowH = 28 * scaleY;
        const visibleRows = Math.floor((h - 150 * scaleY) / rowH);
        const rows = this.leaderboardEntries.slice(0, visibleRows);

        rows.forEach(entry => {
            ctx.fillStyle = entry.rank <= 3 ? 'rgba(212, 175, 55, 0.16)' : 'rgba(255, 255, 255, 0.18)';
            this.roundRect(listX, rowY - 18 * scaleY, w - 44 * scaleX, 23 * scaleY, 4 * scaleX, true, false);

            ctx.fillStyle = '#3e2723';
            ctx.font = `bold ${11 * scaleY}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(`#${entry.rank}`, listX + 10 * scaleX, rowY);
            ctx.fillText(entry.nickname, listX + 58 * scaleX, rowY);

            ctx.textAlign = 'right';
            ctx.fillText(String(entry.score), listX + w - 58 * scaleX, rowY);
            rowY += rowH;
        });

        this.drawLobbyButton(canvas.width / 2 - 86 * scaleX, y + h - 46 * scaleY, 80 * scaleX, 30 * scaleY, '刷新', () => this.loadLeaderboard());
        this.drawLobbyButton(canvas.width / 2 + 6 * scaleX, y + h - 46 * scaleY, 80 * scaleX, 30 * scaleY, '返回', () => this.backToLobby());
    }

    // --- 9. 界面绘制：修仙海报 (Poster) ---
    renderPosterScreen() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const w = 270 * scaleX;
        const h = 380 * scaleY;
        const x = (canvas.width - w) / 2;
        const y = (canvas.height - h) / 2 - 20 * scaleY;

        ctx.fillStyle = '#fdfaf2';
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 4;
        this.roundRect(x, y, w, h, 6, true, true);

        ctx.fillStyle = '#3e2723';
        ctx.font = `bold ${16 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('修真界快报', canvas.width / 2, y + 34 * scaleY);

        ctx.strokeStyle = 'rgba(62, 39, 35, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 12 * scaleX, y + 46 * scaleY, w - 24 * scaleX, h - 58 * scaleY);

        ctx.fillStyle = '#6d5843';
        ctx.font = `${9 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText('恭喜道友', canvas.width / 2, y + 74 * scaleY);

        ctx.fillStyle = '#277c54';
        ctx.font = `bold ${20 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText('云游散修', canvas.width / 2, y + 104 * scaleY);

        ctx.fillStyle = '#ffe99b';
        ctx.font = `62px sans-serif`;
        ctx.fillText('🟡', canvas.width / 2, y + 180 * scaleY);

        ctx.fillStyle = '#4e3629';
        ctx.font = `${10 * scaleY}px sans-serif`;
        ctx.fillText(`于洞府中淬炼九天，成功炼成`, canvas.width / 2, y + 220 * scaleY);
        ctx.fillStyle = '#b8860b';
        ctx.font = `bold ${12 * scaleY}px "STKaiti", "KaiTi", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif`;
        ctx.fillText(`${this.engine.level.targetElixir} (${this.engine.level.elixirGrade})`, canvas.width / 2, y + 242 * scaleY);

        // 二维码框
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#8c7355';
        ctx.lineWidth = 0.8;
        ctx.fillRect(canvas.width / 2 - 30 * scaleX, y + 266 * scaleY, 60 * scaleX, 60 * scaleY);
        ctx.strokeRect(canvas.width / 2 - 30 * scaleX, y + 266 * scaleY, 60 * scaleX, 60 * scaleY);
        
        ctx.fillStyle = '#8c7355';
        ctx.font = `6px sans-serif`;
        ctx.fillText('[ 扫码炼制神丹 ]', canvas.width / 2, y + 338 * scaleY);

        // 关闭与保存按钮
        this.drawLobbyButton(canvas.width / 2 - 80 * scaleX, y + h + 15 * scaleY, 160 * scaleX, 32 * scaleY, '保存海报并返回', () => this.savePosterToAlbum());
    }

    savePosterToAlbum() {
        if (typeof wx.canvasToTempFilePath !== 'function' || typeof wx.saveImageToPhotosAlbum !== 'function') {
            wx.showModal({ title: '保存失败', content: '当前环境不支持保存海报到相册。' });
            return;
        }

        wx.canvasToTempFilePath({
            canvas,
            success: (res) => {
                wx.saveImageToPhotosAlbum({
                    filePath: res.tempFilePath,
                    success: () => {
                        wx.showToast({ title: '已保存到相册' });
                        this.backToLobby();
                    },
                    fail: (err) => {
                        console.warn('保存海报失败:', err);
                        wx.showModal({ title: '保存失败', content: '请确认已授权保存到相册。' });
                    }
                });
            },
            fail: (err) => {
                console.warn('生成海报图片失败:', err);
                wx.showModal({ title: '保存失败', content: '海报图片生成失败。' });
            }
        });
    }

    // --- 10. 微信广告与复活 ---
    useReviveAd() {
        if (!REVIVE_AD_UNIT_ID) {
            wx.showModal({ title: '广告未配置', content: '缺少真实激励视频广告位，无法复活。' });
            return;
        }

        // 微信官方激励视频广告调用封装
        if (typeof wx.createRewardedVideoAd === 'function') {
            const videoAd = wx.createRewardedVideoAd({ adUnitId: REVIVE_AD_UNIT_ID });
            
            videoAd.load()
                .then(() => videoAd.show())
                .catch(err => {
                    console.warn('激励视频广告展示失败:', err);
                    wx.showModal({ title: '广告不可用', content: '广告未成功展示，无法复活。' });
                });

            videoAd.onClose(res => {
                if (res && res.isEnded) {
                    this.executeRevive();
                } else {
                    wx.showToast({ title: '未看完广告无法复活' });
                }
            });
        } else {
            wx.showModal({ title: '广告不可用', content: '当前环境不支持激励视频，无法复活。' });
        }
    }

    executeRevive() {
        if (!this.engine) return;

        const targetState = getReviveTargetState({
            failedState: this.lastFailedState,
            cardsRemaining: this.engine.cards.length,
            slotsRemaining: this.engine.slots.length
        });

        if (targetState === 'REFINING') {
            this.physics = new RefinePhysics();
            this.gameState = 'REFINING';
            this.failReason = "";
            this.audio.playBGM('REFINING');
            return;
        }

        this.engine.revive();
        this.gameState = 'PLAYING';
        this.failReason = "";
        this.audio.playBGM('PLAYING');
    }

    useUndo() {
        if (this.engine.undo()) {
            wx.showToast({ title: '时光倒流' });
        } else {
            wx.showToast({ title: '无可撤回' });
        }
    }

    useHint() {
        const hintTypeId = this.engine.getHintCardId();
        if (hintTypeId !== -1) {
            this.hintTypeId = hintTypeId;
            setTimeout(() => {
                if (this.hintTypeId === hintTypeId) {
                    this.hintTypeId = -1;
                }
            }, 2000);
            wx.showToast({ title: `提示：炉内需要匹配` });
        }
    }

    useShuffle() {
        this.engine.shuffle();
        wx.showToast({ title: '乾坤斗移' });
    }

    // --- 11. 触控及物理滑动判定 ---
    onTouchStart(e) {
        const touch = e.touches[0];
        const tx = touch.clientX * dpr;
        const ty = touch.clientY * dpr;

        // A. 控温滑动捕获
        if (this.gameState === 'REFINING') {
            const padZone = this.touchZones.find(z => z.isSlider);
            if (padZone && tx >= padZone.x && tx <= padZone.x + padZone.w && ty >= padZone.y && ty <= padZone.y + padZone.h) {
                this.isDraggingTemp = true;
                this.tempInputLastY = ty;
                return;
            }
        }

        // B. 牌堆卡牌点击碰撞捕获 (反向遍历 level 最高的先吃)
        if (this.gameState === 'PLAYING') {
            for (let i = this.engine.cards.length - 1; i >= 0; i--) {
                const card = this.engine.cards[i];
                if (card.screenRect && !card.isBlocked) {
                    const r = card.screenRect;
                    if (tx >= r.x && tx <= r.x + r.w && ty >= r.y && ty <= r.y + r.h) {
                        this.handleCanvasCardClick(card);
                        return;
                    }
                }
            }
        }

        // C. 通用按钮区触控判定
        this.touchZones.forEach(zone => {
            if (!zone.isSlider && tx >= zone.x && tx <= zone.x + zone.w && ty >= zone.y && ty <= zone.y + zone.h) {
                zone.callback();
            }
        });
    }

    onTouchMove(e) {
        if (this.gameState === 'REFINING' && this.isDraggingTemp) {
            const touch = e.touches[0];
            const physicalY = touch.clientY * dpr;
            const deltaY = physicalY - this.tempInputLastY;
            // 滑动量越大，温度累加越高 (滑动控温物理输入)
            this.physics.addHeat(Math.abs(deltaY) * 0.24);
            this.tempInputLastY = physicalY;
        }
    }

    onTouchEnd() {
        this.isDraggingTemp = false;
    }

    handleCanvasCardClick(card) {
        // 卡牌飞入槽位计算
        this.triggerHaptic(true);
        this.engine.saveHistorySnapshot();

        this.engine.cards = this.engine.cards.filter(c => c.id !== card.id);
        this.engine.steps--;

        const slotIndex = this.engine.findSlotInsertIndex(card.typeId);
        this.engine.slots.splice(slotIndex, 0, card);
        this.engine.refreshBlockedStatus();

        const isMatch = this.engine.checkMatchThree(card.typeId);
        if (isMatch) {
            this.triggerHaptic(false);
        }
        this.checkGameProgress();
    }

    checkGameProgress() {
        if (this.engine.cards.length === 0 && this.engine.slots.length === 0) {
            this.gameState = 'REFINING';
            this.physics = new RefinePhysics();
            this.audio.playBGM('REFINING');
            return;
        }
        if (this.engine.slots.length >= 7) {
            this.endGame(false, '丹炉火位已被杂乱药草占满，当场炸炉！');
        }
        if (this.engine.steps <= 0) {
            this.endGame(false, '丹房柴薪火力耗尽，药材化作冷缩废渣！');
        }
    }

    endGame(isWin, reason = "") {
        const failedState = this.gameState;
        this.gameState = isWin ? 'VICTORY' : 'FAIL';
        this.audio.playBGM(isWin ? 'VICTORY' : 'FAIL');
        if (isWin) {
            this.lastFailedState = null;
            this.triggerHaptic(false);
            
            const refineStats = this.physics ? this.physics.getStats() : {};
            this.score = calculateFinalScore({
                matchScore: this.engine.score,
                slotsRemaining: this.engine.slots.length,
                stepsRemaining: this.engine.steps,
                refineStats
            });
            
            const expReward = this.currentLevelId === 3 ? 120 : (this.currentLevelId === 0 ? 20 : 50);
            this.exp += expReward;
            wx.setStorageSync('liandan_exp', this.exp);
            this.submitVictoryScore();
        } else {
            this.lastFailedState = failedState;
            this.triggerHaptic(true);
            this.failReason = reason;
        }
    }

    async submitVictoryScore() {
        if (this.currentLevelId !== DAILY_LEADERBOARD_LEVEL_ID) {
            this.lastLeaderboardSubmitStatus = '每日全服挑战成绩可入榜';
            return;
        }

        if (!this.leaderboard.isAvailable()) {
            this.lastLeaderboardSubmitStatus = getLeaderboardFailureText('CLOUD_UNAVAILABLE', 'submit');
            return;
        }

        try {
            const result = await this.leaderboard.submitScore({
                score: this.score,
                levelId: this.currentLevelId,
                nickname: ''
            });

            if (result && result.ok) {
                this.lastLeaderboardSubmitStatus = result.updated ? '成绩已同步全服丹榜' : '已有更高成绩在榜';
            } else {
                this.lastLeaderboardSubmitStatus = getLeaderboardFailureText(result && result.code, 'submit');
            }
        } catch (err) {
            console.warn('提交排行榜成绩失败:', err);
            this.lastLeaderboardSubmitStatus = getLeaderboardFailureText('CLOUD_CALL_FAILED', 'submit');
        }
    }

    showPoster() {
        this.gameState = 'POSTER';
    }

    // --- 12. 绘图辅助函数 ---
    roundRect(x, y, w, h, r, fill = true, stroke = true) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    drawWrapText(text, x, y, maxWidth, lineHeight) {
        const words = text.split('');
        let line = '';
        let posY = y;
        
        ctx.textAlign = 'center';
        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n];
            let metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line, x, posY);
                line = words[n];
                posY += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, posY);
    }

    triggerHaptic(isLong) {
        if (isLong) {
            wx.vibrateLong();
        } else {
            wx.vibrateShort({ type: 'light' });
        }
    }
}

// 实例化运行小游戏
new MainGame();
