const puppeteer = require('puppeteer');
const { WebSocketServer } = require('ws');
const http = require('http');
const { spawn } = require('child_process');

// Tạo HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Cấu hình WebSocket server với CORS
const wss = new WebSocketServer({ 
  server,
  // Cho phép kết nối từ mọi origin
  verifyClient: () => true
});

let browser, page;
let connectedClients = new Set();

const account = "TNCH3";
const password = "Ckok1123@";

// Hàm gửi dữ liệu tới tất cả client đang kết nối
function broadcast(data) {
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

async function launchBrowser() {
  console.log('🚀 Đang khởi chạy trình duyệt Puppeteer...');
  browser = await puppeteer.launch({ 
    headless: false, 
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
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
  await page.goto('https://organic.mshopkeeper.vn/Login?language=vi-VN');

  try {
    console.log('⌛ Đang đợi input tài khoản hiển thị...');
    await page.waitForSelector('input[id="txtUserName"]', { timeout: 10000 });

    console.log(`⌨️ Đang nhập tài khoản: ${account}`);
    await page.type('input[id="txtUserName"]', account, { delay: 100 });

    console.log('🔑 Đang nhập mật khẩu...');
    await page.type('input[id="txtPassword"]', password, { delay: 100 });

    await page.keyboard.press('Enter', { delay: 2000 });
    console.log('⏳ Chờ trang chính load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const currentUrl = page.url();
    console.log('📍 URL hiện tại:', currentUrl);

  } catch (err) {
    console.error('❌ Lỗi trong quá trình đăng nhập:', err);
    // Thử khởi động lại browser nếu có lỗi
    setTimeout(launchBrowser, 5000);
  }
}

wss.on('connection', function connection(ws) {
  console.log('✅ Client WebSocket đã kết nối.');
  connectedClients.add(ws);

  // Gửi trạng thái hiện tại của ô search cho client mới
  if (page) {
    page.evaluate(() => {
      const searchInput = document.querySelector('input[type="search"]');
      return searchInput ? searchInput.value : '';
    }).then(value => {
      ws.send(JSON.stringify({ type: 'searchUpdate', value }));
    });
  }

  ws.on('message', async function incoming(message) {
    const text = message.toString();
    console.log('📥 Tin nhắn nhận được từ client:', text);

    if (!page) {
      console.log('❌ Trình duyệt chưa sẵn sàng.');
      return;
    }

    try {
      console.log('🔍 Đang đợi ô tìm kiếm hiển thị...');
      await page.waitForSelector('input[type="search"]', { timeout: 5000 });

      console.log('🎯 Đang nhập nội dung tìm kiếm...');
      await page.focus('input[type="search"]');
      await page.click('input[type="search"]', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('input[type="search"]', text, { delay: 100 });
      await page.keyboard.press('Enter');

      console.log(`✅ Đã tìm kiếm: "${text}"`);
    } catch (err) {
      console.error('⚠️ Lỗi khi tìm kiếm:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Lỗi khi tìm kiếm' }));
    }
  });

  ws.on('close', () => {
    console.log('👋 Client đã ngắt kết nối');
    connectedClients.delete(ws);
  });
});

// Khởi động server và Cloudflare Tunnel
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🌐 WebSocket server đang chạy tại port ${PORT}`);
  
  try {
    // Khởi động Cloudflare Tunnel
    const tunnel = spawn(`cloudflared tunnel --url http://localhost:${PORT} --no-autoupdate`, {
      shell: true
    });

    tunnel.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('📡 Cloudflare Tunnel:', output);
      
      // Tìm URL trong output
      const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (urlMatch) {
        const wsUrl = urlMatch[0].replace('https://', 'wss://');
        console.log('🚀 WebSocket URL:', wsUrl);
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