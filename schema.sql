-- MediLight Database Schema
-- Run this once to initialize your Render PostgreSQL database

-- Products / Inventory
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  product_id VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  age_restricted BOOLEAN DEFAULT FALSE,
  stock_count INTEGER NOT NULL DEFAULT 0,
  led_address VARCHAR(50),
  category VARCHAR(50),
  reorder_threshold INTEGER DEFAULT 20,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  transaction_id VARCHAR(50) UNIQUE NOT NULL,
  patient_name VARCHAR(100),
  doctor_name VARCHAR(100),
  clinic VARCHAR(200),
  total DECIMAL(10,2) DEFAULT 0,
  id_verified BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Order line items
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id VARCHAR(20) REFERENCES products(product_id),
  medication_name VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2),
  led_address VARCHAR(50)
);

-- Audit log for compliance
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed inventory (runs only if table is empty)
INSERT INTO products (product_id, name, price, age_restricted, stock_count, led_address, category, reorder_threshold)
SELECT * FROM (VALUES
  ('med_001', 'Amoxicillin 500mg',  15.99, false, 150, 'shelf_A_row_1_pos_1', 'Antibiotic',       30),
  ('med_012', 'Ibuprofen 400mg',     8.49, false, 200, 'shelf_A_row_1_pos_2', 'Pain Relief',      40),
  ('med_023', 'Aspirin 81mg',        6.99, false, 300, 'shelf_A_row_2_pos_1', 'Cardiovascular',   50),
  ('med_034', 'Lisinopril 10mg',    12.50, false,  85, 'shelf_A_row_2_pos_2', 'Cardiovascular',   20),
  ('med_045', 'Metformin 500mg',     9.75, false, 120, 'shelf_B_row_1_pos_1', 'Diabetes',         25),
  ('med_056', 'Omeprazole 20mg',    11.25, false,  90, 'shelf_B_row_1_pos_2', 'Gastrointestinal', 20),
  ('med_067', 'Cetirizine 10mg',     7.99, false, 175, 'shelf_B_row_2_pos_1', 'Allergy',          30),
  ('med_078', 'Prednisone 20mg',    14.00, false,  60, 'shelf_B_row_2_pos_2', 'Corticosteroid',   15),
  ('med_089', 'Lorazepam 1mg',      25.50, true,   45, 'shelf_C_row_1_pos_1', 'Controlled',       10),
  ('med_090', 'Adderall 20mg',      35.00, true,   30, 'shelf_C_row_1_pos_2', 'Controlled',       10),
  ('med_091', 'Codeine 30mg',       22.00, true,   25, 'shelf_C_row_2_pos_1', 'Controlled',        8),
  ('med_092', 'Alprazolam 0.5mg',   28.75, true,   40, 'shelf_C_row_2_pos_2', 'Controlled',       10)
) AS seed(product_id, name, price, age_restricted, stock_count, led_address, category, reorder_threshold)
WHERE NOT EXISTS (SELECT 1 FROM products LIMIT 1);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
