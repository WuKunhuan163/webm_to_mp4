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
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const moduleURL = this.getFFmpegModuleURL(context);
                
                if (logCallback) {
                    logCallback(`🔄 尝试加载FFmpeg模块 (第${attempt}次): ${moduleURL}`);
                }
                
                // 验证资源是否可访问
                const isAccessible = await this.validateResourceURL(moduleURL, logCallback);
                if (!isAccessible && attempt < maxRetries) {
                    if (logCallback) logCallback(`⚠️ 资源不可访问，将重试...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
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
                } else {
                    if (logCallback) {
                        logCallback(`💥 所有重试都失败了，最后一次错误: ${error.message}`);
                    }
                    throw new Error(`FFmpeg模块加载失败 (尝试${maxRetries}次): ${lastError.message}`);
                }
            }
        }
    }

    static getLoadConfig(context = 'window') {
        return {
            coreURL: this.getFFmpegCoreURL(context),
            wasmURL: this.getFFmpegWasmURL(context)
        };
    }
}

export default GitHubPagesConfig;
