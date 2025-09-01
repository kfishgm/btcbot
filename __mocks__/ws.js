// Manual mock for ws module
const EventEmitter = require("events");

class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;

    // Store instance for test access
    MockWebSocket.lastInstance = this;

    // Mock functions
    this.send = jest.fn();
    this.ping = jest.fn();
    this.pong = jest.fn();
    this.close = jest.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
      setImmediate(() => this.emit("close"));
    });
    this.terminate = jest.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
      setImmediate(() => this.emit("close"));
    });

    // Simulate connection opening
    setImmediate(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.emit("open");
      }
    });
  }
}

// Export as default
export default MockWebSocket;
