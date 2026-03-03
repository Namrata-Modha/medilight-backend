const express = require("express");
const http = require("http");
const swaggerUi = require("swagger-ui-express");

// Core modules
const { initDB } = require("./db");
const { setupWebSocket } = require("./websocket");
const swaggerSpec = require("./swagger");

// Route modules
const healthRoutes = require("./routes/health");
const inventoryRoutes = require("./routes/inventory");
const orderRoutes = require("./routes/orders");
const ocrRoutes = require("./routes/ocr");
const verificationRoutes = require("./routes/verification");
const ledRoutes = require("./routes/led");
const auditRoutes = require("./routes/audit");
const testRoutes = require("./routes/tests");

// ─── Express App ──────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── WebSocket ────────────────────────────────────────────────
setupWebSocket(server);

// ─── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── Swagger UI ───────────────────────────────────────────────
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: `.swagger-ui .topbar { background: #0f172a; } .swagger-ui .info .title { color: #22c55e; }`,
  customSiteTitle: "MediLight API — Swagger",
}));
app.get("/", (req, res) => res.redirect("/api/docs"));

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/health", healthRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/ocr", ocrRoutes);
app.use("/api/verify-id", verificationRoutes);
app.use("/api/led", ledRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/test", testRoutes);

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[MediLight] Server on port ${PORT}`);
    console.log(`[MediLight] Swagger UI → http://localhost:${PORT}/api/docs`);
    console.log(`[MediLight] Test Suite → http://localhost:${PORT}/api/test/run-all`);
  });
});
