# Hướng dẫn khắc phục vấn đề kết nối WebSocket

## Vấn đề: Kết nối bị ngắt sau một khoảng thời gian ngắn

### Nguyên nhân có thể:

1. **Thiếu cơ chế keep-alive**
   - WebSocket không có heartbeat
   - Timeout do không hoạt động

2. **Lỗi mạng**
   - Kết nối mạng không ổn định
   - Firewall chặn kết nối

3. **Cloudflare Tunnel timeout**
   - Tunnel tự động đóng sau thời gian không hoạt động

4. **Lỗi server**
   - Browser Puppeteer bị crash
   - Memory leak

### Giải pháp đã áp dụng:

#### 1. Thêm cơ chế Heartbeat
```javascript
// Gửi heartbeat mỗi 30 giây
function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    broadcast({ type: 'heartbeat', timestamp: Date.now() });
  }, 30000);
}
```

#### 2. Kiểm tra kết nối định kỳ
```javascript
// Kiểm tra mỗi 30 giây
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
```

#### 3. Xử lý lỗi tốt hơn
- Thêm try-catch cho tất cả operations
- Cleanup kết nối đã đóng
- Retry mechanism cho browser

#### 4. Cấu hình WebSocket tối ưu
```javascript
const wss = new WebSocketServer({ 
  server,
  verifyClient: () => true,
  clientTracking: true,
  perMessageDeflate: false
});
```

### Cách kiểm tra:

1. **Xem log server:**
   ```bash
   npm start
   ```
   Tìm các log:
   - `✅ Client WebSocket đã kết nối`
   - `💀 Kết nối timeout, đóng kết nối`
   - `👋 Client đã ngắt kết nối`

2. **Kiểm tra client:**
   - Đảm bảo client xử lý heartbeat
   - Implement reconnect logic

### Client-side code mẫu:

```javascript
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.onopen = () => {
      console.log('Kết nối thành công');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'heartbeat') {
        // Trả lời heartbeat
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    };

    this.ws.onclose = () => {
      console.log('Kết nối đã đóng');
      this.reconnect();
    };

    this.ws.onerror = (error) => {
      console.error('Lỗi WebSocket:', error);
    };
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Thử kết nối lại lần ${this.reconnectAttempts}`);
      setTimeout(() => this.connect(), 5000);
    }
  }
}
```

### Các bước khắc phục:

1. **Khởi động lại server:**
   ```bash
   npm start
   ```

2. **Kiểm tra Cloudflare Tunnel:**
   - Đảm bảo tunnel đang chạy
   - Kiểm tra domain `voiceapp.pp.ua`

3. **Kiểm tra firewall:**
   - Mở port 3000
   - Cho phép Cloudflare Tunnel

4. **Monitor logs:**
   - Theo dõi console output
   - Kiểm tra lỗi browser

### Cấu hình bổ sung:

Nếu vẫn gặp vấn đề, có thể thử:

1. **Tăng timeout:**
   ```javascript
   // Trong websocket-config.js
   heartbeat: {
     interval: 15000, // Giảm xuống 15 giây
     timeout: 45000,  // Giảm xuống 45 giây
   }
   ```

2. **Thêm proxy settings:**
   ```javascript
   // Trong server.js
   const tunnel = spawn(`cloudflared tunnel --url http://localhost:${PORT} --hostname ${DOMAIN} --loglevel debug`, {
     shell: true
   });
   ```

3. **Kiểm tra memory usage:**
   ```bash
   # Monitor memory
   node --max-old-space-size=4096 server.js
   ``` 