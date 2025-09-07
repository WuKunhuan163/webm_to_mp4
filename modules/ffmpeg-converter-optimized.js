/**
 * 优化的FFmpeg WebM to MP4 转换器 - GitHub Pages 兼容版本
 * 支持Web Worker和多种性能优化策略
 * 不使用SharedArrayBuffer，确保GitHub Pages兼容性
 */

class OptimizedFFmpegConverter {
    constructor(useWorker = true) {
        this.useWorker = useWorker;
        this.worker = null;
        this.ffmpeg = null;
        this.isLoaded = false;
        this.onProgress = null;
        this.onLog = null;
        this.conversionPromise = null;
        this.memoryPool = new Map(); // 内存池用于重用ArrayBuffer
        this.maxPoolSize = 5;        // 最大缓存数量
    }

    // 初始化转换器
    async init() {
        if (this.isLoaded) return;

        if (this.useWorker && typeof Worker !== 'undefined') {
            return this.initWorker();
        } else {
            return this.initDirect();
        }
    }

    // 初始化Web Worker模式
    async initWorker() {
        try {
            if (this.onLog) this.onLog('正在初始化 FFmpeg Worker...');
            
            this.worker = new Worker('./modules/ffmpeg-worker.js', { type: 'module' });
            
            return new Promise((resolve, reject) => {
                this.worker.onmessage = (e) => {
                    const { type, message, success } = e.data;
                    
                    switch (type) {
                        case 'initialized':
                            if (success) {
                                this.isLoaded = true;
                                if (this.onLog) this.onLog('✅ FFmpeg Worker 初始化完成！');
                                resolve();
                            } else {
                                reject(new Error('Worker 初始化失败'));
                            }
                            break;
                            
                        case 'log':
                            if (this.onLog) this.onLog(message);
                            break;
                            
                        case 'error':
                            reject(new Error(message));
                            break;
                    }
                };
                
                this.worker.onerror = (error) => {
                    reject(new Error(`Worker 错误: ${error.message}`));
                };
                
                // 发送初始化命令
                this.worker.postMessage({ type: 'init' });
            });
            
        } catch (error) {
            if (this.onLog) this.onLog(`Worker 初始化失败，切换到直接模式: ${error.message}`);
            this.useWorker = false;
            return this.initDirect();
        }
    }

    // 初始化直接模式
    async initDirect() {
        try {
            if (this.onLog) this.onLog('正在初始化 FFmpeg (直接模式)...');
            
            const { FFmpeg } = await import('../node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
            this.ffmpeg = new FFmpeg();

            // 设置事件监听
            this.ffmpeg.on('log', ({ message }) => {
                if (this.onLog) this.onLog(`[FFmpeg] ${message}`);
            });

            this.ffmpeg.on('progress', ({ progress, time }) => {
                const percent = Math.round(progress * 100);
                if (this.onProgress) {
                    const timeInSeconds = time > 1000000 ? (time / 1000000).toFixed(2) : time.toFixed(2);
                    this.onProgress(percent, timeInSeconds);
                }
            });

            // 加载FFmpeg核心
            const baseURL = new URL('../', window.location.href).href;
            const coreURL = baseURL + 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js';
            const wasmURL = baseURL + 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm';
            
            await this.ffmpeg.load({
                coreURL: coreURL,
                wasmURL: wasmURL,
            });

            this.isLoaded = true;
            if (this.onLog) this.onLog('✅ FFmpeg 直接模式初始化完成！');

        } catch (error) {
            if (this.onLog) this.onLog(`❌ FFmpeg 初始化失败: ${error.message}`);
            throw error;
        }
    }

    // 智能参数选择器
    getOptimalSettings(fileSize, duration = 5) {
        const fileSizeMB = fileSize / (1024 * 1024);
        
        // 根据文件大小和时长智能选择参数
        if (fileSizeMB < 1) {
            // 小文件：优先速度
            return {
                preset: 'ultrafast',
                crf: 30,
                audioBitrate: '64k',
                fastMode: true,
                priority: 'speed'
            };
        } else if (fileSizeMB < 5) {
            // 中等文件：平衡速度和质量
            return {
                preset: 'ultrafast',
                crf: 28,
                audioBitrate: '96k',
                fastMode: true,
                priority: 'balanced'
            };
        } else {
            // 大文件：优先质量，但仍保持较快速度
            return {
                preset: 'veryfast',
                crf: 26,
                audioBitrate: '128k',
                fastMode: true,
                priority: 'quality'
            };
        }
    }

    // 转换WebM到MP4
    async convertWebMToMP4(webmBlob, options = {}) {
        if (!this.isLoaded) {
            throw new Error('转换器未初始化，请先调用 init()');
        }

        // 防止并发转换
        if (this.conversionPromise) {
            if (this.onLog) this.onLog('等待上一个转换任务完成...');
            await this.conversionPromise;
        }

        // 智能参数选择 - 强制重编码以确保兼容性
        if (!options.preset && !options.crf) {
            const optimalSettings = this.getOptimalSettings(webmBlob.size);
            options = { ...optimalSettings, ...options, fastMode: false }; // 强制关闭快速复制
            if (this.onLog) {
                this.onLog(`智能选择参数: ${optimalSettings.priority}模式 (preset=${optimalSettings.preset}, crf=${optimalSettings.crf}) - 强制重编码以确保兼容性`);
            }
        }

        if (this.useWorker && this.worker) {
            this.conversionPromise = this.convertWithWorker(webmBlob, options);
        } else {
            this.conversionPromise = this.convertDirect(webmBlob, options);
        }

        const result = await this.conversionPromise;
        this.conversionPromise = null;
        return result;
    }

    // 使用Worker转换 - GitHub Pages兼容版本
    async convertWithWorker(webmBlob, options) {
        return new Promise(async (resolve, reject) => {
            const startTime = Date.now();
            
            this.worker.onmessage = (e) => {
                const { type, buffer, percent, time, message } = e.data;
                
                switch (type) {
                    case 'progress':
                        if (this.onProgress) this.onProgress(percent, time);
                        break;
                        
                    case 'log':
                        if (this.onLog) this.onLog(message);
                        break;
                        
                    case 'completed':
                        const convertTime = ((Date.now() - startTime) / 1000).toFixed(2);
                        const mp4Blob = new Blob([buffer], { type: 'video/mp4' });
                        if (this.onLog) this.onLog(`✅ Worker转换完成！耗时 ${convertTime} 秒`);
                        resolve(mp4Blob);
                        break;
                        
                    case 'error':
                        reject(new Error(message));
                        break;
                }
            };
            
            // 发送转换命令 - 不使用Transferable Objects以确保兼容性
            const webmBuffer = await webmBlob.arrayBuffer();
            this.worker.postMessage({
                type: 'convert',
                data: { webmBuffer, options }
            });
        });
    }

    // 直接转换
    async convertDirect(webmBlob, options) {
        const {
            preset = 'ultrafast',
            crf = 28,
            audioBitrate = '96k',
            fastMode = true
        } = options;

        try {
            if (this.onLog) this.onLog('开始转换 WebM 到 MP4...');

            // 写入输入文件
            const inputData = new Uint8Array(await webmBlob.arrayBuffer());
            await this.ffmpeg.writeFile('input.webm', inputData);

            // 始终使用重编码模式以确保兼容性
            if (this.onLog) this.onLog('使用重编码模式确保MP4兼容性...');
            let command = ['-i', 'input.webm'].concat([
                '-c:v', 'libx264',           // 强制使用H.264编码
                '-preset', preset,
                '-tune', 'zerolatency',
                '-crf', crf.toString(),
                '-pix_fmt', 'yuv420p',       // 确保像素格式兼容
                '-profile:v', 'baseline',    // 使用baseline profile确保最大兼容性
                '-level:v', '3.0',           // 设置H.264 level
                '-c:a', 'aac',               // 强制使用AAC音频编码
                '-b:a', audioBitrate,
                '-ac', '2',                  // 双声道
                '-ar', '44100',              // 标准采样率
                '-movflags', '+faststart',   // 优化流媒体播放
                '-threads', '0',             // 使用所有可用线程
                '-f', 'mp4',                 // 确保MP4格式
                'output.mp4'
            ]);

            await this.ffmpeg.exec(command);
            if (this.onLog) this.onLog('H.264/AAC重编码完成');

            const data = await this.ffmpeg.readFile('output.mp4');
            const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });

            // 清理临时文件
            await this.ffmpeg.deleteFile('input.webm');
            await this.ffmpeg.deleteFile('output.mp4');

            if (this.onLog) this.onLog('✅ 直接模式转换完成！');
            return mp4Blob;

        } catch (error) {
            if (this.onLog) this.onLog(`❌ 转换失败: ${error.message}`);
            
            if (options.fastMode !== false) {
                if (this.onLog) this.onLog('快速模式失败，尝试标准重编码...');
                return this.convertDirect(webmBlob, { ...options, fastMode: false });
            }
            
            throw error;
        }
    }

    // 设置进度回调
    setProgressCallback(callback) {
        this.onProgress = callback;
    }

    // 设置日志回调
    setLogCallback(callback) {
        this.onLog = callback;
    }

    // 检查是否已加载
    isReady() {
        return this.isLoaded;
    }

    // 获取转换器信息
    getInfo() {
        return {
            isLoaded: this.isLoaded,
            useWorker: this.useWorker,
            hasWorker: !!this.worker,
            hasFFmpeg: !!this.ffmpeg
        };
    }

    // 清理资源
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.ffmpeg = null;
        this.isLoaded = false;
        this.conversionPromise = null;
        this.memoryPool.clear(); // 清理内存池
    }
}

// 导出模块
export default OptimizedFFmpegConverter;
