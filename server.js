const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// ─── CORS + Socket.io ────────────────────────────────────────────
const FRONTEND_URLS = (
  process.env.FRONTEND_URLS ||
  "http://localhost:5173,http://localhost:3000,http://localhost:4173"
).split(",").map(u => u.trim());

const io = new Server(server, {
  cors: { origin: FRONTEND_URLS, methods: ["GET", "POST"] },
});

app.use(cors({ origin: FRONTEND_URLS }));
app.use(express.json({ limit: "10mb" }));

// ─── MongoDB ─────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/medilight";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("  ✅ MongoDB connected"))
  .catch((err) => {
    console.error("  ❌ MongoDB failed:", err.message);
    process.exit(1);
  });

// ─── Schemas ─────────────────────────────────────────────────────
const Product = mongoose.model(
  "Product",
  new mongoose.Schema(
    {
      product_id: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      age_restricted: { type: Boolean, default: false },
      stock_count: { type: Number, required: true },
      led_address: { type: String, required: true, unique: true },
      category: { type: String, required: true },
      reorder_threshold: { type: Number, default: 20 },
    },
    { timestamps: true }
  )
);

const Order = mongoose.model(
  "Order",
  new mongoose.Schema(
    {
      transaction_id: { type: String, required: true, unique: true },
      patient_name: String,
      doctor_name: String,
      clinic: String,
      items: [
        {
          medication_name: String,
          database_id: String,
          quantity_dispensed: Number,
          unit_price: Number,
          led_address: String,
        },
      ],
      total_amount: Number,
      id_verified: { type: Boolean, default: false },
      status: { type: String, default: "completed" },
    },
    { timestamps: true }
  )
);

const Verification = mongoose.model(
  "Verification",
  new mongoose.Schema(
    {
      transaction_id: String,
      patient_name: String,
      id_number_masked: String,
      date_of_birth: String,
      verified: { type: Boolean, default: false },
    },
    { timestamps: true }
  )
);

// ─── Seed Data ───────────────────────────────────────────────────
const SEED = [
  { product_id: "med_001", name: "Amoxicillin 500mg", price: 15.99, age_restricted: false, stock_count: 150, led_address: "shelf_A_row_1_pos_1", category: "Antibiotic", reorder_threshold: 30 },
  { product_id: "med_012", name: "Ibuprofen 400mg", price: 8.49, age_restricted: false, stock_count: 200, led_address: "shelf_A_row_1_pos_2", category: "Pain Relief", reorder_threshold: 40 },
  { product_id: "med_023", name: "Aspirin 81mg", price: 6.99, age_restricted: false, stock_count: 300, led_address: "shelf_A_row_2_pos_1", category: "Cardiovascular", reorder_threshold: 50 },
  { product_id: "med_034", name: "Lisinopril 10mg", price: 12.5, age_restricted: false, stock_count: 85, led_address: "shelf_A_row_2_pos_2", category: "Cardiovascular", reorder_threshold: 20 },
  { product_id: "med_045", name: "Metformin 500mg", price: 9.75, age_restricted: false, stock_count: 120, led_address: "shelf_B_row_1_pos_1", category: "Diabetes", reorder_threshold: 25 },
  { product_id: "med_056", name: "Omeprazole 20mg", price: 11.25, age_restricted: false, stock_count: 90, led_address: "shelf_B_row_1_pos_2", category: "Gastrointestinal", reorder_threshold: 20 },
  { product_id: "med_067", name: "Cetirizine 10mg", price: 7.99, age_restricted: false, stock_count: 175, led_address: "shelf_B_row_2_pos_1", category: "Allergy", reorder_threshold: 30 },
  { product_id: "med_078", name: "Prednisone 20mg", price: 14.0, age_restricted: false, stock_count: 60, led_address: "shelf_B_row_2_pos_2", category: "Corticosteroid", reorder_threshold: 15 },
  { product_id: "med_089", name: "Lorazepam 1mg", price: 25.5, age_restricted: true, stock_count: 45, led_address: "shelf_C_row_1_pos_1", category: "Controlled", reorder_threshold: 10 },
  { product_id: "med_090", name: "Adderall 20mg", price: 35.0, age_restricted: true, stock_count: 30, led_address: "shelf_C_row_1_pos_2", category: "Controlled", reorder_threshold: 10 },
  { product_id: "med_091", name: "Codeine 30mg", price: 22.0, age_restricted: true, stock_count: 25, led_address: "shelf_C_row_2_pos_1", category: "Controlled", reorder_threshold: 8 },
  { product_id: "med_092", name: "Alprazolam 0.5mg", price: 28.75, age_restricted: true, stock_count: 40, led_address: "shelf_C_row_2_pos_2", category: "Controlled", reorder_threshold: 10 },
];

async function seedDatabase() {
  const count = await Product.countDocuments();
  if (count > 0) return;
  console.log("  🌱 Seeding inventory...");
  await Product.insertMany(SEED);
  console.log("  ✅ Seeded", SEED.length, "products");
}

// ─── OCR Parser ──────────────────────────────────────────────────
function parseOcrText(text) {
  const get = (rx) => {
    const m = text.match(rx);
    return m ? m[1].trim() : "Unknown";
  };
  const rxM = [...text.matchAll(/Rx:\s*(.+?)\s*(?:[—\-]+\s*Qty:|quantity)\s*(\d+)/gi)];
  return {
    doctor_name: get(/Dr\.\s+([^\n,]+)/i),
    clinic: get(/Clinic:\s*([^\n]+)/i),
    patient_name: get(/Patient:\s*([^\n]+)/i),
    date_issued: get(/Date:\s*([^\n]+)/i),
    extracted_items: rxM.map((m) => ({
      medication_name: m[1].trim(),
      quantity_requested: parseInt(m[2], 10),
    })),
  };
}

async function matchItemsToDb(items) {
  const products = await Product.find();
  return items.map((item) => {
    const key = item.medication_name.split(" ")[0].toLowerCase();
    const match = products.find((p) => p.name.toLowerCase().startsWith(key));
    if (!match) return { ...item, matched: false, stock_sufficient: false };
    return {
      ...item,
      database_id: match.product_id,
      led_address: match.led_address,
      price: match.price,
      in_stock: match.stock_count,
      requires_id: match.age_restricted,
      category: match.category,
      stock_sufficient: match.stock_count >= item.quantity_requested,
      matched: true,
    };
  });
}

// ─── Socket.io ───────────────────────────────────────────────────
let connectedDevices = 0;

io.on("connection", (socket) => {
  console.log(`  🔌 Device connected: ${socket.id}`);
  connectedDevices++;
  io.emit("device:count", connectedDevices);

  socket.on("led:acknowledged", (data) => {
    console.log("  ✅ Shelf acknowledged:", data);
    io.emit("led:ack_confirmed", { device: socket.id, ...data });
  });

  socket.on("led:picking_complete", (data) => {
    console.log("  📦 Picking complete:", data);
    io.emit("picking:complete", { device: socket.id, ...data });
  });

  socket.on("disconnect", () => {
    connectedDevices--;
    console.log(`  🔌 Device disconnected: ${socket.id}`);
    io.emit("device:count", connectedDevices);
  });
});

function broadcastLedCommand(payload) {
  console.log("\n  💡 BROADCASTING LED COMMAND to", connectedDevices, "device(s)");
  console.dir(payload, { depth: null, colors: true });
  io.emit("led:activate", payload);
}

// ─── API ENDPOINTS ───────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "MediLight API v2.0",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    connected_devices: connectedDevices,
    uptime: process.uptime(),
  });
});

app.get("/api/inventory", async (req, res) => {
  try {
    const products = await Product.find().sort({ product_id: 1 });
    const lowStock = products.filter((p) => p.stock_count <= p.reorder_threshold);
    res.json({ status: "success", products, total_items: products.length, low_stock: lowStock });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/ocr/extract", async (req, res) => {
  try {
    const { ocr_text } = req.body;
    if (!ocr_text?.trim())
      return res.status(400).json({ status: "error", message: "No OCR text provided." });

    const parsed = parseOcrText(ocr_text);
    const matchedItems = await matchItemsToDb(parsed.extracted_items);
    const needsId = matchedItems.some((i) => i.requires_id && i.matched);
    const txnId = `txn_${Date.now().toString(36)}`;

    res.json({
      status: "success",
      transaction_id: txnId,
      timestamp: new Date().toISOString(),
      prescription_data: {
        doctor_name: parsed.doctor_name,
        clinic: parsed.clinic,
        patient_name: parsed.patient_name,
        date_issued: parsed.date_issued,
      },
      order_summary: matchedItems,
      compliance_action_required: needsId ? "ID_SCAN_NEEDED" : "NONE",
      order_total: matchedItems
        .filter((i) => i.matched)
        .reduce((s, i) => s + i.price * i.quantity_requested, 0)
        .toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/orders/validate", async (req, res) => {
  try {
    const { items } = req.body;
    if (!items?.length)
      return res.status(400).json({ status: "error", message: "No items provided." });

    const products = await Product.find();
    const validated = items.map((item) => {
      const p = products.find((pr) => pr.product_id === item.database_id);
      if (!p) return { ...item, matched: false };
      const qty = item.quantity_requested || 1;
      return {
        medication_name: p.name,
        quantity_requested: qty,
        database_id: p.product_id,
        led_address: p.led_address,
        price: p.price,
        in_stock: p.stock_count,
        requires_id: p.age_restricted,
        category: p.category,
        stock_sufficient: p.stock_count >= qty,
        matched: true,
      };
    });

    res.json({
      status: "success",
      transaction_id: `txn_${Date.now().toString(36)}`,
      order_summary: validated,
      compliance_action_required: validated.some((i) => i.requires_id && i.matched)
        ? "ID_SCAN_NEEDED"
        : "NONE",
      order_total: validated
        .filter((i) => i.matched)
        .reduce((s, i) => s + i.price * i.quantity_requested, 0)
        .toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/verify-id", async (req, res) => {
  try {
    const { patient_name, id_number, date_of_birth, transaction_id } = req.body;
    if (!patient_name || !id_number)
      return res.status(400).json({ status: "error", message: "Name and ID required." });

    const verified = id_number.length >= 4;
    await Verification.create({
      transaction_id: transaction_id || "unlinked",
      patient_name,
      id_number_masked: `***${id_number.slice(-4)}`,
      date_of_birth,
      verified,
    });

    res.json({
      status: verified ? "verified" : "rejected",
      patient_name,
      verification_timestamp: new Date().toISOString(),
      message: verified
        ? "Identity verified. Controlled substances approved."
        : "Verification failed.",
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ★ THE CORE ENDPOINT — confirms order, deducts stock, broadcasts LED signal
app.post("/api/orders/confirm", async (req, res) => {
  try {
    const { transaction_id, patient_name, doctor_name, clinic, items, id_verified } = req.body;
    if (!items?.length)
      return res.status(400).json({ status: "error", message: "No items to confirm." });

    const ledTargets = [];
    const orderItems = [];
    const lowStockAlerts = [];

    for (const item of items) {
      const product = await Product.findOne({ product_id: item.database_id });
      if (!product) continue;
      const qty = item.quantity_requested || 1;

      product.stock_count = Math.max(0, product.stock_count - qty);
      await product.save();

      ledTargets.push({
        led_address: product.led_address,
        item: product.name,
        database_id: product.product_id,
      });
      orderItems.push({
        medication_name: product.name,
        database_id: product.product_id,
        quantity_dispensed: qty,
        unit_price: product.price,
        led_address: product.led_address,
      });

      if (product.stock_count <= product.reorder_threshold) {
        lowStockAlerts.push({
          medication_name: product.name,
          remaining_stock: product.stock_count,
          reorder_threshold: product.reorder_threshold,
        });
      }
    }

    const ledPayload = {
      command: "ACTIVATE_LEDS",
      transaction_id: transaction_id || `txn_${Date.now().toString(36)}`,
      activation_mode: "BLINK_FAST",
      duration_seconds: 30,
      color_hex: "#00FF00",
      targets: ledTargets,
      timestamp: new Date().toISOString(),
    };

    // ★ BROADCAST TO ALL CONNECTED SHELF DEVICES
    broadcastLedCommand(ledPayload);

    const totalAmount = orderItems.reduce((s, i) => s + i.unit_price * i.quantity_dispensed, 0);
    const order = await Order.create({
      transaction_id: ledPayload.transaction_id,
      patient_name: patient_name || "Unknown",
      doctor_name: doctor_name || "Unknown",
      clinic: clinic || "Unknown",
      items: orderItems,
      total_amount: parseFloat(totalAmount.toFixed(2)),
      id_verified: id_verified || false,
    });

    res.json({
      status: "success",
      message: "Order confirmed. LED signal broadcast.",
      order,
      hardware_payload: ledPayload,
      inventory_updated: true,
      low_stock_alerts: lowStockAlerts,
      connected_devices: connectedDevices,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/leds/off", (req, res) => {
  io.emit("led:deactivate", { command: "DEACTIVATE_LEDS", timestamp: new Date().toISOString() });
  res.json({ status: "success", message: "LED off signal broadcast." });
});

app.get("/api/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(50);
    res.json({ status: "success", orders, total_orders: orders.length });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/inventory/reset", async (req, res) => {
  try {
    await Product.deleteMany({});
    await Order.deleteMany({});
    await Verification.deleteMany({});
    await seedDatabase();
    io.emit("led:deactivate", { command: "DEACTIVATE_LEDS" });
    res.json({ status: "success", message: "All data reset." });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── START ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
mongoose.connection.once("open", async () => {
  await seedDatabase();
  server.listen(PORT, () => {
    console.log(`\n  💊 MediLight API v2.0`);
    console.log(`  🌐 HTTP:      http://localhost:${PORT}`);
    console.log(`  🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`  📡 Waiting for shelf devices...\n`);
  });
});
