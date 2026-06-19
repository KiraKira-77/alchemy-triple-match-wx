// js/refine-physics.js

export class RefinePhysics {
    constructor() {
        this.temp = 20.0;          // 当前温度
        this.progress = 0.0;      // 凝丹进度
        this.dangerTime = 0.0;    // 超温时长
        this.inputHeat = 0.0;     // 当前积攒热量
        
        this.coolingRate = 8.5;   // 散热常数
        this.targetMin = 50.0;
        this.targetMax = 90.0;
        this.dangerMax = 3.0;     // 超温上限时间
    }

    addHeat(amount) {
        this.inputHeat += amount;
    }

    update(dt) {
        // 物理散热模型
        const thermalLoss = this.coolingRate * (this.temp - 20) * 0.1;
        
        // 能量注入
        const heatInput = this.inputHeat * 15;
        this.inputHeat *= 0.82; // 摩擦阻尼衰减

        this.temp += (heatInput - thermalLoss - 4.2) * dt;
        this.temp = Math.max(20, Math.min(this.temp, 110));

        const isStable = this.temp >= this.targetMin && this.temp <= this.targetMax;
        const isHot = this.temp > this.targetMax;

        let status = "RUNNING";

        if (isStable) {
            // 在目标火候
            this.progress += 13.5 * dt; // 7.5秒通关
            this.dangerTime = Math.max(0, this.dangerTime - dt);
        } else if (isHot) {
            // 超温
            this.dangerTime += dt;
            if (this.dangerTime >= this.dangerMax) {
                status = "EXPLODE";
            }
        } else {
            // 微火冷却
            this.progress = Math.max(0, this.progress - 4.5 * dt);
            this.dangerTime = Math.max(0, this.dangerTime - dt);
        }

        if (this.progress >= 100) {
            status = "SUCCESS";
        }

        return {
            temp: this.temp,
            progress: this.progress,
            dangerTime: this.dangerTime,
            status: status
        };
    }
}
