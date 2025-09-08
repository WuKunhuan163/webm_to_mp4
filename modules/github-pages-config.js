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
    
    // CDN 回退URL - 使用支持CORS的CDN
    static getCDNUrls() {
        return {
            // 使用 unpkg.com，它对WASM文件有更好的CORS支持
            ffmpegModule: 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js',
            ffmpegCore: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
            ffmpegWasm: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
            // 备用CDN
            backup: {
                ffmpegModule: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js',
                ffmpegCore: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
                ffmpegWasm: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm'
            }
        };
    }

    static getFFmpegModuleURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'ffmpeg-libs/ffmpeg/ffmpeg/dist/esm/index.js';
    }

    static getFFmpegCoreURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'ffmpeg-libs/ffmpeg/core/dist/esm/ffmpeg-core.js';
    }

    static getFFmpegWasmURL(context = 'window') {
        const baseURL = this.getBaseURL(context);
        return baseURL + 'ffmpeg-libs/ffmpeg/core/dist/esm/ffmpeg-core.wasm';
    }

    static async validateResourceURL(url, logCallback = null) {
        try {
            // 对于WASM文件，使用GET请求来检查CORS
            const isWasm = url.endsWith('.wasm');
            const method = isWasm ? 'GET' : 'HEAD';
            
            const response = await fetch(url, { 
                method: method,
                mode: 'cors', // 明确设置CORS模式
                cache: 'no-cache'
            });
            
            if (response.ok) {
                if (logCallback) {
                    const corsInfo = response.headers.get('access-control-allow-origin') ? ' (CORS支持)' : '';
                    logCallback(`✅ 资源可访问: ${url}${corsInfo}`);
                }
                return true;
            } else {
                if (logCallback) logCallback(`❌ 资源不可访问 (${response.status}): ${url}`);
                return false;
            }
        } catch (error) {
            if (logCallback) {
                const corsError = error.message.includes('CORS') || error.message.includes('cors');
                logCallback(`❌ 资源检查失败${corsError ? ' (CORS错误)' : ''}: ${url} - ${error.message}`);
            }
            return false;
        }
    }

    static async loadFFmpegWithRetry(context = 'window', logCallback = null, maxRetries = 3) {
        let lastError = null;
        const cdnUrls = this.getCDNUrls();
        const urls = [
            this.getFFmpegModuleURL(context),  // 本地node_modules
            cdnUrls.ffmpegModule,              // 主要CDN (unpkg)
            cdnUrls.backup.ffmpegModule        // 备用CDN (jsdelivr)
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
                        const sourceType = isLocal ? '本地' : 
                                         (urlIndex === 1 ? 'CDN(unpkg)' : 'CDN(jsdelivr)');
                        logCallback(`🔄 ${sourceType}加载第${attempt}次尝试: ${moduleURL}`);
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
                    
                    // 对于CDN资源，额外检查CORS支持
                    if (!isLocal) {
                        const corsSupported = await this.checkCORSSupport(moduleURL, logCallback);
                        if (!corsSupported) {
                            throw new Error('CORS不支持');
                        }
                    }
                    
                    const module = await import(moduleURL);
                    
                    if (logCallback) {
                        const sourceType = isLocal ? '本地' : 
                                         (urlIndex === 1 ? 'CDN(unpkg)' : 'CDN(jsdelivr)');
                        logCallback(`✅ FFmpeg模块${sourceType}加载成功!`);
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
            
            // 尝试主要CDN (unpkg)
            const cdnUrls = this.getCDNUrls();
            let cdnConfig = {
                coreURL: cdnUrls.ffmpegCore,
                wasmURL: cdnUrls.ffmpegWasm
            };
            
            if (logCallback) {
                logCallback('🌐 验证主CDN (unpkg)资源...');
            }
            
            let cdnCoreAccessible = await this.validateResourceURL(cdnConfig.coreURL, logCallback);
            let cdnWasmAccessible = await this.validateResourceURL(cdnConfig.wasmURL, logCallback);
            
            if (cdnCoreAccessible && cdnWasmAccessible) {
                if (logCallback) {
                    logCallback('✅ 使用主CDN (unpkg) FFmpeg核心文件');
                }
                return { config: cdnConfig, source: 'cdn-unpkg' };
            }
            
            // 尝试备用CDN (jsdelivr)
            if (logCallback) {
                logCallback('⚠️ 主CDN不可用，尝试备用CDN (jsdelivr)...');
            }
            
            cdnConfig = {
                coreURL: cdnUrls.backup.ffmpegCore,
                wasmURL: cdnUrls.backup.ffmpegWasm
            };
            
            cdnCoreAccessible = await this.validateResourceURL(cdnConfig.coreURL, logCallback);
            cdnWasmAccessible = await this.validateResourceURL(cdnConfig.wasmURL, logCallback);
            
            if (cdnCoreAccessible && cdnWasmAccessible) {
                if (logCallback) {
                    logCallback('✅ 使用备用CDN (jsdelivr) FFmpeg核心文件');
                }
                return { config: cdnConfig, source: 'cdn-jsdelivr' };
            } else {
                throw new Error('本地、主CDN和备用CDN资源都不可访问');
            }
        }
    }
    
    // 检查CORS支持
    static async checkCORSSupport(url, logCallback = null) {
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                mode: 'cors'
            });
            
            const corsHeader = response.headers.get('access-control-allow-origin');
            const hasCORS = corsHeader === '*' || corsHeader === window.location.origin;
            
            if (logCallback) {
                logCallback(`CORS检查 ${url}: ${hasCORS ? '✅ 支持' : '❌ 不支持'}`);
            }
            
            return hasCORS;
        } catch (error) {
            if (logCallback) {
                logCallback(`CORS检查失败 ${url}: ${error.message}`);
            }
            return false;
        }
    }
}

export default GitHubPagesConfig;
