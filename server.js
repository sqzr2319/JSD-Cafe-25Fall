const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory order store
// order: { id: string, items: string, status: 'waiting'|'completed', createdAt: number, updatedAt: number }
const orders = new Map();

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
  return Array.from(orders.values()).sort((a, b) => a.createdAt - b.createdAt);
}

// API routes
app.get('/api/orders', (req, res) => {
  const { status } = req.query;
  let list = snapshot();
  if (status === 'waiting' || status === 'completed') {
    list = list.filter(o => o.status === status);
  }
  res.json(list);
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
  if (orders.has(key)) {
    return res.status(409).json({ error: 'Order with this id already exists' });
  }

  const now = Date.now();
  const order = { id: key, items: items.trim(), status: 'waiting', createdAt: now, updatedAt: now };
  // Atomic insert (synchronous in Node)
  orders.set(key, order);

  broadcast('orders:created', order);
  res.status(201).json(order);
});

app.patch('/api/orders/:id/complete', (req, res) => {
  const key = req.params.id.trim();
  const order = orders.get(key);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status === 'completed') {
    return res.json(order); // idempotent
  }
  order.status = 'completed';
  order.updatedAt = Date.now();
  orders.set(key, order);
  broadcast('orders:updated', order);
  res.json(order);
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
