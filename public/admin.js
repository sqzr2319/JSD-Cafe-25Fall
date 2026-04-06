const API_BASE = '';

const els = {
  form: document.getElementById('admin-add-form'),
  id: document.getElementById('admin-order-id'),
  items: document.getElementById('admin-order-items'),
  formStatus: document.getElementById('admin-form-status'),
  list: document.getElementById('admin-list'),
  orderCount: document.getElementById('stat-order-count'),
  totalAmount: document.getElementById('stat-total-amount'),
  productStats: document.getElementById('product-stats'),
  trendChart: document.getElementById('order-trend-chart'),
};

const PRODUCTS = [
  { name: '桃味气泡美式', price: 18 },
  { name: '混合果味气泡水', price: 18 },
  { name: '焦糖风味气泡水', price: 18 },
  { name: '气泡乳酸菌', price: 18 },
  { name: '蛋挞', price: 6 },
  { name: '美式', price: 18 },
  { name: '拿铁', price: 18 },
  { name: '焦糖玛奇朵', price: 18 },
  { name: '热可可', price: 18 },
  { name: '红茶', price: 18 },
  { name: '果味咖啡', price: 18 },
  { name: '随机特调', price: 18 },
];

const productMap = new Map(PRODUCTS.map((p) => [p.name, p]));
const productPattern = new RegExp(`(${PRODUCTS.map((p) => p.name).sort((a, b) => b.length - a.length).join('|')})\\s*(\\d+)?`, 'g');

function parseItems(itemsText) {
  const counts = new Map(PRODUCTS.map((p) => [p.name, 0]));
  const text = String(itemsText || '').replace(/[，、；;|]/g, ',');
  let match;
  while ((match = productPattern.exec(text)) !== null) {
    const name = match[1];
    const qty = Number(match[2] || '1');
    counts.set(name, (counts.get(name) || 0) + (Number.isFinite(qty) && qty > 0 ? qty : 1));
  }
  productPattern.lastIndex = 0;
  return counts;
}

function computeStats(orders) {
  const totals = new Map(PRODUCTS.map((p) => [p.name, 0]));
  for (const order of orders) {
    const parsed = parseItems(order.items);
    for (const [name, qty] of parsed.entries()) {
      totals.set(name, (totals.get(name) || 0) + qty);
    }
  }

  let totalAmount = 0;
  for (const [name, qty] of totals.entries()) {
    totalAmount += qty * (productMap.get(name)?.price || 18);
  }

  return {
    orderCount: orders.length,
    totals,
    totalAmount,
  };
}

function renderTrendChart(orders) {
  const canvas = els.trendChart;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(320, Math.floor(rect.width || canvas.width));
  const cssHeight = 280;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const pad = { left: 52, right: 18, top: 18, bottom: 42 };
  const width = cssWidth - pad.left - pad.right;
  const height = cssHeight - pad.top - pad.bottom;

  ctx.strokeStyle = '#d6deef';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + height);
  ctx.lineTo(pad.left + width, pad.top + height);
  ctx.stroke();

  if (!orders.length) {
    ctx.fillStyle = '#58627a';
    ctx.font = '14px Segoe UI';
    ctx.fillText('暂无数据', pad.left + 8, pad.top + 20);
    return;
  }

  const sorted = [...orders].sort((a, b) => a.createdAt - b.createdAt);
  const xMin = sorted[0].createdAt;
  const xMax = sorted[sorted.length - 1].createdAt;
  const yMax = sorted.length;

  const xOf = (ts) => {
    if (xMax === xMin) return pad.left + width / 2;
    return pad.left + ((ts - xMin) / (xMax - xMin)) * width;
  };
  const yOf = (v) => pad.top + height - (v / yMax) * height;

  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  sorted.forEach((o, idx) => {
    const x = xOf(o.createdAt);
    const y = yOf(idx + 1);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#0284c7';
  sorted.forEach((o, idx) => {
    const x = xOf(o.createdAt);
    const y = yOf(idx + 1);
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#58627a';
  ctx.font = '12px Segoe UI';
  ctx.fillText('累计点单数', 8, pad.top + 8);
  ctx.fillText('时间', pad.left + width - 20, cssHeight - 10);
  ctx.fillText('1', pad.left - 18, yOf(1) + 4);
  ctx.fillText(String(yMax), pad.left - 28, yOf(yMax) + 4);

  const start = new Date(xMin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const end = new Date(xMax).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ctx.fillText(start, pad.left - 4, cssHeight - 10);
  ctx.fillText(end, pad.left + width - 34, cssHeight - 10);
}

function renderStats(orders) {
  const stats = computeStats(orders);
  if (els.orderCount) els.orderCount.textContent = String(stats.orderCount);
  if (els.totalAmount) els.totalAmount.textContent = `${stats.totalAmount} 元`;

  if (els.productStats) {
    els.productStats.innerHTML = PRODUCTS
      .map((p) => `<div class="product-row"><span>${p.name}</span><strong>${stats.totals.get(p.name) || 0} 份</strong></div>`)
      .join('');
  }

  renderTrendChart(orders);
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function statusLabel(status) {
  if (status === 'preparing') return '制作中';
  if (status === 'delivery_pending') return '待配送';
  return '已完成';
}

function option(status, label) {
  return `<option value="${status}">${label}</option>`;
}

function renderList(orders) {
  els.list.innerHTML = '';
  renderStats(orders);
  if (!orders.length) {
    const empty = document.createElement('div');
    empty.className = 'order';
    empty.textContent = '暂无点单';
    els.list.appendChild(empty);
    return;
  }

  for (const order of orders) {
    const div = document.createElement('div');
    div.className = 'order';
    div.dataset.id = order.id;
    div.innerHTML = `
      <div class="meta">
        <strong>#${order.id}</strong>
        <span class="muted">${statusLabel(order.status)}</span>
      </div>
      <div class="items">${order.items}</div>
      <div class="times muted">创建: ${fmtTime(order.createdAt)}${order.updatedAt !== order.createdAt ? ` · 更新: ${fmtTime(order.updatedAt)}` : ''}</div>
      <div class="actions admin-actions">
        <select class="status-select" aria-label="状态选择">
          ${option('preparing', '制作中')}
          ${option('delivery_pending', '待配送')}
          ${option('completed', '已完成')}
        </select>
        <button class="to-delivery save-btn" type="button">保存状态</button>
        <button class="danger delete-btn" type="button">删除</button>
      </div>
      <div class="status row-status"></div>
    `;

    const select = div.querySelector('.status-select');
    select.value = order.status;

    const saveBtn = div.querySelector('.save-btn');
    const deleteBtn = div.querySelector('.delete-btn');
    const rowStatus = div.querySelector('.row-status');

    saveBtn.addEventListener('click', async () => {
      rowStatus.textContent = '保存中...';
      saveBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(order.id)}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: select.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '更新失败');
        rowStatus.textContent = '状态已更新';
      } catch (err) {
        rowStatus.textContent = err.message;
      } finally {
        saveBtn.disabled = false;
        setTimeout(() => { rowStatus.textContent = ''; }, 1200);
      }
    });

    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`确认删除点单 #${order.id} 吗？`)) return;
      rowStatus.textContent = '删除中...';
      deleteBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(order.id)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '删除失败');
        rowStatus.textContent = '已删除';
      } catch (err) {
        rowStatus.textContent = err.message;
      } finally {
        deleteBtn.disabled = false;
        setTimeout(() => { rowStatus.textContent = ''; }, 1200);
      }
    });

    els.list.appendChild(div);
  }
}

async function fetchOrders() {
  const res = await fetch(`${API_BASE}/api/orders`);
  if (!res.ok) throw new Error('加载点单失败');
  const data = await res.json();
  renderList(data);
}

async function addOrder(e) {
  e.preventDefault();
  const id = els.id.value.trim();
  const items = els.items.value.trim();
  if (!id || !items) return;

  els.formStatus.textContent = '提交中...';
  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '添加失败');
    els.formStatus.textContent = '添加成功';
    els.id.value = '';
    els.items.value = '';
  } catch (err) {
    els.formStatus.textContent = err.message;
  } finally {
    setTimeout(() => { els.formStatus.textContent = ''; }, 1200);
  }
}

function connectSSE() {
  const es = new EventSource(`${API_BASE}/api/events`);
  es.addEventListener('orders:snapshot', (ev) => {
    const data = JSON.parse(ev.data || '[]');
    renderList(data);
  });
  es.addEventListener('orders:created', () => fetchOrders().catch(console.error));
  es.addEventListener('orders:updated', () => fetchOrders().catch(console.error));
  es.addEventListener('orders:deleted', () => fetchOrders().catch(console.error));
  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 1500);
  };
}

els.form.addEventListener('submit', addOrder);
fetchOrders().catch((err) => {
  els.formStatus.textContent = err.message;
});
connectSSE();
