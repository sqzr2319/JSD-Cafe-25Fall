const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------
// SQLite setup (persistent store)
// -----------------------------
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'cafe.db');
const db = new Database(dbPath);
try { db.pragma('journal_mode = WAL'); } catch (_) {}

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  items TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('waiting','completed')),
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

// API routes
app.get('/api/orders', (req, res) => {
  const { status } = req.query;
  let rows;
  if (status === 'waiting' || status === 'completed') {
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
  const order = { id: key, items: items.trim(), status: 'waiting', createdAt: now, updatedAt: now };
  try {
    db.prepare(`INSERT INTO orders(id, items, status, createdAt, updatedAt) VALUES(?,?,?,?,?)`) 
      .run(order.id, order.items, order.status, order.createdAt, order.updatedAt);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE') || String(err?.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Order with this id already exists' });
    }
    return res.status(500).json({ error: 'Failed to create order' });
  }
  broadcast('orders:created', order);
  res.status(201).json(order);
});

app.patch('/api/orders/:id/complete', (req, res) => {
  const key = req.params.id.trim();
  const order = db.prepare(`SELECT id, items, status, createdAt, updatedAt FROM orders WHERE id = ?`).get(key);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status === 'completed') {
    return res.json(order); // idempotent
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
