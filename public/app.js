const API_BASE = ''; // 可替换为占位符服务器地址，如 'https://example.com'

const els = {
  form: document.getElementById('order-form'),
  id: document.getElementById('order-id'),
  items: document.getElementById('order-items'),
  formStatus: document.getElementById('form-status'),
  preparingList: document.getElementById('preparing-list'),
  deliveryList: document.getElementById('delivery-list'),
  completedList: document.getElementById('completed-list'),
  addCard: document.getElementById('add-card'),
  roleLabel: document.getElementById('role-label'),
  roleSwitch: document.getElementById('role-switch'),
  roleModal: document.getElementById('role-modal'),
  chooseWaiter: document.getElementById('choose-waiter'),
  chooseBarista: document.getElementById('choose-barista'),
};

// role: 'waiter' | 'barista'
let role = null;

function getRole() {
  const r = sessionStorage.getItem('role');
  return r === 'waiter' || r === 'barista' ? r : null;
}

function setRole(r) {
  role = r;
  sessionStorage.setItem('role', r);
  applyRoleUI();
}

function roleName(r) {
  return r === 'barista' ? '咖啡师' : r === 'waiter' ? '服务生' : '未设置';
}

function applyRoleUI() {
  if (els.roleLabel) els.roleLabel.textContent = roleName(role);
  if (els.roleModal) els.roleModal.classList.add('hidden');
  // 服务生可见添加卡片，咖啡师隐藏
  if (els.addCard) els.addCard.style.display = role === 'waiter' ? '' : 'none';
  // 重新渲染列表以应用按钮权限
  if (window.__currentOrders) renderLists(window.__currentOrders);
}

function openRoleModal() {
  if (els.roleModal) els.roleModal.classList.remove('hidden');
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

function orderCard(order) {
  const div = document.createElement('div');
  div.className = 'order';
  div.dataset.id = order.id;
  const timeText = order.status === 'delivery_pending'
    ? `更新: ${fmtTime(order.updatedAt)}`
    : `创建: ${fmtTime(order.createdAt)}${order.updatedAt !== order.createdAt ? ` · 更新: ${fmtTime(order.updatedAt)}` : ''}`;
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

  // 咖啡师：制作中 -> 待配送
  if (order.status === 'preparing' && role === 'barista') {
    const btn = document.createElement('button');
    btn.textContent = '转为待配送';
    btn.className = 'to-delivery';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(order.id)}/delivery-pending`, { method: 'PATCH' });
        if (!res.ok) console.error(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        btn.disabled = false;
      }
    };
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(btn);
    div.classList.add('with-action');
    div.appendChild(actions);
  }

  // 服务生：待配送 -> 已完成
  if (order.status === 'delivery_pending' && role === 'waiter') {
    const btn = document.createElement('button');
    btn.textContent = '标记已完成';
    btn.className = 'complete';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(order.id)}/complete`, { method: 'PATCH' });
        if (!res.ok) console.error(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        btn.disabled = false;
      }
    };
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(btn);
    div.classList.add('with-action');
    div.appendChild(actions);
  }
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

async function addOrder(e) {
  e.preventDefault();
  if (role !== 'waiter') {
    if (els.formStatus) els.formStatus.textContent = '只有服务生可以添加点单';
    setTimeout(() => (els.formStatus.textContent = ''), 1500);
    return;
  }
  const id = els.id.value.trim();
  const items = els.items.value.trim();
  if (!id || !items) return;

  els.formStatus.textContent = '提交中…';
  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '提交失败');
    els.formStatus.textContent = '已添加';
    els.id.value = '';
    els.items.value = '';
  } catch (err) {
    els.formStatus.textContent = err.message;
  } finally {
    setTimeout(() => (els.formStatus.textContent = ''), 1500);
  }
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

els.form.addEventListener('submit', addOrder);

// 角色选择与切换
els.roleSwitch?.addEventListener('click', () => openRoleModal());
els.chooseWaiter?.addEventListener('click', () => setRole('waiter'));
els.chooseBarista?.addEventListener('click', () => setRole('barista'));

// 初始化角色
role = getRole();
if (!role) openRoleModal();
else applyRoleUI();

// 初始加载（容错: 如果 SSE 不可用，退回到轮询）
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
