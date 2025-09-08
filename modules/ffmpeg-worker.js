/**
 * FFmpeg Web Worker - GitHub Pages 兼容版本
 * 在独立线程中执行FFmpeg转换，避免阻塞主线程
 * 不使用SharedArrayBuffer，确保GitHub Pages兼容性
 */

import PathResolver from './path-resolver.js';

let ffmpeg = null;
let isLoaded = false;
let currentTask = null; // 当前执行的任务
let isCancelled = false; // 取消标志

// 导入FFmpeg
async function initFFmpeg() {
    if (isLoaded) return;
    
    try {
        // 在Worker中导入FFmpeg - GitHub Pages兼容版本
        const logCallback = (message) => {
            self.postMessage({
                type: 'log',
                message: `[FFmpeg Worker] ${message}`
            });
        };
        
        const module = await PathResolver.loadFFmpegWithRetry('worker', logCallback);
        const { FFmpeg } = module;
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

        // 加载FFmpeg核心 - 使用最简化路径
        const { config: loadConfig, valid } = await PathResolver.validateLoadConfig('worker', logCallback);
        
        if (!valid) {
            throw new Error('所需的FFmpeg核心文件不可访问');
        }
        
        self.postMessage({
            type: 'log',
            message: `[FFmpeg Worker] 使用简化路径核心文件: ${loadConfig.coreURL}`
        });
        
        self.postMessage({
            type: 'log',
            message: `[FFmpeg Worker] 使用简化路径WASM文件: ${loadConfig.wasmURL}`
        });
        
        await ffmpeg.load(loadConfig);

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
        crf = 35,                // 更激进的质量降低
        audioBitrate = '32k',    // 极低音频比特率
        fastMode = true
    } = options;

    try {
        self.postMessage({ type: 'log', message: '开始转换 WebM 到 MP4...' });

        // 检查是否被取消
        if (isCancelled) {
            throw new Error('转换已被用户取消');
        }

        // 写入输入文件
        const inputData = new Uint8Array(webmBuffer);
        await ffmpeg.writeFile('input.webm', inputData);

        let command = ['-i', 'input.webm'];

        // 始终使用重编码模式以确保兼容性
        self.postMessage({ type: 'log', message: '使用重编码模式确保MP4兼容性...' });
        command = command.concat([
            '-c:v', 'libx264',
            '-preset', preset,
            '-tune', 'zerolatency',
            '-crf', crf.toString(),
            '-pix_fmt', 'yuv420p',
            '-profile:v', 'baseline',
            '-level:v', '3.0',
            // 修复帧率和时间戳问题
            '-r', '30',                  // 强制输出帧率为30fps
            '-vsync', 'cfr',             // 恒定帧率，避免重复帧
            '-fps_mode', 'cfr',          // 确保恒定帧率模式
            // 极速优化参数（简化）
            '-x264-params', 'ref=1:me=dia:subme=1:mixed-refs=0:trellis=0:weightp=0:weightb=0:8x8dct=0:fast-pskip=1',
            '-g', '30',                  // 恢复合理的GOP大小
            '-bf', '0',                  // 禁用B帧
            '-sc_threshold', '40',       // 恢复场景切换检测但设置较高阈值
            // 音频设置
            '-c:a', 'aac',
            '-b:a', audioBitrate,
            '-ac', '1',                  // 单声道
            '-ar', '16000',              // 16kHz采样率
            '-movflags', '+faststart',
            '-threads', '0',
            '-avoid_negative_ts', 'make_zero', // 修复时间戳问题
            '-f', 'mp4',
            'output.mp4'
        ]);

        // 执行转换前再次检查取消状态
        if (isCancelled) {
            throw new Error('转换已被用户取消');
        }

        // 执行转换
        await ffmpeg.exec(command);
        
        // 转换完成后检查取消状态
        if (isCancelled) {
            throw new Error('转换已被用户取消');
        }
        
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

// 取消当前任务
function cancelCurrentTask() {
    isCancelled = true;
    if (currentTask) {
        self.postMessage({ type: 'log', message: '🛑 Worker收到取消请求，准备强制终止' });
        // FFmpeg.wasm无法中途取消，强制关闭Worker是唯一可靠方式
        setTimeout(() => {
            self.postMessage({ type: 'log', message: '🛑 强制关闭Worker进程' });
            self.close();
        }, 100); // 短暂延迟确保消息发送
    }
}

// 重置Worker状态
async function resetWorkerState() {
    isCancelled = false;
    currentTask = null;
    
    // 清理可能残留的临时文件
    if (ffmpeg && isLoaded) {
        try {
            const files = ['input.webm', 'output.mp4', 'input_video.webm', 'background.jpg', 'output_composite.mp4'];
            for (const file of files) {
                try {
                    await ffmpeg.deleteFile(file);
                } catch (e) {
                    // 文件可能不存在，忽略错误
                }
            }
            self.postMessage({ type: 'log', message: 'Worker状态已重置' });
        } catch (error) {
            self.postMessage({ type: 'log', message: `⚠️ 清理临时文件时出错: ${error.message}` });
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
            // 转换前先重置状态
            await resetWorkerState();
            currentTask = 'convert';
            isCancelled = false;
            await convertVideo(data);
            currentTask = null;
            break;
            
        case 'composite':
            // 合成前先重置状态
            await resetWorkerState();
            currentTask = 'composite';
            isCancelled = false;
            await compositeVideo(data);
            currentTask = null;
            break;
            
        case 'cancel':
            cancelCurrentTask();
            break;
            
        case 'reset':
            await resetWorkerState();
            self.postMessage({ type: 'reset_complete' });
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
    const { pptBackground, videoScale, overlayPosition, outputSize, autoTrimStart = true } = options;
    
    try {
        self.postMessage({ type: 'log', message: '🎬 Worker开始背景合成...' });

        // 写入视频文件
        const videoData = new Uint8Array(videoBuffer);
        await ffmpeg.writeFile('input_video.webm', videoData);
        self.postMessage({ type: 'log', message: `📹 输入视频大小: ${videoData.length} bytes` });

        // 检测视频开始时间（可选）
        let startTime = 0;
        if (autoTrimStart) {
            // 简化实现：暂时不进行复杂的检测
            self.postMessage({ type: 'log', message: '📹 自动裁剪功能已启用，但暂时不执行复杂检测' });
            startTime = 0; // 保持为0，避免复杂的Worker间通信
        }

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
        ];
        
        // 如果需要裁剪开头，添加 -ss 参数
        if (startTime > 0) {
            command.push('-ss', startTime.toString());
        }
        
        command.push(
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
        );

        self.postMessage({ type: 'log', message: `🔧 FFmpeg合成命令: ${command.join(' ')}` });
        
        // 执行前检查输入文件
        try {
            const bgCheck = await ffmpeg.readFile('background.jpg');
            const videoCheck = await ffmpeg.readFile('input_video.webm');
            self.postMessage({ type: 'log', message: `✅ 执行前检查 - 背景图片: ${bgCheck.length} bytes, 视频: ${videoCheck.length} bytes` });
        } catch (error) {
            self.postMessage({ type: 'log', message: `❌ 执行前文件检查失败: ${error.message}` });
        }
        
        // 执行前检查取消状态
        if (isCancelled) {
            self.postMessage({ type: 'log', message: '🛑 任务已取消，停止执行' });
            throw new Error('Task cancelled before execution');
        }
        
        self.postMessage({ type: 'log', message: '🔧 执行FFmpeg合成命令...' });
        
        // 由于FFmpeg.wasm无法中途取消，我们需要在这里强制重启Worker
        if (isCancelled) {
            self.postMessage({ type: 'log', message: '🛑 强制终止Worker进程' });
            self.close(); // 强制关闭Worker
            return;
        }
        
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
