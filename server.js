const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const VALID_STATUSES = new Set(['preparing', 'delivery_pending', 'completed']);

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/lottery', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'lottery.html')));

// -----------------------------
// SQLite setup (persistent store)
// -----------------------------
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'cafe.db');
const db = new Database(dbPath);
try { db.pragma('journal_mode = WAL'); } catch (_) {}

const expectedSchemaToken = `CHECK(status IN ('preparing','delivery_pending','completed'))`;
const tableSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'`).get()?.sql || '';

if (tableSql && !tableSql.includes(expectedSchemaToken)) {
  db.exec(`
  BEGIN;
  ALTER TABLE orders RENAME TO orders_legacy;
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    items TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('preparing','delivery_pending','completed')),
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  INSERT INTO orders(id, items, status, createdAt, updatedAt)
  SELECT
    id,
    items,
    CASE
      WHEN status = 'waiting' THEN 'preparing'
      WHEN status = 'completed' THEN 'completed'
      ELSE 'preparing'
    END,
    createdAt,
    updatedAt
  FROM orders_legacy;
  DROP TABLE orders_legacy;
  COMMIT;
  `);
}

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  items TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('preparing','delivery_pending','completed')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, createdAt);
`);

// order shape: { id, items, status, createdAt, updatedAt }

// SSE clients
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (_) {
      // ignore broken pipe; will be cleaned up on 'close'
    }
  }
}

function snapshot() {
  const rows = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders ORDER BY createdAt ASC`).all();
  return rows;
}

function isTartOnly(items) {
  const compact = String(items || '').trim();
  if (!compact) return true;
  const normalized = compact
    .replace(/[，、；;|]/g, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const parts = normalized.length ? normalized : [compact];
  return parts.every((part) => /^蛋挞\s*\d*$/i.test(part));
}

// API routes
app.get('/api/orders', (req, res) => {
  const { status } = req.query;
  let rows;
  if (status === 'preparing' || status === 'delivery_pending' || status === 'completed') {
    rows = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders WHERE status = ? ORDER BY createdAt ASC`).all(status);
  } else {
    rows = snapshot();
  }
  res.json(rows);
});

app.post('/api/orders', (req, res) => {
  const { id, items } = req.body || {};

  if (typeof id !== 'string' || !id.trim()) {
    return res.status(400).json({ error: 'id is required (non-empty string)' });
  }
  if (typeof items !== 'string' || !items.trim()) {
    return res.status(400).json({ error: 'items is required (non-empty string)' });
  }

  const key = id.trim();
  const now = Date.now();
  const order = { id: key, items: items.trim(), status: 'preparing', createdAt: now, updatedAt: now };
  try {
    db.prepare(`INSERT INTO orders(id, items, status, createdAt, updatedAt) VALUES(?,?,?,?,?)`) 
      .run(order.id, order.items, order.status, order.createdAt, order.updatedAt);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE') || String(err?.code || '') === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return res.status(409).json({ error: 'Order with this id already exists' });
    }
    if (String(err?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(400).json({ error: `Invalid order data: ${String(err?.message || 'constraint failed')}` });
    }
    return res.status(500).json({ error: 'Failed to create order', detail: String(err?.message || err) });
  }
  broadcast('orders:created', order);
  res.status(201).json(order);
});

// Admin action: direct status set
app.patch('/api/orders/:id/status', (req, res) => {
  const key = req.params.id.trim();
  const { status } = req.body || {};
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be preparing | delivery_pending | completed' });
  }
  const order = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders WHERE id = ?`).get(key);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status === status) {
    return res.json(order);
  }
  const updatedAt = Date.now();
  try {
    db.prepare(`UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?`).run(status, updatedAt, key);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update order status' });
  }
  const updated = { ...order, status, updatedAt };
  broadcast('orders:updated', updated);
  res.json(updated);
});

// Barista action: preparing -> delivery_pending
app.patch('/api/orders/:id/delivery-pending', (req, res) => {
  const key = req.params.id.trim();
  const order = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders WHERE id = ?`).get(key);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status === 'delivery_pending') {
    return res.json(order); // idempotent
  }
  if (order.status !== 'preparing') {
    return res.status(409).json({ error: 'Only preparing orders can become delivery_pending' });
  }
  const updatedAt = Date.now();
  try {
    db.prepare(`UPDATE orders SET status = 'delivery_pending', updatedAt = ? WHERE id = ?`).run(updatedAt, key);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update order' });
  }
  const updated = { ...order, status: 'delivery_pending', updatedAt };
  broadcast('orders:updated', updated);
  res.json(updated);
});

// Waiter action: delivery_pending -> completed
app.patch('/api/orders/:id/complete', (req, res) => {
  const key = req.params.id.trim();
  const order = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders WHERE id = ?`).get(key);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status === 'completed') {
    return res.json(order); // idempotent
  }
  if (order.status !== 'delivery_pending') {
    return res.status(409).json({ error: 'Only delivery_pending orders can be completed' });
  }
  const updatedAt = Date.now();
  try {
    db.prepare(`UPDATE orders SET status = 'completed', updatedAt = ? WHERE id = ?`).run(updatedAt, key);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update order' });
  }
  const updated = { ...order, status: 'completed', updatedAt };
  broadcast('orders:updated', updated);
  res.json(updated);
});

// Delete an order
app.delete('/api/orders/:id', (req, res) => {
  const key = req.params.id.trim();
  const existing = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders WHERE id = ?`).get(key);
  if (!existing) {
    return res.status(404).json({ error: 'Order not found' });
  }
  try {
    db.prepare(`DELETE FROM orders WHERE id = ?`).run(key);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete order' });
  }
  broadcast('orders:deleted', { id: key });
  res.json({ ok: true, id: key });
});

// Lottery: eligible completed orders (not tart-only)
app.get('/api/lottery/eligible', (_req, res) => {
  const completed = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders WHERE status = 'completed' ORDER BY createdAt ASC`).all();
  const eligible = completed.filter((o) => !isTartOnly(o.items));
  res.json({
    totalCompleted: completed.length,
    eligibleCount: eligible.length,
    orders: eligible,
  });
});

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  res.write(`event: hello\ndata: {"ok":true}\n\n`);

  // Send initial snapshot
  res.write(`event: orders:snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    try { res.end(); } catch (_) {}
  });
});

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Cafe ordering server listening on http://localhost:${PORT}`);
});
