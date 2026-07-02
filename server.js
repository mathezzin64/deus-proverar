const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DEUSPROVERAR2026';
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'database.json');

const initialData = {
  products: [
    {
      id: 'lanche-001',
      name: 'X-Salada',
      description: 'Hamburguer, queijo, presunto, alface, tomate, milho e batata palha.',
      price: 12,
      category: 'Lanches',
      available: true,
      highlight: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'bebida-001',
      name: 'Refrigerante lata',
      description: 'Escolha o sabor na observacao do pedido.',
      price: 5,
      category: 'Bebidas',
      available: true,
      highlight: false,
      createdAt: new Date().toISOString()
    }
  ],
  orders: []
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function ensureDatabase() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(dataFile);
  } catch {
    await writeData(initialData);
  }
}

async function readData() {
  await ensureDatabase();
  const raw = await fs.readFile(dataFile, 'utf8');
  return JSON.parse(raw);
}

async function writeData(data) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function requireAdmin(req, res, next) {
  const password = req.header('x-admin-password');

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha master invalida.' });
  }

  next();
}

function orderTotal(items, products) {
  return items.reduce((sum, item) => {
    const product = products.find(candidate => candidate.id === item.productId);
    const price = product ? Number(product.price) : Number(item.price || 0);
    return sum + price * Number(item.quantity || 1);
  }, 0);
}

app.get('/api/state', async (_req, res) => {
  const data = await readData();
  res.json(data);
});

app.get('/api/summary', async (_req, res) => {
  const data = await readData();
  const paidOrders = data.orders.filter(order => order.paymentStatus === 'paid');
  const deliveredOrders = data.orders.filter(order => order.deliveryStatus === 'delivered');
  const waitingOrders = data.orders.filter(order => order.deliveryStatus !== 'delivered');

  res.json({
    totalSold: paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    ordersCount: data.orders.length,
    paidCount: paidOrders.length,
    pendingPaymentCount: data.orders.filter(order => order.paymentStatus !== 'paid').length,
    deliveredCount: deliveredOrders.length,
    waitingDeliveryCount: waitingOrders.length
  });
});

app.post('/api/products', requireAdmin, async (req, res) => {
  const { name, description, price, category, available = true, highlight = false } = req.body;

  if (!name || !description || Number(price) <= 0) {
    return res.status(400).json({ error: 'Informe nome, descricao e valor valido.' });
  }

  const data = await readData();
  const product = {
    id: makeId('prod'),
    name: String(name).trim(),
    description: String(description).trim(),
    price: Number(price),
    category: String(category || 'Lanches').trim(),
    available: Boolean(available),
    highlight: Boolean(highlight),
    createdAt: new Date().toISOString()
  };

  data.products.unshift(product);
  await writeData(data);
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  const data = await readData();
  const index = data.products.findIndex(product => product.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Produto nao encontrado.' });
  }

  data.products[index] = {
    ...data.products[index],
    name: String(req.body.name || data.products[index].name).trim(),
    description: String(req.body.description || data.products[index].description).trim(),
    price: Number(req.body.price || data.products[index].price),
    category: String(req.body.category || data.products[index].category).trim(),
    available: Boolean(req.body.available),
    highlight: Boolean(req.body.highlight),
    updatedAt: new Date().toISOString()
  };

  await writeData(data);
  res.json(data.products[index]);
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  const data = await readData();
  data.products = data.products.filter(product => product.id !== req.params.id);
  await writeData(data);
  res.status(204).end();
});

app.post('/api/orders', async (req, res) => {
  const { customerName, phone, address, notes, items } = req.body;

  if (!customerName || !phone || !address || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Informe cliente, telefone, endereco e produtos.' });
  }

  const data = await readData();
  const orderItems = items
    .map(item => {
      const product = data.products.find(candidate => candidate.id === item.productId && candidate.available);
      if (!product) return null;
      return {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: Math.max(1, Number(item.quantity || 1))
      };
    })
    .filter(Boolean);

  if (!orderItems.length) {
    return res.status(400).json({ error: 'Nenhum produto disponivel no pedido.' });
  }

  const order = {
    id: makeId('pedido'),
    code: `DP-${String(data.orders.length + 1).padStart(3, '0')}`,
    customerName: String(customerName).trim(),
    phone: String(phone).trim(),
    address: String(address).trim(),
    notes: String(notes || '').trim(),
    items: orderItems,
    total: orderTotal(orderItems, data.products),
    paymentStatus: 'pending',
    deliveryStatus: 'waiting',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.orders.push(order);
  await writeData(data);
  res.status(201).json(order);
});

app.patch('/api/orders/:id', requireAdmin, async (req, res) => {
  const data = await readData();
  const index = data.orders.findIndex(order => order.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Pedido nao encontrado.' });
  }

  const allowedPayment = ['pending', 'paid', 'cancelled'];
  const allowedDelivery = ['waiting', 'preparing', 'out', 'delivered', 'cancelled'];

  if (allowedPayment.includes(req.body.paymentStatus)) {
    data.orders[index].paymentStatus = req.body.paymentStatus;
  }

  if (allowedDelivery.includes(req.body.deliveryStatus)) {
    data.orders[index].deliveryStatus = req.body.deliveryStatus;
  }

  data.orders[index].updatedAt = new Date().toISOString();
  await writeData(data);
  res.json(data.orders[index]);
});

app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
  const data = await readData();
  data.orders = data.orders.filter(order => order.id !== req.params.id);
  await writeData(data);
  res.status(204).end();
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`DEUS PROVERAR rodando na porta ${PORT}`);
  });
});
