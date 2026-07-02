const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'database.json');
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || 'deus_proverar';
let mongoCollection = null;

const defaultProducts = [
  {
    id: 'churrasco-completo',
    name: 'CHURRASCO COMPLETO',
    description: 'Churrasco mais refrigerante de 200 ml.',
    price: 23,
    category: 'Lanches',
    image: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=900&q=80',
    stock: 20,
    available: true,
    highlight: true
  },
  {
    id: 'churrasco',
    name: 'CHURRASCO',
    description: 'Completo.',
    price: 20,
    category: 'Lanches',
    image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=900&q=80',
    stock: 20,
    available: true,
    highlight: true
  },
  {
    id: 'agua',
    name: 'Agua',
    description: 'Agua mineral gelada.',
    price: 3,
    category: 'Bebidas',
    image: 'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=900&q=80',
    stock: 40,
    available: true,
    highlight: false
  },
  {
    id: 'salgado',
    name: 'Salgado',
    description: 'Salgado pronto para lanche.',
    price: 8,
    category: 'Salgados',
    image: 'https://images.unsplash.com/photo-1626200419199-391ae4be7a41?auto=format&fit=crop&w=900&q=80',
    stock: 30,
    available: true,
    highlight: false
  }
].map(product => ({ ...product, createdAt: new Date().toISOString() }));

const initialData = {
  products: defaultProducts,
  orders: []
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function getMongoCollection() {
  if (!mongoUri) {
    return null;
  }

  if (mongoCollection) {
    return mongoCollection;
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  mongoCollection = client.db(mongoDbName).collection('app_state');
  return mongoCollection;
}

async function ensureDatabase() {
  const collection = await getMongoCollection();

  if (collection) {
    const existing = await collection.findOne({ _id: 'main' });

    if (!existing) {
      await collection.updateOne({ _id: 'main' }, { $set: initialData }, { upsert: true });
      return;
    }

    const migrated = migrateData(existing);
    await collection.updateOne({ _id: 'main' }, { $set: migrated }, { upsert: true });
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(dataFile);
    const data = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    await writeData(migrateData(data));
  } catch {
    await writeData(initialData);
  }
}

async function readData() {
  await ensureDatabase();
  const collection = await getMongoCollection();

  if (collection) {
    const data = await collection.findOne({ _id: 'main' });
    return migrateData(data || initialData);
  }

  const raw = await fs.readFile(dataFile, 'utf8');
  return JSON.parse(raw);
}

async function writeData(data) {
  const collection = await getMongoCollection();

  if (collection) {
    await collection.updateOne({ _id: 'main' }, { $set: migrateData(data) }, { upsert: true });
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
}

function migrateData(data) {
  const safeData = {
    products: Array.isArray(data?.products) ? data.products : [],
    orders: Array.isArray(data?.orders) ? data.orders : []
  };

  const hasOldSamples = safeData.products.some(product => product.id === 'lanche-001' || product.id === 'bebida-001');
  const hasDefaultProducts = defaultProducts.every(product => safeData.products.some(saved => saved.id === product.id));

  if (hasOldSamples || !hasDefaultProducts) {
    const customProducts = safeData.products.filter(product => {
      const defaultId = defaultProducts.some(defaultProduct => defaultProduct.id === product.id);
      const oldSample = product.id === 'lanche-001' || product.id === 'bebida-001';
      return !defaultId && !oldSample;
    });
    safeData.products = [...defaultProducts, ...customProducts];
  } else {
    safeData.products = safeData.products.map(product => {
      const defaultProduct = defaultProducts.find(candidate => candidate.id === product.id);
      return defaultProduct
        ? {
            ...product,
            ...defaultProduct,
            stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : defaultProduct.stock,
            available: product.available ?? defaultProduct.available,
            highlight: product.highlight ?? defaultProduct.highlight
          }
        : { ...product, stock: Number(product.stock || 0) };
    });
  }

  return safeData;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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
    byPaymentMethod: {
      cash: paidOrders.filter(order => order.paymentMethod === 'cash').reduce((sum, order) => sum + Number(order.total || 0), 0),
      pix: paidOrders.filter(order => order.paymentMethod === 'pix').reduce((sum, order) => sum + Number(order.total || 0), 0),
      credit: paidOrders.filter(order => order.paymentMethod === 'credit').reduce((sum, order) => sum + Number(order.total || 0), 0),
      debit: paidOrders.filter(order => order.paymentMethod === 'debit').reduce((sum, order) => sum + Number(order.total || 0), 0)
    },
    ordersCount: data.orders.length,
    paidCount: paidOrders.length,
    pendingPaymentCount: data.orders.filter(order => order.paymentStatus !== 'paid').length,
    deliveredCount: deliveredOrders.length,
    waitingDeliveryCount: waitingOrders.length
  });
});

app.post('/api/products', async (req, res) => {
  const { name, description, price, category, image, stock = 0, available = true, highlight = false } = req.body;

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
    image: String(image || '').trim(),
    stock: Math.max(0, Number(stock || 0)),
    available: Boolean(available),
    highlight: Boolean(highlight),
    createdAt: new Date().toISOString()
  };

  data.products.unshift(product);
  await writeData(data);
  res.status(201).json(product);
});

app.put('/api/products/:id', async (req, res) => {
  const data = await readData();
  const index = data.products.findIndex(product => product.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Produto nao encontrado.' });
  }

  data.products[index] = {
    ...data.products[index],
    name: String(req.body.name ?? data.products[index].name).trim(),
    description: String(req.body.description ?? data.products[index].description).trim(),
    price: Number(req.body.price ?? data.products[index].price),
    category: String(req.body.category ?? data.products[index].category).trim(),
    image: String(req.body.image ?? data.products[index].image ?? '').trim(),
    stock: Math.max(0, Number(req.body.stock ?? data.products[index].stock ?? 0)),
    available: Boolean(req.body.available),
    highlight: Boolean(req.body.highlight),
    updatedAt: new Date().toISOString()
  };

  await writeData(data);
  res.json(data.products[index]);
});

app.delete('/api/products/:id', async (req, res) => {
  const data = await readData();
  data.products = data.products.filter(product => product.id !== req.params.id);
  await writeData(data);
  res.status(204).end();
});

app.post('/api/orders', async (req, res) => {
  const { customerName, phone, address, notes, items, paymentMethod, paymentStatus, cashReceived } = req.body;

  if (!customerName || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Informe o nome e pelo menos um produto.' });
  }

  const data = await readData();
  const orderItems = items
    .map(item => {
      const product = data.products.find(candidate => candidate.id === item.productId && candidate.available && Number(candidate.stock || 0) > 0);
      if (!product) return null;
      return {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: Math.max(1, Number(item.quantity || 1)),
        stock: Number(product.stock || 0)
      };
    })
    .filter(Boolean);

  if (!orderItems.length) {
    return res.status(400).json({ error: 'Nenhum produto disponivel no pedido.' });
  }

  const outOfStock = orderItems.find(item => item.quantity > item.stock);

  if (outOfStock) {
    return res.status(400).json({ error: `Estoque insuficiente para ${outOfStock.name}. Disponivel: ${outOfStock.stock}.` });
  }

  const total = orderTotal(orderItems, data.products);
  const safePaymentMethod = ['pix', 'credit', 'debit', 'cash'].includes(paymentMethod) ? paymentMethod : 'cash';
  const safeCashReceived = safePaymentMethod === 'cash' ? Math.max(0, Number(cashReceived || 0)) : 0;

  data.products = data.products.map(product => {
    const orderItem = orderItems.find(item => item.productId === product.id);

    if (!orderItem) {
      return product;
    }

    const nextStock = Math.max(0, Number(product.stock || 0) - orderItem.quantity);
    return { ...product, stock: nextStock, available: product.available && nextStock > 0 };
  });

  const order = {
    id: makeId('pedido'),
    code: `DP-${String(data.orders.length + 1).padStart(3, '0')}`,
    customerName: String(customerName).trim(),
    phone: String(phone || '').trim(),
    address: String(address || '').trim(),
    notes: String(notes || '').trim(),
    items: orderItems.map(({ stock, ...item }) => item),
    total,
    paymentMethod: safePaymentMethod,
    cashReceived: safeCashReceived,
    changeDue: safePaymentMethod === 'cash' ? Math.max(0, safeCashReceived - total) : 0,
    paymentStatus: paymentStatus === 'paid' ? 'paid' : 'pending',
    receivedStatus: 'not_received',
    deliveryStatus: 'waiting',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.orders.push(order);
  await writeData(data);
  res.status(201).json(order);
});

app.patch('/api/orders/:id', async (req, res) => {
  const data = await readData();
  const index = data.orders.findIndex(order => order.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Pedido nao encontrado.' });
  }

  const allowedPayment = ['pending', 'paid', 'cancelled'];
  const allowedReceived = ['not_received', 'received'];
  const allowedDelivery = ['waiting', 'preparing', 'out', 'delivered', 'cancelled'];

  if (allowedPayment.includes(req.body.paymentStatus)) {
    data.orders[index].paymentStatus = req.body.paymentStatus;
  }

  if (['pix', 'credit', 'debit', 'cash'].includes(req.body.paymentMethod)) {
    data.orders[index].paymentMethod = req.body.paymentMethod;
  }

  if (allowedReceived.includes(req.body.receivedStatus)) {
    data.orders[index].receivedStatus = req.body.receivedStatus;
  }

  if (allowedDelivery.includes(req.body.deliveryStatus)) {
    data.orders[index].deliveryStatus = req.body.deliveryStatus;
  }

  data.orders[index].updatedAt = new Date().toISOString();
  await writeData(data);
  res.json(data.orders[index]);
});

app.delete('/api/orders/:id', async (req, res) => {
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
