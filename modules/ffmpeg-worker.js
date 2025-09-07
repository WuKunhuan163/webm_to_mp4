/**
 * FFmpeg Web Worker - GitHub Pages 兼容版本
 * 在独立线程中执行FFmpeg转换，避免阻塞主线程
 * 不使用SharedArrayBuffer，确保GitHub Pages兼容性
 */

let ffmpeg = null;
let isLoaded = false;

// 导入FFmpeg
async function initFFmpeg() {
    if (isLoaded) return;
    
    try {
        // 在Worker中导入FFmpeg
        const { FFmpeg } = await import('../node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
        ffmpeg = new FFmpeg();
        
        // 设置事件监听
        ffmpeg.on('log', ({ message }) => {
            self.postMessage({
                type: 'log',
                message: `[FFmpeg Worker] ${message}`
            });
        });

        ffmpeg.on('progress', ({ progress, time }) => {
            const percent = Math.round(progress * 100);
            const timeInSeconds = time > 1000000 ? (time / 1000000).toFixed(2) : time.toFixed(2);
            self.postMessage({
                type: 'progress',
                percent: percent,
                time: timeInSeconds
            });
        });

        // 加载FFmpeg核心
        const baseURL = new URL('../', self.location.href).href;
        const coreURL = baseURL + 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js';
        const wasmURL = baseURL + 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm';
        
        await ffmpeg.load({
            coreURL: coreURL,
            wasmURL: wasmURL,
        });

        isLoaded = true;
        self.postMessage({
            type: 'initialized',
            success: true
        });
        
    } catch (error) {
        self.postMessage({
            type: 'error',
            message: `FFmpeg Worker 初始化失败: ${error.message}`
        });
    }
}

// 转换函数
async function convertVideo(data) {
    if (!isLoaded) {
        throw new Error('FFmpeg Worker 未初始化');
    }
    
    const { webmBuffer, options = {} } = data;
    
    const {
        preset = 'ultrafast',
        crf = 28,
        audioBitrate = '96k',
        fastMode = true
    } = options;

    try {
        self.postMessage({ type: 'log', message: '开始转换 WebM 到 MP4...' });

        // 写入输入文件
        const inputData = new Uint8Array(webmBuffer);
        await ffmpeg.writeFile('input.webm', inputData);

        let command = ['-i', 'input.webm'];

        // 始终使用重编码模式以确保兼容性
        self.postMessage({ type: 'log', message: '使用重编码模式确保MP4兼容性...' });
        command = command.concat([
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

        // 执行转换
        await ffmpeg.exec(command);
        self.postMessage({ type: 'log', message: 'H.264/AAC重编码完成' });

        // 读取输出文件
        const outputData = await ffmpeg.readFile('output.mp4');
        
        // 清理临时文件
        await ffmpeg.deleteFile('input.webm');
        await ffmpeg.deleteFile('output.mp4');

        // 发送结果 - 不使用Transferable Objects以确保兼容性
        self.postMessage({
            type: 'completed',
            buffer: outputData.buffer.slice() // 复制buffer而不是转移
        });

    } catch (error) {
        self.postMessage({
            type: 'error',
            message: `转换失败: ${error.message}`
        });
        
        // 如果快速模式失败，尝试标准模式
        if (options.fastMode !== false) {
            self.postMessage({ type: 'log', message: '快速模式失败，尝试标准重编码...' });
            return convertVideo({
                webmBuffer,
                options: { ...options, fastMode: false }
            });
        }
    }
}

// Worker消息处理
self.onmessage = async function(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'init':
            await initFFmpeg();
            break;
            
        case 'convert':
            await convertVideo(data);
            break;
            
        default:
            self.postMessage({
                type: 'error',
                message: `未知命令: ${type}`
            });
    }
};
