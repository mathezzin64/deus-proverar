const initialActiveTab = localStorage.getItem('deus-proverar-tab') || 'inicio';

const state = {
  products: [],
  orders: [],
  cart: readJson('deus-proverar-cart', []),
  checkout: readJson('deus-proverar-checkout', {
    customerName: '',
    phone: '',
    address: '',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    cashReceived: '',
    notes: ''
  }),
  summary: null,
  category: 'Todos',
  search: '',
  activeTab: initialActiveTab,
  adminOpen: initialActiveTab === 'fila' || initialActiveTab === 'produtos',
  productEditingId: null,
  toast: '',
  touchStartY: 0,
  refreshing: false
};

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const statusLabels = {
  pending: 'Nao pago',
  paid: 'Pago',
  cancelled: 'Cancelado',
  not_received: 'Nao recebido',
  received: 'Recebido',
  waiting: 'Na fila',
  preparing: 'Preparando',
  out: 'Saiu para entrega',
  delivered: 'Entregue'
};

const app = document.querySelector('#app');

init();

async function init() {
  render();
  await loadState();
  setInterval(loadState, 5000);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  const response = await fetch(path, { ...options, headers });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erro na solicitacao.');
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function loadState() {
  try {
    const [data, summary] = await Promise.all([api('/api/state'), api('/api/summary')]);
    state.products = data.products || [];
    state.orders = data.orders || [];
    state.summary = summary;
    render();
  } catch (error) {
    showToast(error.message);
  }
}

function render() {
  app.innerHTML = `
    <main class="shell">
      <div class="pull-refresh ${state.refreshing ? 'active' : ''}">Atualizando...</div>
      <header class="topbar">
        <div class="brand">
          <img src="/logo.svg" alt="DEUS PROVERAR" />
          <div>
            <strong>DEUS PROVERAR</strong>
            <span>Churrasco e lanches</span>
          </div>
        </div>
      </header>

      <nav class="app-menu" aria-label="Menu principal">
        ${tabButton('inicio', 'Inicio')}
        ${tabButton('fila', 'Fila')}
        ${tabButton('produtos', 'Produtos')}
        ${tabButton('painel', 'Painel')}
      </nav>

      ${activePageTemplate()}
    </main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
  `;

  bindEvents();
}

function tabButton(tab, label) {
  return `<button class="${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}" type="button">${label}</button>`;
}

function activePageTemplate() {
  if (state.activeTab === 'fila') {
    return `<section class="page single-page"><div class="main-column">${ordersTemplate()}</div></section>`;
  }

  if (state.activeTab === 'produtos') {
    return `<section class="page single-page"><div class="main-column">${adminTemplate()}</div></section>`;
  }

  if (state.activeTab === 'painel') {
    return `<section class="page single-page"><div class="main-column">${summaryTemplate()}</div></section>`;
  }

  return `
    <section class="page">
      <div class="main-column">${catalogTemplate()}</div>
      <aside class="side-column">${cartTemplate()}</aside>
    </section>
  `;
}

function catalogTemplate() {
  const categories = ['Todos', ...new Set(state.products.map(product => product.category || 'Lanches'))];
  const products = filteredProducts();

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Cardapio</p>
          <h1>Lanches para pedir agora</h1>
        </div>
        <span class="tag gold">${products.length} itens</span>
      </div>

      <div class="catalog-tools">
        <input class="input" data-search placeholder="Buscar lanche, bebida ou descricao" value="${escapeHtml(state.search)}" />
        <select class="select" data-category>
          ${categories.map(category => `<option ${category === state.category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}
        </select>
      </div>

      <div class="product-grid">
        ${products.map(productCardTemplate).join('') || `<p class="empty">Nenhum produto disponivel agora.</p>`}
      </div>
    </section>
  `;
}

function productCardTemplate(product) {
  const stock = Number(product.stock || 0);
  const canSell = product.available && stock > 0;

  return `
    <article class="product-card ${canSell ? '' : 'sold-out'}">
      <img class="product-image" src="${escapeHtml(product.image || '/logo.svg')}" alt="${escapeHtml(product.name)}" />
      <div class="product-top">
        <div>
          <span class="tag">${escapeHtml(product.category || 'Lanches')}</span>
          ${product.highlight ? `<span class="tag gold">Destaque</span>` : ''}
          <span class="tag ${stock > 0 ? 'blue' : 'red'}">${stock > 0 ? `${stock} em estoque` : 'Esgotado'}</span>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description)}</p>
        </div>
        <strong class="price">${money.format(product.price)}</strong>
      </div>
      <button class="button" data-add-cart="${product.id}" ${canSell ? '' : 'disabled'} type="button">
        ${canSell ? 'Adicionar ao pedido' : 'Esgotado'}
      </button>
    </article>
  `;
}

function cartTemplate() {
  const items = cartItems();
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cashReceived = Number(state.checkout.cashReceived || 0);
  const changeDue = state.checkout.paymentMethod === 'cash' && cashReceived > 0 ? Math.max(0, cashReceived - total) : 0;

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Seu pedido</p>
          <h2>Carrinho</h2>
        </div>
        <span class="tag">${items.length} itens</span>
      </div>

      <div class="cart-list">
        ${items.map(cartItemTemplate).join('') || `<p class="cart-empty">Escolha os produtos para montar o pedido.</p>`}
      </div>

      <div class="total-line">
        <span>Total</span>
        <strong>${money.format(total)}</strong>
      </div>

      <form class="checkout-form" data-checkout>
        <input class="input" name="customerName" data-checkout-field placeholder="Seu nome" value="${escapeHtml(state.checkout.customerName)}" required />
        <input class="input" name="phone" data-checkout-field placeholder="WhatsApp (opcional)" value="${escapeHtml(state.checkout.phone)}" />
        <input class="input" name="address" data-checkout-field placeholder="Endereco para entrega (opcional)" value="${escapeHtml(state.checkout.address)}" />
        <select class="select" name="paymentMethod" required>
          ${['cash', 'pix', 'credit', 'debit'].map(method => `<option value="${method}" ${method === state.checkout.paymentMethod ? 'selected' : ''}>${paymentMethodLabel(method)}</option>`).join('')}
        </select>
        ${
          state.checkout.paymentMethod === 'cash'
            ? `
              <input class="input" name="cashReceived" data-checkout-field type="number" step="0.01" min="0" placeholder="Valor que a pessoa deu em dinheiro" value="${escapeHtml(state.checkout.cashReceived)}" />
              <div class="change-box">
                <span>Troco</span>
                <strong data-change-due>${money.format(changeDue)}</strong>
              </div>
            `
            : ''
        }
        <select class="select" name="paymentStatus" required>
          <option value="pending" ${state.checkout.paymentStatus === 'pending' ? 'selected' : ''}>Vai pagar ainda</option>
          <option value="paid" ${state.checkout.paymentStatus === 'paid' ? 'selected' : ''}>Ja pagou</option>
        </select>
        <textarea class="textarea" name="notes" data-checkout-field placeholder="Observacoes: ponto da carne, troco, retirada...">${escapeHtml(state.checkout.notes)}</textarea>
        <button class="button" ${items.length ? '' : 'disabled'} type="submit">Enviar pedido</button>
      </form>
    </section>
  `;
}

function cartItemTemplate(item) {
  return `
    <article class="cart-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <small>${money.format(item.price)} cada - ${item.stock} disponivel</small>
      </div>
      <div class="quantity">
        <button data-cart-dec="${item.productId}" type="button">-</button>
        <span>${item.quantity}</span>
        <button data-cart-inc="${item.productId}" ${item.quantity >= item.stock ? 'disabled' : ''} type="button">+</button>
      </div>
    </article>
  `;
}

function ordersTemplate() {
  const orders = [...state.orders]
    .filter(order => order.deliveryStatus !== 'delivered' && order.deliveryStatus !== 'cancelled')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return `
    <section class="panel" id="orders">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Fila publica</p>
          <h2>Pedidos em ordem de chegada</h2>
        </div>
        <span class="tag gold">Atualiza sozinho</span>
      </div>

      <div class="order-list">
        ${orders.map(orderTemplate).join('') || `<p class="empty">Nenhum pedido ainda. O primeiro pode ser o seu.</p>`}
      </div>
    </section>
  `;
}

function orderTemplate(order) {
  const adminDetails = state.adminOpen ? `
    <ol class="order-items">
      ${order.items.map(item => `<li>${item.quantity}x ${escapeHtml(item.name)} - ${money.format(item.price * item.quantity)}</li>`).join('')}
    </ol>
    ${order.phone || order.address ? `<small>${order.phone ? `Telefone: ${escapeHtml(order.phone)}` : ''}${order.phone && order.address ? ' | ' : ''}${order.address ? `Entrega: ${escapeHtml(order.address)}` : ''}</small>` : ''}
    ${order.paymentMethod === 'cash' ? `<small>Dinheiro recebido: ${money.format(order.cashReceived || 0)} | Troco: ${money.format(order.changeDue || 0)}</small>` : ''}
    ${order.notes ? `<small>${escapeHtml(order.notes)}</small>` : ''}
    <strong class="price">${money.format(order.total)}</strong>
  ` : '';

  return `
    <article class="order-card ${order.paymentStatus === 'paid' ? 'paid' : ''} ${order.deliveryStatus === 'cancelled' ? 'cancelled' : ''}">
      <div class="order-top">
        <div>
          <strong>${escapeHtml(order.customerName)}</strong>
          <small>${escapeHtml(order.code)} - ${formatDate(order.createdAt)}</small>
        </div>
      </div>

      ${adminDetails}

      <div class="order-statuses">
        ${
          order.paymentStatus === 'paid'
            ? `<span class="tag">Pago - falta entregar</span>`
            : `<span class="tag gold">Pagamento pendente</span>`
        }
        <span class="tag ${order.deliveryStatus === 'delivered' ? '' : 'blue'}">${statusLabels[order.deliveryStatus]}</span>
      </div>

      <div class="order-actions">
        <button class="button" data-deliver-order="${order.id}" data-payment-status="${order.paymentStatus}" type="button">Entregue</button>
        <button class="danger-button" data-delete-order="${order.id}" type="button">Excluir pedido</button>
      </div>

      ${state.adminOpen ? adminOrderControlsTemplate(order) : ''}
    </article>
  `;
}

function adminOrderControlsTemplate(order) {
  return `
    <div class="status-controls">
      <select class="select" data-payment="${order.id}">
        ${['pending', 'paid', 'cancelled'].map(status => `<option value="${status}" ${status === order.paymentStatus ? 'selected' : ''}>${statusLabels[status]}</option>`).join('')}
      </select>
      <select class="select" data-payment-method="${order.id}">
        ${['cash', 'pix', 'credit', 'debit'].map(method => `<option value="${method}" ${method === (order.paymentMethod || 'cash') ? 'selected' : ''}>${paymentMethodLabel(method)}</option>`).join('')}
      </select>
      <select class="select" data-received="${order.id}">
        ${['not_received', 'received'].map(status => `<option value="${status}" ${status === (order.receivedStatus || 'not_received') ? 'selected' : ''}>${statusLabels[status]}</option>`).join('')}
      </select>
      <select class="select" data-delivery="${order.id}">
        ${['waiting', 'preparing', 'out', 'delivered', 'cancelled'].map(status => `<option value="${status}" ${status === order.deliveryStatus ? 'selected' : ''}>${statusLabels[status]}</option>`).join('')}
      </select>
    </div>
  `;
}

function summaryTemplate() {
  const summary = state.summary || {
    totalSold: 0,
    byPaymentMethod: { cash: 0, pix: 0, credit: 0, debit: 0 },
    ordersCount: 0,
    paidCount: 0,
    pendingPaymentCount: 0,
    deliveredCount: 0,
    waitingDeliveryCount: 0
  };
  const sales = [...state.orders]
    .filter(order => order.paymentStatus === 'paid' || order.deliveryStatus === 'delivered')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Controle</p>
          <h2>Resumo de vendas</h2>
        </div>
      </div>
      <div class="summary-grid">
        ${metricTemplate('Vendido', money.format(summary.totalSold))}
        ${metricTemplate('Pedidos', summary.ordersCount)}
        ${metricTemplate('Pagos', summary.paidCount)}
        ${metricTemplate('A receber', summary.pendingPaymentCount)}
        ${metricTemplate('Entregues', summary.deliveredCount)}
        ${metricTemplate('Na entrega', summary.waitingDeliveryCount)}
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Recebimentos</p>
          <h2>Total por forma de pagamento</h2>
        </div>
      </div>
      <div class="summary-grid">
        ${metricTemplate('Dinheiro', money.format(summary.byPaymentMethod?.cash || 0))}
        ${metricTemplate('PIX', money.format(summary.byPaymentMethod?.pix || 0))}
        ${metricTemplate('Credito', money.format(summary.byPaymentMethod?.credit || 0))}
        ${metricTemplate('Debito', money.format(summary.byPaymentMethod?.debit || 0))}
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Historico</p>
          <h2>Lista de vendas</h2>
        </div>
        <span class="tag">${sales.length} vendas</span>
      </div>
      <div class="sale-list">
        ${sales.map(saleTemplate).join('') || `<p class="empty">Nenhuma venda concluida ainda.</p>`}
      </div>
    </section>
  `;
}

function saleTemplate(order) {
  return `
    <article class="sale-card">
      <div>
        <strong>${escapeHtml(order.customerName)}</strong>
        <small>${escapeHtml(order.code)} - ${formatDate(order.createdAt)} - ${paymentMethodLabel(order.paymentMethod)}</small>
      </div>
      <strong class="price">${money.format(order.total)}</strong>
      <button class="danger-button" data-delete-order="${order.id}" type="button">Excluir venda</button>
    </article>
  `;
}

function metricTemplate(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function adminTemplate() {
  const editingProduct = state.products.find(product => product.id === state.productEditingId);

  return `
    <section class="panel admin-shell active">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Controle livre</p>
          <h2>Produtos e pedidos</h2>
        </div>
        <span class="tag">Sem senha</span>
      </div>

      <form class="admin-form" data-product-form>
        <input type="hidden" name="id" value="${editingProduct?.id || ''}" />
        <input class="input" name="name" placeholder="Nome do produto" value="${escapeHtml(editingProduct?.name || '')}" required />
        <input class="input" name="category" placeholder="Categoria" value="${escapeHtml(editingProduct?.category || 'Lanches')}" required />
        <input class="input" name="price" type="number" step="0.01" min="0" placeholder="Valor" value="${editingProduct?.price || ''}" required />
        <input class="input" name="stock" type="number" step="1" min="0" placeholder="Quantidade em estoque" value="${editingProduct?.stock ?? ''}" required />
        <input class="input" name="image" placeholder="Imagem ou URL" value="${escapeHtml(editingProduct?.image || '')}" />
        <textarea class="textarea" name="description" placeholder="Descricao do produto" required>${escapeHtml(editingProduct?.description || '')}</textarea>
        <label><input name="available" type="checkbox" ${editingProduct?.available ?? true ? 'checked' : ''} /> Produto disponivel</label>
        <label><input name="highlight" type="checkbox" ${editingProduct?.highlight ? 'checked' : ''} /> Marcar como destaque</label>
        <button class="button" type="submit">${editingProduct ? 'Salvar produto' : 'Adicionar produto'}</button>
        ${editingProduct ? `<button class="ghost-button" data-cancel-edit type="button">Cancelar edicao</button>` : ''}
      </form>
      <div class="admin-list">
        ${state.products.map(adminProductTemplate).join('')}
      </div>
    </section>
  `;
}

function adminProductTemplate(product) {
  return `
    <article class="admin-product">
      <div class="product-top">
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(product.category)} - ${money.format(product.price)}</small>
          <small>Estoque: ${Number(product.stock || 0)}</small>
        </div>
        <span class="tag ${product.available && Number(product.stock || 0) > 0 ? '' : 'red'}">${product.available && Number(product.stock || 0) > 0 ? 'Ativo' : 'Esgotado'}</span>
      </div>
      <div class="nav-actions">
        <button class="ghost-button" data-edit-product="${product.id}" type="button">Editar</button>
        <button class="danger-button" data-delete-product="${product.id}" type="button">Excluir</button>
      </div>
    </article>
  `;
}

function bindEvents() {
  document.querySelector('[data-search]')?.addEventListener('input', event => {
    state.search = event.target.value;
    render();
  });

  document.querySelector('[data-category]')?.addEventListener('change', event => {
    state.category = event.target.value;
    render();
  });

  document.querySelectorAll('[data-add-cart]').forEach(button => {
    button.addEventListener('click', () => addToCart(button.dataset.addCart));
  });

  document.querySelectorAll('[data-cart-inc]').forEach(button => {
    button.addEventListener('click', () => changeCartQuantity(button.dataset.cartInc, 1));
  });

  document.querySelectorAll('[data-cart-dec]').forEach(button => {
    button.addEventListener('click', () => changeCartQuantity(button.dataset.cartDec, -1));
  });

  document.querySelector('[data-checkout]')?.addEventListener('submit', submitOrder);
  document.querySelectorAll('[data-checkout] input, [data-checkout] textarea, [data-checkout] select').forEach(field => {
    field.addEventListener('input', updateCheckoutDraft);
    field.addEventListener('change', updateCheckoutDraft);
  });
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      state.adminOpen = button.dataset.tab === 'produtos' || button.dataset.tab === 'fila';
      localStorage.setItem('deus-proverar-tab', state.activeTab);
      render();
    });
  });

  if (state.activeTab === 'produtos' || state.activeTab === 'fila') {
    state.adminOpen = true;
  }

  document.querySelector('[data-admin-toggle]')?.addEventListener('click', () => {
    state.adminOpen = !state.adminOpen;
    render();
  });

  document.querySelector('[data-scroll="orders"]')?.addEventListener('click', () => {
    document.querySelector('#orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.querySelector('[data-product-form]')?.addEventListener('submit', submitProduct);

  document.querySelector('[data-cancel-edit]')?.addEventListener('click', () => {
    state.productEditingId = null;
    render();
  });

  document.querySelectorAll('[data-edit-product]').forEach(button => {
    button.addEventListener('click', () => {
      state.productEditingId = button.dataset.editProduct;
      render();
    });
  });

  document.querySelectorAll('[data-delete-product]').forEach(button => {
    button.addEventListener('click', () => deleteProduct(button.dataset.deleteProduct));
  });

  document.querySelectorAll('[data-payment]').forEach(select => {
    select.addEventListener('change', () => updateOrder(select.dataset.payment, { paymentStatus: select.value }));
  });

  document.querySelectorAll('[data-payment-method]').forEach(select => {
    select.addEventListener('change', () => updateOrder(select.dataset.paymentMethod, { paymentMethod: select.value }));
  });

  document.querySelectorAll('[data-received]').forEach(select => {
    select.addEventListener('change', () => updateOrder(select.dataset.received, { receivedStatus: select.value }));
  });

  document.querySelectorAll('[data-delivery]').forEach(select => {
    select.addEventListener('change', () => updateOrder(select.dataset.delivery, { deliveryStatus: select.value }));
  });

  document.querySelectorAll('[data-delete-order]').forEach(button => {
    button.addEventListener('click', () => deleteOrder(button.dataset.deleteOrder));
  });

  document.querySelectorAll('[data-deliver-order]').forEach(button => {
    button.addEventListener('click', () => markDelivered(button.dataset.deliverOrder, button.dataset.paymentStatus));
  });

  window.removeEventListener('touchstart', handlePullStart);
  window.removeEventListener('touchend', handlePullEnd);
  window.addEventListener('touchstart', handlePullStart, { passive: true });
  window.addEventListener('touchend', handlePullEnd, { passive: true });
}

function filteredProducts() {
  return state.products.filter(product => {
    const matchesCategory = state.category === 'Todos' || product.category === state.category;
    const haystack = `${product.name} ${product.description} ${product.category}`.toLowerCase();
    return matchesCategory && haystack.includes(state.search.toLowerCase());
  });
}

function cartItems() {
  return state.cart
    .map(item => {
      const product = state.products.find(candidate => candidate.id === item.productId);
      if (!product) return null;
      return { ...item, name: product.name, price: Number(product.price), stock: Number(product.stock || 0) };
    })
    .filter(Boolean);
}

function addToCart(productId) {
  const product = state.products.find(candidate => candidate.id === productId);
  const stock = Number(product?.stock || 0);

  if (!product?.available || stock <= 0) {
    showToast('Produto sem estoque no momento.');
    return;
  }

  const existing = state.cart.find(item => item.productId === productId);

  if (existing) {
    if (existing.quantity >= stock) {
      showToast(`So temos ${stock} unidade(s) em estoque.`);
      return;
    }

    existing.quantity += 1;
  } else {
    state.cart.push({ productId, quantity: 1 });
  }

  saveCart();
  showToast('Produto adicionado ao pedido.');
}

function changeCartQuantity(productId, amount) {
  const product = state.products.find(candidate => candidate.id === productId);
  const stock = Number(product?.stock || 0);

  state.cart = state.cart
    .map(item => {
      if (item.productId !== productId) {
        return item;
      }

      return { ...item, quantity: Math.min(stock, item.quantity + amount) };
    })
    .filter(item => item.quantity > 0);
  saveCart();
}

function saveCart() {
  localStorage.setItem('deus-proverar-cart', JSON.stringify(state.cart));
  render();
}

async function submitOrder(event) {
  event.preventDefault();

  if (!state.cart.length) {
    showToast('Adicione pelo menos um produto.');
    return;
  }

  const form = new FormData(event.target);
  const payload = {
    customerName: form.get('customerName'),
    phone: form.get('phone'),
    address: form.get('address'),
    notes: form.get('notes'),
    paymentMethod: form.get('paymentMethod'),
    paymentStatus: form.get('paymentStatus'),
    cashReceived: form.get('cashReceived'),
    items: state.cart
  };

  try {
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    state.cart = [];
    state.checkout = {
      customerName: '',
      phone: '',
      address: '',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      cashReceived: '',
      notes: ''
    };
    localStorage.removeItem('deus-proverar-checkout');
    saveCart();
    event.target.reset();
    showToast('Pedido enviado e entrou na fila.');
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
}

function updateCheckoutDraft(event) {
  state.checkout = {
    ...state.checkout,
    [event.target.name]: event.target.value
  };
  localStorage.setItem('deus-proverar-checkout', JSON.stringify(state.checkout));

  if (event.target.name === 'paymentMethod') {
    render();
  }

  if (event.target.name === 'cashReceived') {
    const total = cartItems().reduce((sum, item) => sum + item.price * item.quantity, 0);
    const changeDue = Math.max(0, Number(event.target.value || 0) - total);
    const output = document.querySelector('[data-change-due]');

    if (output) {
      output.textContent = money.format(changeDue);
    }
  }
}

async function submitProduct(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const id = form.get('id');
  const payload = {
    name: form.get('name'),
    category: form.get('category'),
    price: Number(form.get('price')),
    stock: Number(form.get('stock')),
    description: form.get('description'),
    image: form.get('image'),
    available: form.get('available') === 'on',
    highlight: form.get('highlight') === 'on'
  };

  try {
    await api(id ? `/api/products/${id}` : '/api/products', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    state.productEditingId = null;
    showToast(id ? 'Produto atualizado.' : 'Produto adicionado.');
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteProduct(productId) {
  if (!confirm('Excluir este produto?')) return;

  try {
    await api(`/api/products/${productId}`, { method: 'DELETE' });
    showToast('Produto excluido.');
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
}

async function updateOrder(orderId, payload) {
  try {
    await api(`/api/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
}

async function markDelivered(orderId, paymentStatus) {
  const payload = { deliveryStatus: 'delivered', receivedStatus: 'received' };

  if (paymentStatus !== 'paid') {
    const alreadyPaid = confirm('Esse pedido ainda esta com pagamento pendente. A pessoa ja pagou?');

    if (!alreadyPaid) {
      showToast('Pedido continua na fila aguardando pagamento.');
      return;
    }

    payload.paymentStatus = 'paid';
  }

  try {
    await api(`/api/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    showToast('Pedido marcado como entregue.');
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteOrder(orderId) {
  if (!confirm('Remover este pedido da fila?')) return;

  try {
    await api(`/api/orders/${orderId}`, { method: 'DELETE' });
    showToast('Pedido removido.');
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = '';
    render();
  }, 2600);
}

function handlePullStart(event) {
  if (window.scrollY <= 0) {
    state.touchStartY = event.touches?.[0]?.clientY || 0;
  }
}

async function handlePullEnd(event) {
  const endY = event.changedTouches?.[0]?.clientY || 0;
  const pulled = endY - state.touchStartY;

  if (window.scrollY <= 0 && pulled > 70 && !state.refreshing) {
    state.refreshing = true;
    render();
    await loadState();
    state.refreshing = false;
    showToast('App atualizado.');
  }
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function paymentMethodLabel(method) {
  return {
    cash: 'Dinheiro',
    pix: 'PIX',
    credit: 'Credito',
    debit: 'Debito'
  }[method] || 'Dinheiro';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}
