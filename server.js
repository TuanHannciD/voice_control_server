const puppeteer = require('puppeteer');
const { WebSocketServer } = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Cấu hình domain
const DOMAIN = 'voiceapp.pp.ua';

// Tạo HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Cấu hình WebSocket server với CORS và keep-alive
const wss = new WebSocketServer({ 
  server,
  // Cho phép kết nối từ mọi origin
  verifyClient: () => true,
  // Thêm cấu hình keep-alive
  clientTracking: true,
  // Tăng timeout
  perMessageDeflate: false
});

let browser, page;
let connectedClients = new Set();
let heartbeatInterval;
let isBrowserReady = false;

const account = "TNCH3";
const password = "Ckok1123@";

// Hàm gửi dữ liệu tới tất cả client đang kết nối
function broadcast(data) {
  connectedClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('❌ Lỗi khi gửi dữ liệu:', error);
        connectedClients.delete(client);
      }
    }
  });
}

// Hàm gửi heartbeat để giữ kết nối
function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    broadcast({ type: 'heartbeat', timestamp: Date.now() });
  }, 30000); // Gửi heartbeat mỗi 30 giây
}

// Hàm dừng heartbeat
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
}

// Hàm kiểm tra và dọn dẹp các kết nối đã đóng
function cleanupConnections() {
  connectedClients.forEach(client => {
    if (client.readyState !== 1) { // Không phải OPEN
      connectedClients.delete(client);
    }
  });
}

// Chạy cleanup định kỳ
setInterval(cleanupConnections, 60000); // Mỗi phút

async function launchBrowser() {
  console.log('🚀 Đang khởi chạy trình duyệt Puppeteer...');
  try {
    browser = await puppeteer.launch({ 
      headless: false, 
      defaultViewport: null,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });
    
    page = await browser.newPage();

    // Thêm listener cho sự kiện thay đổi trong ô search
    await page.evaluateOnNewDocument(() => {
      const searchInput = document.querySelector('input[type="search"]');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          window.dispatchEvent(new CustomEvent('searchChange', {
            detail: e.target.value
          }));
        });
      }
    });

    // Lắng nghe sự kiện thay đổi từ trang web
    page.on('console', msg => {
      if (msg.text().includes('searchChange')) {
        const searchValue = msg.text().split(':')[1];
        broadcast({ type: 'searchUpdate', value: searchValue });
      }
    });

    console.log('🌐 Đang mở trang đăng nhập...');
    await page.goto('https://organic.mshopkeeper.vn/Login?language=vi-VN', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    try {
      console.log('⌛ Đang đợi input tài khoản hiển thị...');
      await page.waitForSelector('input[id="txtUserName"]', { timeout: 15000 });

      console.log(`⌨️ Đang nhập tài khoản: ${account}`);
      await page.type('input[id="txtUserName"]', account, { delay: 100 });

      console.log('🔑 Đang nhập mật khẩu...');
      await page.type('input[id="txtPassword"]', password, { delay: 100 });

      await page.keyboard.press('Enter');
      console.log('⏳ Chờ trang chính load...');
      
      // Đợi chuyển hướng hoặc load xong
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 })
        .catch(() => console.log('⚠️ Không có navigation, tiếp tục...'));
      
      await new Promise(resolve => setTimeout(resolve, 3000));

      const currentUrl = page.url();
      console.log('📍 URL hiện tại:', currentUrl);
      
      isBrowserReady = true;
      console.log('✅ Browser đã sẵn sàng!');

    } catch (err) {
      console.error('❌ Lỗi trong quá trình đăng nhập:', err);
      isBrowserReady = false;
      // Thử khởi động lại browser nếu có lỗi
      setTimeout(() => {
        if (browser) browser.close();
        launchBrowser();
      }, 5000);
    }
  } catch (error) {
    console.error('❌ Lỗi khởi chạy browser:', error);
    isBrowserReady = false;
    setTimeout(() => {
      if (browser) browser.close();
      launchBrowser();
    }, 5000);
  }
}

wss.on('connection', function connection(ws, req) {
  console.log('✅ Client WebSocket đã kết nối từ:', req.socket.remoteAddress);
  connectedClients.add(ws);

  // Thiết lập timeout cho kết nối
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Gửi trạng thái hiện tại của ô search cho client mới
  if (page && isBrowserReady) {
    page.evaluate(() => {
      const searchInput = document.querySelector('input[type="search"]');
      return searchInput ? searchInput.value : '';
    }).then(value => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'searchUpdate', value }));
      }
    }).catch(error => {
      console.error('❌ Lỗi khi lấy giá trị search:', error);
    });
  }

  // Gửi thông báo kết nối thành công
  ws.send(JSON.stringify({ 
    type: 'connection', 
    status: 'connected', 
    message: 'Kết nối thành công',
    browserReady: isBrowserReady
  }));

  ws.on('message', async function incoming(message) {
    const text = message.toString();
    console.log('📥 Tin nhắn nhận được từ client:', text);

    // Xử lý heartbeat từ client
    try {
      const data = JSON.parse(text);
      if (data.type === 'heartbeat') {
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
        return;
      }
    } catch (e) {
      // Nếu không phải JSON, xử lý như text thông thường
    }

    if (!page || !isBrowserReady) {
      console.log('❌ Trình duyệt chưa sẵn sàng.');
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Trình duyệt chưa sẵn sàng, vui lòng thử lại sau' 
      }));
      return;
    }

    try {
      console.log('🔍 Đang đợi ô tìm kiếm hiển thị...');
      await page.waitForSelector('input[type="search"]', { timeout: 10000 });

      console.log('🎯 Đang nhập nội dung tìm kiếm...');
      await page.focus('input[type="search"]');
      await page.click('input[type="search"]', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('input[type="search"]', text, { delay: 100 });
      await page.keyboard.press('Enter');

      console.log(`✅ Đã tìm kiếm: "${text}"`);
      ws.send(JSON.stringify({ 
        type: 'searchResult', 
        message: `Đã tìm kiếm: ${text}`,
        searchTerm: text
      }));
      
      // Broadcast cho tất cả client khác
      broadcast({ 
        type: 'searchUpdate', 
        value: text,
        timestamp: Date.now()
      });
      
    } catch (err) {
      console.error('⚠️ Lỗi khi tìm kiếm:', err);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Lỗi khi tìm kiếm, vui lòng thử lại' 
      }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log('👋 Client đã ngắt kết nối. Code:', code, 'Reason:', reason);
    connectedClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('❌ Lỗi WebSocket:', error);
    connectedClients.delete(ws);
  });
});

// Kiểm tra kết nối định kỳ
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('💀 Kết nối timeout, đóng kết nối');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // Kiểm tra mỗi 30 giây

wss.on('close', function close() {
  clearInterval(interval);
  stopHeartbeat();
});

// Xử lý tắt server gracefully
process.on('SIGINT', () => {
  console.log('🛑 Đang tắt server...');
  stopHeartbeat();
  if (browser) {
    browser.close();
  }
  wss.close();
  server.close();
  process.exit(0);
});

// Khởi động server và Cloudflare Tunnel
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🌐 WebSocket server đang chạy tại port ${PORT}`);
  
  // Bắt đầu heartbeat
  startHeartbeat();
  
  try {
    // Khởi động Cloudflare Tunnel với tên miền cố định
    const tunnel = spawn(`cloudflared tunnel --url http://localhost:${PORT} --hostname ${DOMAIN}`, {
      shell: true
    });

    tunnel.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('📡 Cloudflare Tunnel:', output);
      
      // Tìm URL trong output của Cloudflare
      if (output.includes('https://')) {
        console.log('🚀 Cloudflare Tunnel URL:', `wss://${DOMAIN}`);
        console.log('📝 Sử dụng URL trên để kết nối từ thiết bị khác mạng');
      }
    });

    tunnel.stderr.on('data', (data) => {
      console.error('❌ Cloudflare Tunnel Error:', data.toString());
    });

    tunnel.on('close', (code) => {
      console.log(`❌ Cloudflare Tunnel đã đóng với mã: ${code}`);
    });

  } catch (err) {
    console.error('❌ Lỗi khi khởi động Cloudflare Tunnel:', err);
  }

  launchBrowser()
    .then(() => {
      console.log('🌐 Puppeteer đã sẵn sàng');
    })
    .catch(err => {
      console.error('🚨 Lỗi khởi chạy browser:', err);
    }); 
});