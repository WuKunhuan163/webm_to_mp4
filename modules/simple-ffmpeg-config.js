/**
 * 最简化的FFmpeg配置 - 使用libs文件夹
 * 完全避免特殊字符和复杂路径
 */

export class SimpleFFmpegConfig {
    static getBaseURL(context = 'window') {
        let baseURL;
        if (context === 'worker') {
            baseURL = new URL('../', self.location.href).href;
        } else {
            baseURL = new URL('../', window.location.href).href;
        }
        return baseURL.endsWith('/') ? baseURL : baseURL + '/';
    }

    static getFFmpegModuleURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'libs/ffmpeg/dist/esm/index.js';
    }

    static getFFmpegCoreURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'libs/core/dist/esm/ffmpeg-core.js';
    }

    static getFFmpegWasmURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'libs/core/dist/esm/ffmpeg-core.wasm';
    }

    static async validateResourceURL(url, logCallback = null) {
        try {
            const response = await fetch(url, { 
                method: 'HEAD',
                cache: 'no-cache'
            });
            
            if (response.ok) {
                if (logCallback) logCallback(`✅ 资源可访问: ${url}`);
                return true;
            } else {
                if (logCallback) logCallback(`❌ 资源不可访问 (${response.status}): ${url}`);
                return false;
            }
        } catch (error) {
            if (logCallback) logCallback(`❌ 资源检查失败: ${url} - ${error.message}`);
            return false;
        }
    }

    static async loadFFmpegWithRetry(context = 'window', logCallback = null, maxRetries = 3) {
        const moduleURL = this.getFFmpegModuleURL(context);
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (logCallback) {
                    logCallback(`🔄 尝试加载FFmpeg模块 (第${attempt}次): ${moduleURL}`);
                }
                
                const isAccessible = await this.validateResourceURL(moduleURL, logCallback);
                if (!isAccessible && attempt < maxRetries) {
                    if (logCallback) logCallback(`⚠️ 资源不可访问，将重试...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                
                if (!isAccessible) {
                    throw new Error('资源不可访问');
                }
                
                const module = await import(moduleURL);
                
                if (logCallback) {
                    logCallback(`✅ FFmpeg模块加载成功 (第${attempt}次尝试)`);
                }
                
                return module;
                
            } catch (error) {
                lastError = error;
                
                if (logCallback) {
                    logCallback(`❌ 第${attempt}次加载失败: ${error.message}`);
                }
                
                if (attempt < maxRetries) {
                    if (logCallback) {
                        logCallback(`⏳ 等待${attempt}秒后重试...`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }
        
        throw new Error(`FFmpeg模块加载失败 (尝试${maxRetries}次): ${lastError.message}`);
    }

    static getLoadConfig(context = 'window') {
        return {
            coreURL: this.getFFmpegCoreURL(context),
            wasmURL: this.getFFmpegWasmURL(context)
        };
    }

    static async validateLoadConfig(context = 'window', logCallback = null) {
        const config = this.getLoadConfig(context);
        
        if (logCallback) {
            logCallback('🔍 验证FFmpeg核心文件...');
        }
        
        const coreAccessible = await this.validateResourceURL(config.coreURL, logCallback);
        const wasmAccessible = await this.validateResourceURL(config.wasmURL, logCallback);
        
        if (coreAccessible && wasmAccessible) {
            if (logCallback) {
                logCallback('✅ 所有核心文件都可以访问');
            }
            return { config, valid: true };
        } else {
            if (logCallback) {
                logCallback('❌ 部分核心文件无法访问');
            }
            return { config, valid: false };
        }
    }

    static getConfigInfo(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return {
            baseURL,
            ffmpegModule: this.getFFmpegModuleURL(context),
            ffmpegCore: this.getFFmpegCoreURL(context),
            ffmpegWasm: this.getFFmpegWasmURL(context),
            context,
            timestamp: new Date().toISOString()
        };
    }
}

export default SimpleFFmpegConfig;
