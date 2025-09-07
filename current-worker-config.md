# 当前Worker配置报告

## Worker架构概览

### 1. 线程结构
- **主线程**: 用户界面和控制逻辑
- **Web Worker**: FFmpeg转换处理 (`./modules/ffmpeg-worker.js`)
- **FFmpeg内部**: 多线程编码处理

### 2. Worker配置详情

#### 初始化设置
```javascript
// 主页面初始化
converter = new OptimizedFFmpegConverter(true); // 启用Worker模式
```

#### FFmpeg编码参数 (速度优化版)
```javascript
// 普通转换 - 极速模式
{
    preset: 'ultrafast',     // 最快编码预设
    crf: 30-32,              // 降低质量以提升速度
    audioBitrate: '48k-80k', // 降低音频比特率
    audioSampleRate: '22050', // 降低采样率到22kHz
    threads: 0,              // 使用所有CPU核心
    tune: 'zerolatency',     // 零延迟调优
    // x264速度优化参数
    x264params: 'ref=1:me=dia:subme=2:mixed-refs=0:trellis=0:weightp=0:weightb=0:8x8dct=0:fast-pskip=1',
    gop: 30,                 // 减少GOP复杂度
    bframes: 0               // 禁用B帧
}

// 演讲者模式合成
{
    preset: 'fast',          // 稍慢但质量更好
    crf: 23,                 // 更高质量
    audioBitrate: '128k',    // 更高音频质量
    threads: 0               // 使用所有CPU核心
}
```

## Worker性能特性

### 3. 优化机制
- ✅ **Worker复用**: 不再每次取消都重新创建
- ✅ **状态重置**: 清理临时文件，重置内部状态
- ✅ **取消检查点**: 支持任务中途取消
- ✅ **内存管理**: 自动清理临时文件

### 4. 线程利用
- **Web Worker**: 1个专用线程
- **FFmpeg线程**: 自动检测CPU核心数 (`-threads 0`)
- **总线程数**: 1 + CPU核心数

### 5. 内存配置
- **输入缓冲**: 动态分配，基于视频文件大小
- **输出缓冲**: 动态分配，基于转换结果
- **临时文件**: 在Worker内存中处理，自动清理

## 当前性能参数

### 6. 转换速度设置
```javascript
// 速度优先配置
preset: 'ultrafast'    // 最快编码速度
tune: 'zerolatency'    // 零延迟调优
threads: 0             // 多线程并行
```

### 7. 质量平衡 (速度优化)
- **小文件**: CRF 32, 音频 48k (极速模式)
- **中等文件**: CRF 30, 音频 64k (高速模式)
- **大文件**: CRF 28, 音频 80k (快速模式)
- **采样率**: 22kHz (降低50%以提升速度)
- **演讲者模式**: CRF 23, 音频 128k

### 8. 兼容性配置
```javascript
profile: 'baseline'    // 最大兼容性
level: '3.0'          // 广泛支持的H.264级别
pix_fmt: 'yuv420p'    // 标准像素格式
```

## Worker状态管理

### 9. 生命周期
1. **初始化**: 加载FFmpeg WASM (一次性)
2. **转换**: 接收任务，处理视频
3. **取消**: 设置标志，清理状态
4. **重置**: 清理临时文件，准备下次使用
5. **复用**: 继续处理新任务

### 10. 资源管理
- **临时文件**: 自动清理 (input.webm, output.mp4, etc.)
- **内存释放**: 转换完成后释放缓冲区
- **状态重置**: 每次任务后清理内部状态

## 性能特点

### 优势
- 🚀 **不阻塞主线程**: 转换在Worker中进行
- 🔄 **Worker复用**: 避免重复初始化开销
- 🧵 **多线程编码**: 充分利用CPU资源
- 🧹 **自动清理**: 防止内存泄漏

### 当前限制
- ⏱️ **初始化时间**: 首次加载FFmpeg WASM需要2-3秒
- 💾 **内存占用**: 需要足够内存加载WASM和处理视频
- 🌐 **浏览器限制**: 依赖浏览器的Worker和WASM支持

### 速度影响因素
1. **CPU核心数**: 更多核心 = 更快编码
2. **视频分辨率**: 640x480相对较快
3. **编码参数**: ultrafast preset优化速度
4. **浏览器性能**: V8引擎和WASM性能
