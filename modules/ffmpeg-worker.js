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
            // 如果日志包含时间信息，也发送进度更新
            if (message.includes('time=') && message.includes('fps=')) {
                self.postMessage({
                    type: 'progress',
                    percent: -1, // 表示来自日志
                    time: message // 传递完整的日志消息
                });
            }
            
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
            
        case 'composite':
            await compositeVideo(data);
            break;
            
        default:
            self.postMessage({
                type: 'error',
                message: `未知命令: ${type}`
            });
    }
};

// 合成视频和背景
async function compositeVideo(data) {
    const { videoBuffer, options } = data;
    const { pptBackground, videoScale, overlayPosition, outputSize } = options;
    
    try {
        self.postMessage({ type: 'log', message: '🎬 Worker开始背景合成...' });

        // 写入视频文件
        const videoData = new Uint8Array(videoBuffer);
        await ffmpeg.writeFile('input_video.webm', videoData);
        self.postMessage({ type: 'log', message: `📹 输入视频大小: ${videoData.length} bytes` });

        // 获取PPT背景图片
        self.postMessage({ type: 'log', message: '📋 加载PPT背景图片...' });
        const response = await fetch(pptBackground);
        if (!response.ok) {
            throw new Error(`无法加载PPT图片: ${response.status} ${response.statusText}`);
        }
        
        const pptData = new Uint8Array(await response.arrayBuffer());
        if (pptData.length === 0) {
            throw new Error('PPT图片数据为空');
        }
        
        self.postMessage({ type: 'log', message: `📋 PPT图片大小: ${pptData.length} bytes` });
        await ffmpeg.writeFile('background.jpg', pptData);
        
        // 验证图片是否正确写入
        try {
            const verifyData = await ffmpeg.readFile('background.jpg');
            if (verifyData.length === 0) {
                throw new Error('图片写入失败');
            }
            self.postMessage({ type: 'log', message: `📋 图片验证成功: ${verifyData.length} bytes` });
        } catch (verifyError) {
            throw new Error(`图片验证失败: ${verifyError.message}`);
        }

        self.postMessage({ type: 'log', message: `🎯 合成参数: 视频缩放=${videoScale}, 叠加位置=${overlayPosition}, 输出尺寸=${outputSize}` });
        
        // 解析参数进行验证
        const [scaleW, scaleH] = videoScale.split(':').map(Number);
        const [overlayX, overlayY] = overlayPosition.split(':').map(Number);
        const [outW, outH] = outputSize.split(':').map(Number);
        self.postMessage({ type: 'log', message: `🔍 解析参数: 视频=${scaleW}x${scaleH}, 位置=(${overlayX},${overlayY}), 输出=${outW}x${outH}` });

        // 确保输出尺寸是偶数（H.264要求）
        const [outputWidth, outputHeight] = outputSize.split(':').map(Number);
        const evenWidth = outputWidth % 2 === 0 ? outputWidth : outputWidth + 1;
        const evenHeight = outputHeight % 2 === 0 ? outputHeight : outputHeight + 1;
        const evenOutputSize = `${evenWidth}:${evenHeight}`;
        
        self.postMessage({ type: 'log', message: `📐 调整输出尺寸: ${outputSize} -> ${evenOutputSize} (确保偶数)` });

        // 构建FFmpeg命令 - 修复静态背景与动态视频叠加问题
        const command = [
            '-loop', '1',                     // 循环背景图片
            '-i', 'background.jpg',           // 背景图片
            '-i', 'input_video.webm',         // 输入视频
            '-filter_complex', 
            `[0:v]scale=${evenOutputSize}[bg];[1:v]scale=${videoScale}[small];[bg][small]overlay=${overlayPosition}:shortest=1[v]`,
            '-map', '[v]',                    // 映射合成的视频流
            '-map', '1:a',                    // 映射原视频的音频流
            '-c:v', 'libx264',                // H.264编码
            '-preset', 'fast',                // 快速预设
            '-crf', '23',                     // 质量设置
            '-c:a', 'aac',                    // AAC音频
            '-b:a', '128k',                   // 音频比特率
            '-pix_fmt', 'yuv420p',           // 像素格式
            '-avoid_negative_ts', 'make_zero', // 避免时间戳问题
            '-t', '30',                       // 限制最长30秒（防止卡死）
            'output_composite.mp4'
        ];

        self.postMessage({ type: 'log', message: `🔧 FFmpeg合成命令: ${command.join(' ')}` });
        
        // 执行前检查输入文件
        try {
            const bgCheck = await ffmpeg.readFile('background.jpg');
            const videoCheck = await ffmpeg.readFile('input_video.webm');
            self.postMessage({ type: 'log', message: `✅ 执行前检查 - 背景图片: ${bgCheck.length} bytes, 视频: ${videoCheck.length} bytes` });
        } catch (error) {
            self.postMessage({ type: 'log', message: `❌ 执行前文件检查失败: ${error.message}` });
        }
        
        self.postMessage({ type: 'log', message: '🔧 执行FFmpeg合成命令...' });
        await ffmpeg.exec(command);
        
        // 执行后检查
        self.postMessage({ type: 'log', message: '✅ FFmpeg命令执行完成，检查输出文件...' });

        // 检查输出文件是否存在
        let outputData;
        try {
            outputData = await ffmpeg.readFile('output_composite.mp4');
            if (!outputData || outputData.length === 0) {
                throw new Error('输出文件为空或不存在');
            }
            self.postMessage({ type: 'log', message: `📤 输出文件大小: ${outputData.length} bytes` });
        } catch (fileError) {
            self.postMessage({ type: 'log', message: `❌ 无法读取输出文件: ${fileError.message}` });
            throw new Error(`合成失败：无法读取输出文件 - ${fileError.message}`);
        }

        // 验证文件大小
        if (outputData.length < 1000) { // 小于1KB可能是无效文件
            self.postMessage({ type: 'log', message: `❌ 输出文件太小 (${outputData.length} bytes)，可能合成失败` });
            throw new Error('合成失败：输出文件太小，可能损坏');
        }

        // 清理临时文件
        await ffmpeg.deleteFile('input_video.webm');
        await ffmpeg.deleteFile('background.jpg');
        await ffmpeg.deleteFile('output_composite.mp4');

        self.postMessage({ type: 'log', message: '✅ Worker背景合成完成！' });
        self.postMessage({ 
            type: 'composite_complete', 
            buffer: outputData.buffer 
        }, [outputData.buffer]);

    } catch (error) {
        self.postMessage({ type: 'log', message: `❌ Worker合成失败: ${error.message}` });
        self.postMessage({ type: 'error', message: error.message });
    }
}
