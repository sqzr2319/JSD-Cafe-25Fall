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

function renderInlineList(container, orders) {
  container.innerHTML = '';
  if (!orders.length) {
    const empty = document.createElement('div');
    empty.className = 'lottery-inline';
    empty.textContent = '';
    container.appendChild(empty);
    return;
  }

  const sorted = [...orders].sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true }));
  const inline = document.createElement('div');
  inline.className = 'lottery-inline';
  inline.textContent = sorted.map((o) => `#${o.id}`).join('  ');
  container.appendChild(inline);
}

function renderLists(all) {
  const byCreatedAsc = (a, b) => a.createdAt - b.createdAt;
  const byUpdatedAsc = (a, b) => a.updatedAt - b.updatedAt;
  const byUpdatedDesc = (a, b) => b.updatedAt - a.updatedAt;
  const preparing = all.filter(o => o.status === 'preparing').sort(byCreatedAsc);
  const delivery = all.filter(o => o.status === 'delivery_pending').sort(byUpdatedAsc);
  const completed = all.filter(o => o.status === 'completed').sort(byUpdatedDesc);

  renderInlineList(els.preparingList, preparing);
  renderInlineList(els.deliveryList, delivery);
  renderInlineList(els.completedList, completed);
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
