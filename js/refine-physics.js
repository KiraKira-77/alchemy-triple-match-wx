// js/refine-physics.js

export class RefinePhysics {
    constructor() {
        this.temp = 20.0;
        this.progress = 0.0;
        this.dangerTime = 0.0;
        this.inputHeat = 0.0;

        this.stableTime = 0.0;
        this.coldTime = 0.0;
        this.hotTime = 0.0;
        this.totalTime = 0.0;

        this.coolingRate = 8.5;
        this.targetMin = 50.0;
        this.targetMax = 90.0;
        this.dangerMax = 3.0;
    }

    addHeat(amount) {
        this.inputHeat += amount;
    }

    update(dt) {
        const thermalLoss = this.coolingRate * (this.temp - 20) * 0.1;

        const heatInput = this.inputHeat * 15;
        this.inputHeat *= 0.82;

        this.temp += (heatInput - thermalLoss - 4.2) * dt;
        this.temp = Math.max(20, Math.min(this.temp, 110));

        const isStable = this.temp >= this.targetMin && this.temp <= this.targetMax;
        const isHot = this.temp > this.targetMax;
        this.totalTime += dt;

        let status = 'RUNNING';

        if (isStable) {
            this.stableTime += dt;
            this.progress += 13.5 * dt;
            this.dangerTime = Math.max(0, this.dangerTime - dt);
        } else if (isHot) {
            this.hotTime += dt;
            this.dangerTime += dt;
            if (this.dangerTime >= this.dangerMax) {
                status = 'EXPLODE';
            }
        } else {
            this.coldTime += dt;
            this.progress = Math.max(0, this.progress - 4.5 * dt);
            this.dangerTime = Math.max(0, this.dangerTime - dt);
        }

        if (this.progress >= 100) {
            status = 'SUCCESS';
        }

        return {
            temp: this.temp,
            progress: this.progress,
            dangerTime: this.dangerTime,
            status: status
        };
    }

    getStats() {
        const roundTime = (value) => Math.round(value * 1000) / 1000;
        return {
            stableTime: roundTime(this.stableTime),
            coldTime: roundTime(this.coldTime),
            hotTime: roundTime(this.hotTime),
            totalTime: roundTime(this.totalTime)
        };
    }
}
