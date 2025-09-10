const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.argv[2] || 8001;

// 设置静态文件服务
app.use(express.static('.', {
    setHeaders: (res, path, stat) => {
        // 设置CORS头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        
        // 设置媒体文件的MIME类型
        if (path.endsWith('.webm')) {
            res.setHeader('Content-Type', 'video/webm');
        } else if (path.endsWith('.mp3')) {
            res.setHeader('Content-Type', 'audio/mpeg');
        } else if (path.endsWith('.wav')) {
            res.setHeader('Content-Type', 'audio/wav');
        }
    }
}));

// 处理OPTIONS请求
app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.sendStatus(200);
});

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 检查是否有SSL证书
const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    // 使用HTTPS
    const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };
    
    https.createServer(options, app).listen(PORT, () => {
        console.log(`🔒 HTTPS服务器运行在 https://localhost:${PORT}`);
        console.log('✅ 支持媒体设备访问 (getUserMedia)');
    });
} else {
    // 使用HTTP (仅用于开发)
    app.listen(PORT, () => {
        console.log(`🌐 HTTP服务器运行在 http://localhost:${PORT}`);
        console.log('⚠️  注意: 某些浏览器在HTTP下可能不支持getUserMedia');
        console.log('💡 建议: 使用Chrome并允许不安全的本地主机访问');
        console.log('   或者生成SSL证书以启用HTTPS');
    });
}

// 生成自签名证书的说明
// console.log('\n📋 如需HTTPS支持，请运行以下命令生成自签名证书:');
// console.log('openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes');
// console.log('然后重启服务器即可使用HTTPS\n');
