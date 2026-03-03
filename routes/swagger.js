// swagger.js — OpenAPI 3.0 specification for MediLight API

const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "MediLight Dispensing System API",
    version: "3.0.0",
    description: `
## 🏥 MediLight — Smart Pharmacy Dispensing System

Real-time LED-guided medication dispensing with AI prescription parsing.

### Architecture
\`\`\`
React Dashboard → Express API → Neon PostgreSQL
                       ↓
              WebSocket → ESP32 Shelf LEDs
\`\`\`

### Features
- **Inventory CRUD** — Products with stock tracking & LED addresses
- **Order Processing** — Transactional stock deduction + LED activation
- **OCR Parsing** — Server-side regex fallback for prescriptions
- **ID Verification** — Controlled substance compliance gate
- **Audit Trail** — Every action logged with timestamps
- **WebSocket** — Real-time LED commands to shelf devices

### Database
Hosted on **Neon** (free PostgreSQL). Tables: \`products\`, \`orders\`, \`order_items\`, \`audit_log\`
    `,
    contact: { name: "MediLight Team" },
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [
    { name: "Health", description: "Server & database status" },
    { name: "Inventory", description: "Product/medication management" },
    { name: "Orders", description: "Order processing & history" },
    { name: "OCR", description: "Prescription text extraction" },
    { name: "Verification", description: "Patient ID verification" },
    { name: "LED", description: "Hardware LED control" },
    { name: "Audit", description: "Compliance audit trail" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Server & database health check",
        description: "Returns server status, database connection, product count, and connected WebSocket devices.",
        responses: {
          200: {
            description: "Health status",
            content: { "application/json": { schema: { type: "object", properties: {
              status: { type: "string", example: "online" },
              database: { type: "string", example: "connected" },
              product_count: { type: "integer", example: 12 },
              connected_devices: { type: "integer", example: 0 },
              timestamp: { type: "string", example: "2026-03-01T12:00:00.000Z" },
            }}}},
          },
        },
      },
    },
    "/api/inventory": {
      get: {
        tags: ["Inventory"],
        summary: "List all products",
        description: "Returns all medications in inventory, ordered by category and name.",
        responses: {
          200: { description: "Product list", content: { "application/json": { schema: { type: "object", properties: {
            products: { type: "array", items: { $ref: "#/components/schemas/Product" } },
            connected_devices: { type: "integer" },
          }}}}},
        },
      },
      post: {
        tags: ["Inventory"],
        summary: "Add a new product",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ProductInput" },
            example: { product_id: "med_100", name: "Paracetamol 500mg", price: 5.99, age_restricted: false, stock_count: 100, led_address: "shelf_A_row_3_pos_1", category: "Pain Relief", reorder_threshold: 25 },
          }},
        },
        responses: {
          201: { description: "Product created" },
          500: { description: "Error (e.g. duplicate product_id)" },
        },
      },
    },
    "/api/inventory/{productId}": {
      get: {
        tags: ["Inventory"],
        summary: "Get single product",
        parameters: [{ name: "productId", in: "path", required: true, schema: { type: "string" }, example: "med_001" }],
        responses: {
          200: { description: "Product details" },
          404: { description: "Product not found" },
        },
      },
      put: {
        tags: ["Inventory"],
        summary: "Update product fields",
        description: "Only include fields you want to change.",
        parameters: [{ name: "productId", in: "path", required: true, schema: { type: "string" }, example: "med_001" }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: {
            stock_count: { type: "integer", example: 200 },
            price: { type: "number", example: 18.99 },
            reorder_threshold: { type: "integer", example: 40 },
          }}}},
        },
        responses: {
          200: { description: "Updated product" },
          404: { description: "Product not found" },
        },
      },
    },
    "/api/inventory/reset": {
      post: {
        tags: ["Inventory"],
        summary: "Reset all data to seed values",
        description: "⚠️ DESTRUCTIVE — Deletes all orders and resets inventory to original 12 products.",
        responses: { 200: { description: "Reset complete" } },
      },
    },
    "/api/ocr/extract": {
      post: {
        tags: ["OCR"],
        summary: "Parse prescription text (server-side regex)",
        description: "Extracts doctor, patient, clinic, date, and medications from raw text. Matches against DB inventory.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["ocr_text"], properties: {
            ocr_text: { type: "string", example: "Dr. Sarah Smith, MD\nClinic: Downtown Medical Center\nPatient: John Doe\nDate: Feb 26, 2026\n\nRx: Amoxicillin 500mg — Qty: 30\nRx: Ibuprofen 400mg — Qty: 20" },
          }}}},
        },
        responses: { 200: { description: "Parsed prescription with matched inventory items" } },
      },
    },
    "/api/verify-id": {
      post: {
        tags: ["Verification"],
        summary: "Verify patient identity",
        description: "Simulated ID verification for controlled substances.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["patient_name", "id_number"], properties: {
            patient_name: { type: "string", example: "John Doe" },
            id_number: { type: "string", example: "DL-12345678" },
            date_of_birth: { type: "string", example: "1990-05-15" },
          }}}},
        },
        responses: { 200: { description: "Verification result" } },
      },
    },
    "/api/orders/confirm": {
      post: {
        tags: ["Orders"],
        summary: "Confirm order — deducts stock, saves to DB, triggers LEDs",
        description: "Atomic transaction: deducts stock, creates order + line items, broadcasts LED commands.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/OrderConfirmInput" },
            example: {
              transaction_id: "txn_abc123", patient_name: "John Doe", doctor_name: "Dr. Sarah Smith", clinic: "Downtown Medical Center",
              items: [{ database_id: "med_001", quantity_requested: 30 }, { database_id: "med_012", quantity_requested: 20 }],
              id_verified: false,
            },
          }},
        },
        responses: { 200: { description: "Order confirmed with LED payload and stock alerts" } },
      },
    },
    "/api/orders": {
      get: {
        tags: ["Orders"],
        summary: "Get order history",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 50 } }],
        responses: { 200: { description: "Order list with line items" } },
      },
    },
    "/api/orders/{transactionId}": {
      get: {
        tags: ["Orders"],
        summary: "Get single order by transaction ID",
        parameters: [{ name: "transactionId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Order with items" }, 404: { description: "Not found" } },
      },
    },
    "/api/audit": {
      get: {
        tags: ["Audit"],
        summary: "Get audit log",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 100 } }],
        responses: { 200: { description: "Audit entries" } },
      },
    },
    "/api/led/trigger": {
      post: {
        tags: ["LED"],
        summary: "Manual LED trigger",
        description: "Broadcast any payload to all connected WebSocket devices.",
        requestBody: {
          content: { "application/json": { schema: { type: "object" },
            example: { command: "ACTIVATE_LEDS", activation_mode: "BLINK_FAST", duration_seconds: 15, color_hex: "#00FF00", targets: [{ led_address: "shelf_A_row_1_pos_1", item: "Amoxicillin 500mg" }] },
          }},
        },
        responses: { 200: { description: "Broadcast result" } },
      },
    },
    "/api/test/run-all": {
      get: {
        tags: ["Health"],
        summary: "Run automated API test suite",
        description: "Executes 10 tests across all endpoints. Great for verifying deployment.",
        responses: { 200: { description: "Test results with pass/fail" } },
      },
    },
  },
  components: {
    schemas: {
      Product: {
        type: "object",
        properties: {
          id: { type: "integer" }, product_id: { type: "string", example: "med_001" },
          name: { type: "string", example: "Amoxicillin 500mg" },
          price: { type: "number", example: 15.99 }, age_restricted: { type: "boolean" },
          stock_count: { type: "integer", example: 150 },
          led_address: { type: "string", example: "shelf_A_row_1_pos_1" },
          category: { type: "string", example: "Antibiotic" },
          reorder_threshold: { type: "integer", example: 30 },
        },
      },
      ProductInput: {
        type: "object",
        required: ["product_id", "name", "price"],
        properties: {
          product_id: { type: "string" }, name: { type: "string" }, price: { type: "number" },
          age_restricted: { type: "boolean" }, stock_count: { type: "integer" },
          led_address: { type: "string" }, category: { type: "string" }, reorder_threshold: { type: "integer" },
        },
      },
      OrderConfirmInput: {
        type: "object",
        required: ["transaction_id", "items"],
        properties: {
          transaction_id: { type: "string" }, patient_name: { type: "string" },
          doctor_name: { type: "string" }, clinic: { type: "string" },
          items: { type: "array", items: { type: "object", properties: {
            database_id: { type: "string" }, quantity_requested: { type: "integer" },
          }}},
          id_verified: { type: "boolean" },
        },
      },
    },
  },
};

module.exports = swaggerSpec;
