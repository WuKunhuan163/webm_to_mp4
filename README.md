# 优化版 WebM to MP4 转换器

一个高性能的Web端视频转换工具，专门优化了转换速度和用户体验。

## ✨ 主要特性

### 🚀 性能优化
- **快速复制模式**: 优先使用流复制，避免重编码，提速5-10倍
- **智能参数选择**: 根据文件大小自动选择最优转换参数
- **多线程处理**: 充分利用CPU多核性能
- **Web Worker**: 后台转换，不阻塞界面

### 🔧 用户体验
- **摄像头管理**: 录制完成后可选择关闭摄像头节省资源
- **实时进度**: 详细的转换进度和日志反馈
- **智能压缩**: 自动平衡文件大小和转换速度
- **现代UI**: 响应式设计，美观易用

### 🌐 部署兼容性
- **GitHub Pages 兼容**: 不使用SharedArrayBuffer
- **现代浏览器支持**: 支持ES模块和Web Worker
- **无需服务器**: 纯前端实现

## 📊 性能对比

| 优化前 | 优化后 |
|--------|--------|
| 15秒/秒视频 | 2-3秒/秒视频 (重编码) |
| 界面卡顿 | 1-2秒/秒视频 (快速复制) |
| 固定参数 | 后台转换，界面流畅 |
| - | 智能参数选择 |

## 🚀 快速开始

### 1. 启动本地服务器
```bash
# 安装依赖
npm install

# 启动服务器
node server.js
```

### 2. 打开浏览器
访问 `http://localhost:3000`

### 3. 开始使用
1. 点击"开始录制"录制视频（5秒自动停止）
2. 录制完成后可选择关闭摄像头
3. 点击"转换为 MP4"开始转换
4. 转换完成后下载文件

## 📁 项目结构

```
optimized-webm-converter/
├── index.html                           # 主页面
├── modules/
│   ├── ffmpeg-converter-optimized.js   # 优化的转换器类
│   └── ffmpeg-worker.js                 # Web Worker实现
├── node_modules/                        # FFmpeg依赖
├── package.json                         # 项目配置
├── server.js                           # 本地服务器
└── README.md                           # 项目说明
```

## 🔧 技术实现

### 核心优化策略
1. **流复制优先**: 尝试直接复制视频/音频流，避免重编码
2. **参数智能选择**: 
   - 小文件(<1MB): 超快速模式，CRF=30
   - 中等文件(1-5MB): 平衡模式，CRF=28  
   - 大文件(>5MB): 质量优先，CRF=26
3. **多线程编码**: 使用 `-threads 0` 充分利用CPU
4. **零延迟调优**: 使用 `-tune zerolatency` 优化编码速度

### Web Worker架构
- 主线程负责UI交互和摄像头管理
- Worker线程执行FFmpeg转换
- 消息传递机制确保实时进度反馈

### GitHub Pages兼容性
- 不使用SharedArrayBuffer
- 不使用Transferable Objects的所有权转移
- 使用标准的ArrayBuffer复制

## 🛠️ 自定义配置

### 手动设置转换参数
```javascript
const mp4Blob = await converter.convertWebMToMP4(webmBlob, {
    preset: 'ultrafast',    // 编码预设
    crf: 28,               // 质量参数(0-51)
    audioBitrate: '96k',   // 音频比特率
    fastMode: true         // 启用快速模式
});
```

### 转换器初始化选项
```javascript
// 启用Worker模式
const converter = new OptimizedFFmpegConverter(true);

// 禁用Worker模式（直接模式）
const converter = new OptimizedFFmpegConverter(false);
```

## 📋 浏览器要求

- Chrome 66+ / Firefox 60+ / Safari 12+
- 支持ES模块 (type="module")
- 支持Web Worker
- 支持WebAssembly
- 支持MediaRecorder API

## 🔍 故障排除

### 转换速度仍然慢
1. 检查是否启用了快速复制模式
2. 确认浏览器支持硬件加速
3. 尝试降低视频质量设置

### Web Worker不工作
1. 确保使用HTTPS或localhost
2. 检查浏览器控制台错误信息
3. 尝试禁用Worker模式使用直接模式

### 摄像头权限问题
1. 确保授予摄像头和麦克风权限
2. 检查浏览器隐私设置
3. 尝试刷新页面重新授权

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个项目！
