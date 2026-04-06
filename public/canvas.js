const API_BASE = ''; // 可替换为占位符服务器地址，如 'https://example.com'

const els = {
  preparingList: document.getElementById('preparing-list'),
  deliveryList: document.getElementById('delivery-list'),
  completedList: document.getElementById('completed-list'),
};

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusLabel(status) {
  if (status === 'preparing') return '制作中';
  if (status === 'delivery_pending') return '配送中';
  return '已完成';
}

function orderCard(order) {
  const div = document.createElement('div');
  div.className = 'order';
  div.dataset.id = order.id;
  const timeText = `创建: ${fmtTime(order.createdAt)}${order.updatedAt !== order.createdAt ? ` · 更新: ${fmtTime(order.updatedAt)}` : ''}`;
  div.innerHTML = `
    <div class="order-main">
      <div class="meta">
        <strong>#${order.id}</strong>
        <span class="muted">${statusLabel(order.status)}</span>
      </div>
      <div class="items">${order.items}</div>
      <div class="times muted">${timeText}</div>
    </div>
  `;
  return div;
}

function renderLists(all) {
  const byCreatedDesc = (a, b) => b.createdAt - a.createdAt;
  const byUpdatedDesc = (a, b) => b.updatedAt - a.updatedAt;
  const preparing = all.filter(o => o.status === 'preparing').sort(byCreatedDesc);
  const delivery = all.filter(o => o.status === 'delivery_pending').sort(byUpdatedDesc);
  const completed = all.filter(o => o.status === 'completed').sort(byUpdatedDesc);

  els.preparingList.innerHTML = '';
  els.deliveryList.innerHTML = '';
  els.completedList.innerHTML = '';

  preparing.forEach(o => els.preparingList.appendChild(orderCard(o)));
  delivery.forEach(o => els.deliveryList.appendChild(orderCard(o)));
  completed.forEach(o => els.completedList.appendChild(orderCard(o)));
}

function sseConnect() {
  const es = new EventSource(`${API_BASE}/api/events`);
  let current = [];
  window.__currentOrders = current;

  es.addEventListener('orders:snapshot', (ev) => {
    current = JSON.parse(ev.data || '[]');
    window.__currentOrders = current;
    renderLists(current);
  });
  es.addEventListener('orders:created', (ev) => {
    const order = JSON.parse(ev.data);
    current = [...current, order].sort((a, b) => a.createdAt - b.createdAt);
    window.__currentOrders = current;
    renderLists(current);
  });
  es.addEventListener('orders:updated', (ev) => {
    const order = JSON.parse(ev.data);
    const idx = current.findIndex(o => o.id === order.id);
    if (idx >= 0) current[idx] = order; else current.push(order);
    window.__currentOrders = current;
    renderLists(current);
  });
  es.addEventListener('orders:deleted', (ev) => {
    try {
      const { id } = JSON.parse(ev.data || '{}');
      if (!id) return;
      current = current.filter(o => o.id !== id);
      window.__currentOrders = current;
      renderLists(current);
    } catch (_) {}
  });
  es.onerror = () => {
    // 简单重连
    es.close();
    setTimeout(sseConnect, 1500);
  };
}

// 初始加载
try {
  sseConnect();
} catch (_) {
  // fallback 轮询
  setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/orders`);
      const data = await res.json();
      renderLists(data);
    } catch (e) {}
  }, 2000);
}
