/**
 * FFmpeg 进度计算器
 * 专门处理FFmpeg输出并计算准确的转换进度
 */
class FFmpegProgressCalculator {
    constructor(options = {}) {
        this.totalDuration = 0;           // 视频总时长（秒）
        this.lastValidPercent = 0;        // 最后一个有效的进度百分比
        this.lastValidTime = 0;           // 最后一个有效的时间（秒）
        this.startTime = Date.now();      // 计算器开始时间
        this.skipInitialSeconds = options.skipInitialSeconds || 2; // 跳过前N秒的不准确数据
        this.enableDebugLog = options.enableDebugLog || false;     // 是否启用调试日志
        this.logCallback = options.logCallback || null;            // 日志回调函数
    }

    /**
     * 设置视频总时长
     * @param {number} duration 视频总时长（秒）
     */
    setTotalDuration(duration) {
        this.totalDuration = duration;
        this.log(`📐 设置视频总时长: ${duration.toFixed(2)}秒`);
    }

    /**
     * 重置计算器状态
     */
    reset() {
        this.lastValidPercent = 0;
        this.lastValidTime = 0;
        this.startTime = Date.now();
        this.log(`🔄 进度计算器已重置`);
    }

    /**
     * 从FFmpeg输出计算进度
     * @param {number} ffmpegPercent FFmpeg报告的百分比
     * @param {string|number} timeInfo 时间信息（可能是字符串或数字）
     * @returns {object} { percent: number, time: number, isValid: boolean, reason: string }
     */
    calculateProgress(ffmpegPercent, timeInfo) {
        const result = {
            percent: this.lastValidPercent,
            time: this.lastValidTime,
            isValid: false,
            reason: ''
        };

        // 检查是否在跳过期间
        const elapsed = (Date.now() - this.startTime) / 1000;
        if (elapsed < this.skipInitialSeconds) {
            result.reason = `准备阶段 (${elapsed.toFixed(1)}s/${this.skipInitialSeconds}s)`;
            this.log(`⏳ ${result.reason}`);
            return result;
        }

        // 解析时间信息
        const parsedTime = this.parseTimeInfo(timeInfo);
        if (parsedTime === null) {
            result.reason = '时间解析失败';
            this.log(`❌ ${result.reason}: ${timeInfo}`);
            return result;
        }

        // 验证时间合理性
        if (!this.isTimeValid(parsedTime)) {
            result.reason = `时间超出合理范围: ${parsedTime.toFixed(2)}s`;
            this.log(`⚠️ ${result.reason} (总时长: ${this.totalDuration.toFixed(2)}s)`);
            return result;
        }

        // 计算基于时间的进度
        let timeBasedPercent = 0;
        if (this.totalDuration > 0) {
            timeBasedPercent = Math.min(Math.round((parsedTime / this.totalDuration) * 100), 100);
        }

        // 选择最佳进度值
        let bestPercent = this.selectBestPercent(ffmpegPercent, timeBasedPercent);

        // 确保单调递增
        if (bestPercent < this.lastValidPercent) {
            result.reason = `进度倒退: ${bestPercent}% < ${this.lastValidPercent}%`;
            this.log(`🔄 ${result.reason}`);
            return result;
        }

        // 更新状态并返回结果
        this.lastValidPercent = bestPercent;
        this.lastValidTime = parsedTime;
        
        result.percent = bestPercent;
        result.time = parsedTime;
        result.isValid = true;
        result.reason = '进度更新成功';

        this.log(`✅ ${result.reason}: ${bestPercent}% (时间: ${parsedTime.toFixed(2)}s)`);
        return result;
    }

    /**
     * 解析时间信息
     * @param {string|number} timeInfo 时间信息
     * @returns {number|null} 解析后的时间（秒），失败返回null
     */
    parseTimeInfo(timeInfo) {
        if (typeof timeInfo === 'number') {
            return timeInfo;
        }

        const timeStr = String(timeInfo);

        // 优先解析 FFmpeg 标准时间格式: time=HH:MM:SS.SS
        const ffmpegTimeMatch = timeStr.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
        if (ffmpegTimeMatch) {
            const hours = parseFloat(ffmpegTimeMatch[1]);
            const minutes = parseFloat(ffmpegTimeMatch[2]);
            const seconds = parseFloat(ffmpegTimeMatch[3]);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            this.log(`🕐 FFmpeg时间格式: ${ffmpegTimeMatch[0]} -> ${totalSeconds.toFixed(2)}s`);
            return totalSeconds;
        }

        // 备用：简单数字提取
        const simpleTimeMatch = timeStr.match(/(\d+\.?\d*)/);
        if (simpleTimeMatch) {
            let time = parseFloat(simpleTimeMatch[1]);
            
            // 处理可能的微秒单位错误
            if (time > 1000000) {
                time = time / 1000000;
                this.log(`🔄 微秒转换: ${simpleTimeMatch[1]} -> ${time.toFixed(2)}s`);
            }
            
            return time;
        }

        return null;
    }

    /**
     * 验证时间是否合理
     * @param {number} time 时间（秒）
     * @returns {boolean} 是否合理
     */
    isTimeValid(time) {
        if (time <= 0) return false;
        if (this.totalDuration <= 0) return true; // 如果没有总时长，任何正数都算合理
        return time <= this.totalDuration * 1.2; // 允许20%的误差
    }

    /**
     * 选择最佳的进度百分比
     * @param {number} ffmpegPercent FFmpeg报告的百分比
     * @param {number} timeBasedPercent 基于时间计算的百分比
     * @returns {number} 最佳百分比
     */
    selectBestPercent(ffmpegPercent, timeBasedPercent) {
        // 如果有总时长，优先使用基于时间的计算
        if (this.totalDuration > 0 && timeBasedPercent >= 0 && timeBasedPercent <= 100) {
            return timeBasedPercent;
        }

        // 备用：使用FFmpeg百分比（但要在合理范围内）
        if (ffmpegPercent >= 0 && ffmpegPercent <= 100) {
            return Math.round(ffmpegPercent);
        }

        // 都不可用时，返回当前进度
        return this.lastValidPercent;
    }

    /**
     * 获取当前进度信息
     * @returns {object} { percent: number, time: number }
     */
    getCurrentProgress() {
        return {
            percent: this.lastValidPercent,
            time: this.lastValidTime
        };
    }

    /**
     * 日志输出
     * @param {string} message 日志消息
     */
    log(message) {
        if (this.enableDebugLog && this.logCallback) {
            this.logCallback(`[进度计算器] ${message}`);
        }
    }

    /**
     * 创建一个便捷的工厂方法
     * @param {number} totalDuration 视频总时长
     * @param {object} options 选项
     * @returns {FFmpegProgressCalculator} 计算器实例
     */
    static create(totalDuration, options = {}) {
        const calculator = new FFmpegProgressCalculator(options);
        calculator.setTotalDuration(totalDuration);
        return calculator;
    }
}

export default FFmpegProgressCalculator;
