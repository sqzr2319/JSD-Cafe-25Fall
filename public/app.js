const API_BASE = ''; // 可替换为占位符服务器地址，如 'https://example.com'

const els = {
  form: document.getElementById('order-form'),
  id: document.getElementById('order-id'),
  items: document.getElementById('order-items'),
  formStatus: document.getElementById('form-status'),
  waitingList: document.getElementById('waiting-list'),
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

function orderCard(order) {
  const div = document.createElement('div');
  div.className = 'order';
  div.dataset.id = order.id;
  div.innerHTML = `
    <div class="meta">
      <strong>#${order.id}</strong>
      <span class="muted">${order.status === 'waiting' ? '等待中' : '已完成'}</span>
    </div>
    <div class="items">${order.items}</div>
    <div class="times muted">创建: ${fmtTime(order.createdAt)}${order.updatedAt !== order.createdAt ? ` · 更新: ${fmtTime(order.updatedAt)}` : ''}</div>
  `;

  // 只有咖啡师能看到完成按钮
  if (order.status === 'waiting' && role === 'barista') {
    const btn = document.createElement('button');
    btn.textContent = '完成点单';
    btn.className = 'complete';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await fetch(`${API_BASE}/api/orders/${encodeURIComponent(order.id)}/complete`, { method: 'PATCH' });
      } catch (err) {
        console.error(err);
      } finally {
        btn.disabled = false;
      }
    };
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(btn);
    div.appendChild(actions);
  }
  return div;
}

function renderLists(all) {
  const waiting = all.filter(o => o.status === 'waiting');
  const completed = all.filter(o => o.status === 'completed');

  els.waitingList.innerHTML = '';
  els.completedList.innerHTML = '';

  waiting.forEach(o => els.waitingList.appendChild(orderCard(o)));
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

// 语音播报（中文）
function speak(text) {
  try {
    const s = new SpeechSynthesisUtterance(text);
    s.lang = 'zh-CN';
    // 尝试选择中文语音
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const zh = voices.find(v => /zh|chinese|中文/i.test(v.lang + ' ' + v.name));
    if (zh) s.voice = zh;
    window.speechSynthesis.speak(s);
  } catch (_) {}
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
    if (role === 'barista') {
      speak(`有新点单${order.id}号`);
    }
  });
  es.addEventListener('orders:updated', (ev) => {
    const order = JSON.parse(ev.data);
    const idx = current.findIndex(o => o.id === order.id);
    if (idx >= 0) current[idx] = order; else current.push(order);
    window.__currentOrders = current;
    renderLists(current);
    if (order.status === 'completed' && role === 'waiter') {
      speak(`${order.id}号点单已完成`);
    }
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
