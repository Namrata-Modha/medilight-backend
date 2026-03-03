// websocket.js — WebSocket server for ESP32 shelf LED devices

let wss = null;

/**
 * Attach WebSocket server to an existing HTTP server.
 * @param {http.Server} server
 */
function setupWebSocket(server) {
  try {
    const { WebSocketServer } = require("ws");
    wss = new WebSocketServer({ server });

    wss.on("connection", (ws) => {
      console.log(`[WS] Device connected (total: ${wss.clients.size})`);
      ws.on("close", () =>
        console.log(`[WS] Device disconnected (total: ${wss.clients.size})`)
      );
    });

    console.log("[WS] WebSocket server ready");
  } catch {
    console.warn("[WS] ws module not installed — WebSocket disabled");
  }
}

/**
 * Send JSON payload to all connected devices.
 * @param {object} payload - LED command or other message
 * @returns {number} Number of devices that received the message
 */
function broadcast(payload) {
  if (!wss) return 0;
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(payload));
      sent++;
    }
  });
  return sent;
}

/**
 * @returns {number} Number of currently connected WebSocket clients
 */
function deviceCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = { setupWebSocket, broadcast, deviceCount };
