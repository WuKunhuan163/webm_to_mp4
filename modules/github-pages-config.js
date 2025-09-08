/**
 * GitHub Pages 部署配置
 * 处理模块路径和资源加载的兼容性问题
 */

export class GitHubPagesConfig {
    static getBaseURL(context = 'window') {
        // 根据上下文（window 或 worker）获取基础URL
        if (context === 'worker') {
            return new URL('../', self.location.href).href;
        } else {
            return new URL('../', window.location.href).href;
        }
    }
    
    // CDN 回退URL
    static getCDNUrls() {
        return {
            ffmpegModule: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js',
            ffmpegCore: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
            ffmpegWasm: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm'
        };
    }

    static getFFmpegModuleURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'node_modules/@ffmpeg/ffmpeg/dist/esm/index.js';
    }

    static getFFmpegCoreURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js';
    }

    static getFFmpegWasmURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm';
    }

    static async validateResourceURL(url, logCallback = null) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
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
        let lastError = null;
        const urls = [
            this.getFFmpegModuleURL(context),  // 本地node_modules
            this.getCDNUrls().ffmpegModule      // CDN回退
        ];
        
        for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
            const moduleURL = urls[urlIndex];
            const isLocal = urlIndex === 0;
            
            if (logCallback) {
                logCallback(`🔄 尝试${isLocal ? '本地' : 'CDN'}加载: ${moduleURL}`);
            }
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    if (logCallback) {
                        logCallback(`🔄 ${isLocal ? '本地' : 'CDN'}加载第${attempt}次尝试: ${moduleURL}`);
                    }
                    
                    // 验证资源是否可访问
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
                        logCallback(`✅ FFmpeg模块${isLocal ? '本地' : 'CDN'}加载成功!`);
                    }
                    
                    return module;
                    
                } catch (error) {
                    lastError = error;
                    
                    if (logCallback) {
                        logCallback(`❌ ${isLocal ? '本地' : 'CDN'}第${attempt}次尝试失败: ${error.message}`);
                    }
                    
                    if (attempt < maxRetries) {
                        if (logCallback) {
                            logCallback(`⏳ 等待${attempt}秒后重试...`);
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
            }
            
            if (logCallback) {
                logCallback(`❌ ${isLocal ? '本地' : 'CDN'}加载失败，${urlIndex < urls.length - 1 ? '尝试下一个源' : '所有源都失败了'}`);
            }
        }
        
        throw new Error(`FFmpeg模块加载失败（尝试所有源）: ${lastError?.message || '未知错误'}`);
    }

    static getLoadConfig(context = 'window', useCDN = false) {
        if (useCDN) {
            const cdnUrls = this.getCDNUrls();
            return {
                coreURL: cdnUrls.ffmpegCore,
                wasmURL: cdnUrls.ffmpegWasm
            };
        } else {
            return {
                coreURL: this.getFFmpegCoreURL(context),
                wasmURL: this.getFFmpegWasmURL(context)
            };
        }
    }
    
    static async getLoadConfigWithFallback(context = 'window', logCallback = null) {
        // 先尝试本地资源
        const localConfig = this.getLoadConfig(context, false);
        
        if (logCallback) {
            logCallback('🔍 验证本地FFmpeg核心文件...');
        }
        
        const coreAccessible = await this.validateResourceURL(localConfig.coreURL, logCallback);
        const wasmAccessible = await this.validateResourceURL(localConfig.wasmURL, logCallback);
        
        if (coreAccessible && wasmAccessible) {
            if (logCallback) {
                logCallback('✅ 使用本地FFmpeg核心文件');
            }
            return { config: localConfig, source: 'local' };
        } else {
            if (logCallback) {
                logCallback('⚠️ 本地文件不可访问，尝试CDN回退...');
            }
            
            const cdnConfig = this.getLoadConfig(context, true);
            
            // 验证CDN资源
            const cdnCoreAccessible = await this.validateResourceURL(cdnConfig.coreURL, logCallback);
            const cdnWasmAccessible = await this.validateResourceURL(cdnConfig.wasmURL, logCallback);
            
            if (cdnCoreAccessible && cdnWasmAccessible) {
                if (logCallback) {
                    logCallback('✅ 使用CDN FFmpeg核心文件');
                }
                return { config: cdnConfig, source: 'cdn' };
            } else {
                throw new Error('本地和CDN资源都不可访问');
            }
        }
    }
}

export default GitHubPagesConfig;
