// Cấu hình WebSocket Server
module.exports = {
  // Cấu hình heartbeat
  heartbeat: {
    interval: 30000, // 30 giây
    timeout: 60000,  // 60 giây
  },
  
  // Cấu hình kết nối
  connection: {
    maxPayload: 1024 * 1024, // 1MB
    perMessageDeflate: false,
    clientTracking: true,
  },
  
  // Cấu hình cleanup
  cleanup: {
    interval: 60000, // 1 phút
  },
  
  // Cấu hình timeout
  timeout: {
    search: 5000,    // 5 giây cho tìm kiếm
    login: 10000,    // 10 giây cho đăng nhập
    browser: 30000,  // 30 giây cho browser
  },
  
  // Cấu hình retry
  retry: {
    browser: 5000,   // 5 giây
    maxAttempts: 3,
  }
}; 