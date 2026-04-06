# 咖啡厅在线点单（演示版）

一个极简的在线点单网页与服务端，支持：
- 添加点单（输入点单号与菜品）
- 三状态流转（制作中 -> 待配送 -> 已完成）
- 角色权限（咖啡师：制作中转待配送；服务生：录入点单、待配送转已完成）
- 多用户并发与实时更新（通过 Server-Sent Events）
- 持久化存储（SQLite，重启不丢数据）

## 运行方式

需要 Node.js 18+

```powershell
# 安装依赖
npm install

# 启动服务（默认 http://localhost:3000）
npm start
```

启动后，打开浏览器访问：http://localhost:3000

## 接口约定（可替换为占位符服务器地址）

- GET `/api/orders?status=preparing|delivery_pending|completed` 列出点单
- POST `/api/orders` 添加点单
  - 请求体: `{ id: string, items: string }`
- PATCH `/api/orders/:id/delivery-pending` 咖啡师将点单从制作中改为待配送
- PATCH `/api/orders/:id/complete` 服务生将点单从待配送改为已完成
- PATCH `/api/orders/:id/status` 后台直接修改点单状态
  - 请求体: `{ status: 'preparing' | 'delivery_pending' | 'completed' }`
- DELETE `/api/orders/:id` 删除点单
- GET `/api/lottery/eligible` 获取抽奖可用点单（仅已完成，且点单内容不是只含蛋挞）
- GET `/api/events` 通过 SSE 订阅实时事件（`orders:snapshot`, `orders:created`, `orders:updated`）
  - 另外会推送 `orders:deleted`（仅包含 `{ id }`）

## 子页面

- `http://localhost:3000/admin` 后台管理页（添加点单、改状态、删除）
- `http://localhost:3000/lottery` 抽奖页（基于可抽奖点单范围生成随机结果）

说明：当前使用 SQLite 持久化，数据文件位于 `data/cafe.db`；并发下操作是原子同步的，适用于数十并发演示。后续可换为数据库（如 PostgreSQL / Redis）与消息广播（如 WebSocket / SSE Fanout）。

## 文件结构

- `server.js` 服务端（Express + SSE）
- `public/index.html` 网页界面
- `public/app.js` 前端逻辑
- `public/styles.css` 样式
- `package.json` 脚本与依赖

## 后续可扩展

- 使用数据库持久化点单；
- 增加登录/权限；
- 为点单添加价格、数量、备注等字段；
- 在高并发场景下增加排队与幂等键支持；
