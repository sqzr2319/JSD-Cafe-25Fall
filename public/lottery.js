const API_BASE = '';

const els = {
  drawBtn: document.getElementById('draw-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  summary: document.getElementById('lottery-summary'),
  result: document.getElementById('lottery-result'),
  list: document.getElementById('eligible-list'),
};

let eligibleOrders = [];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function renderEligible() {
  els.list.innerHTML = '';
  if (!eligibleOrders.length) {
    const empty = document.createElement('div');
    empty.className = 'lottery-inline';
    empty.textContent = '暂无符合抽奖资格的点单';
    els.list.appendChild(empty);
    return;
  }

  const sorted = [...eligibleOrders].sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true }));
  const inline = document.createElement('div');
  inline.className = 'lottery-inline';
  inline.textContent = sorted.map((o) => `#${o.id}`).join('  ');
  els.list.appendChild(inline);
}

async function loadEligible() {
  els.summary.textContent = '加载候选中...';
  const res = await fetch(`${API_BASE}/api/lottery/eligible`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '加载失败');

  eligibleOrders = data.orders || [];
  els.summary.textContent = `已完成: ${data.totalCompleted} 单，符合抽奖资格: ${data.eligibleCount} 单`;
  renderEligible();
}

function draw() {
  if (!eligibleOrders.length) {
    els.result.textContent = '当前没有符合抽奖资格的点单';
    return;
  }

  const luckyNumber = randomInt(1, eligibleOrders.length);
  const sorted = [...eligibleOrders].sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true }));
  const winner = sorted[luckyNumber - 1];
  els.result.innerHTML = `
    <div class="lottery-hit-title">#${winner.id}</div>
    <div class="lottery-hit-detail">点单内容：${winner.items}</div>
    <div class="lottery-hit-detail">时间：${new Date(winner.createdAt).toLocaleString()}</div>
  `;
}

els.drawBtn.addEventListener('click', draw);
els.refreshBtn.addEventListener('click', () => {
  loadEligible().catch((err) => {
    els.summary.textContent = err.message;
  });
});

loadEligible().catch((err) => {
  els.summary.textContent = err.message;
});
