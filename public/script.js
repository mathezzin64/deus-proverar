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
  productDraft: readJson('deus-proverar-product-draft', {}),
  historyPeriod: null,
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
  await loadState({ forceRender: true });
  setInterval(() => loadState({ background: true }), 5000);
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

async function loadState(options = {}) {
  try {
    const [data, summary] = await Promise.all([api('/api/state'), api('/api/summary')]);
    state.products = data.products || [];
    state.orders = data.orders || [];
    state.summary = summary;

    if (options.forceRender || !isUserEditing()) {
      render();
    }
  } catch (error) {
    if (!options.background) {
      showToast(error.message);
    }
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
        ${tabButton('inicio', 'Inicio', iconSvg('home'))}
        ${tabButton('fila', 'Fila', iconSvg('queue'))}
        ${tabButton('produtos', 'Produtos', iconSvg('box'))}
        ${tabButton('painel', 'Painel', iconSvg('chart'))}
        ${tabButton('historico', 'Historico', iconSvg('history'))}
      </nav>

      ${activePageTemplate()}
    </main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
  `;

  bindEvents();
}

function tabButton(tab, label, icon) {
  return `
    <button class="${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}" type="button" aria-label="${label}">
      ${icon}
      <span>${label}</span>
    </button>
  `;
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

  if (state.activeTab === 'historico') {
    return `<section class="page single-page"><div class="main-column">${historyTemplate()}</div></section>`;
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
        <select class="select" name="paymentMethod" required>
          ${['cash', 'pix', 'credit', 'debit'].map(method => `<option value="${method}" ${method === state.checkout.paymentMethod ? 'selected' : ''}>${paymentMethodLabel(method)}</option>`).join('')}
        </select>
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
  const paidPercent = percentage(summary.paidCount, summary.ordersCount);
  const deliveredPercent = percentage(summary.deliveredCount, summary.ordersCount);
  const paymentTotal = Object.values(summary.byPaymentMethod || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const paymentSlices = [
    { label: 'Dinheiro', value: Number(summary.byPaymentMethod?.cash || 0), color: '#2dd47a' },
    { label: 'PIX', value: Number(summary.byPaymentMethod?.pix || 0), color: '#f3c74f' },
    { label: 'Credito', value: Number(summary.byPaymentMethod?.credit || 0), color: '#56b6ff' },
    { label: 'Debito', value: Number(summary.byPaymentMethod?.debit || 0), color: '#ff7a68' }
  ];

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

    <section class="chart-grid">
      ${donutTemplate('Pagamentos', paymentTotal ? 'Por forma' : 'Sem vendas', paymentTotal ? paymentSlices : [{ label: 'Sem vendas', value: 1, color: '#334139' }], paymentTotal ? money.format(paymentTotal) : 'R$ 0,00')}
      ${ringTemplate('Pedidos pagos', paidPercent, `${summary.paidCount}/${summary.ordersCount || 0}`, '#2dd47a')}
      ${ringTemplate('Pedidos entregues', deliveredPercent, `${summary.deliveredCount}/${summary.ordersCount || 0}`, '#f3c74f')}
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

function historyTemplate() {
  const selected = state.historyPeriod;
  const report = selected ? historyReport(selected) : null;

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Historico</p>
          <h2>Vendas por periodo</h2>
        </div>
      </div>

      <div class="period-actions">
        ${periodButton('day', 'Diario')}
        ${periodButton('week', 'Semana')}
        ${periodButton('month', 'Mes')}
        ${periodButton('year', 'Ano')}
      </div>
    </section>

    ${
      report
        ? `
          <section class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">${report.label}</p>
                <h2>${report.title}</h2>
              </div>
              <button class="button" data-report-pdf type="button">Gerar PDF</button>
            </div>
            <div class="summary-grid">
              ${metricTemplate('Vendido', money.format(report.total))}
              ${metricTemplate('Vendas', report.count)}
              ${metricTemplate('Media', money.format(report.average))}
              ${metricTemplate('Itens', report.items)}
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Recebimentos</p>
                <h2>Forma de pagamento</h2>
              </div>
            </div>
            <div class="summary-grid">
              ${metricTemplate('Dinheiro', money.format(report.byPaymentMethod.cash))}
              ${metricTemplate('PIX', money.format(report.byPaymentMethod.pix))}
              ${metricTemplate('Credito', money.format(report.byPaymentMethod.credit))}
              ${metricTemplate('Debito', money.format(report.byPaymentMethod.debit))}
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Detalhes</p>
                <h2>Vendas do periodo</h2>
              </div>
              <span class="tag">${report.orders.length} vendas</span>
            </div>
            <div class="sale-list">
              ${report.orders.map(saleTemplate).join('') || `<p class="empty">Nenhuma venda paga nesse periodo.</p>`}
            </div>
          </section>
        `
        : ''
    }
  `;
}

function periodButton(period, label) {
  return `<button class="${state.historyPeriod === period ? 'active' : ''}" data-history-period="${period}" type="button">${label}</button>`;
}

function historyReport(period) {
  const now = new Date();
  const { start, end, label } = periodRange(period, now);
  const orders = state.orders
    .filter(order => order.paymentStatus === 'paid')
    .filter(order => {
      const date = new Date(order.createdAt);
      return date >= start && date <= end;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const items = orders.reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
  const byPaymentMethod = {
    cash: orders.filter(order => order.paymentMethod === 'cash').reduce((sum, order) => sum + Number(order.total || 0), 0),
    pix: orders.filter(order => order.paymentMethod === 'pix').reduce((sum, order) => sum + Number(order.total || 0), 0),
    credit: orders.filter(order => order.paymentMethod === 'credit').reduce((sum, order) => sum + Number(order.total || 0), 0),
    debit: orders.filter(order => order.paymentMethod === 'debit').reduce((sum, order) => sum + Number(order.total || 0), 0)
  };

  return {
    label,
    title: periodTitle(period, now),
    orders,
    total,
    items,
    count: orders.length,
    average: orders.length ? total / orders.length : 0,
    byPaymentMethod
  };
}

function periodRange(period, baseDate) {
  const start = new Date(baseDate);
  const end = new Date(baseDate);

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (period === 'week') {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }

  if (period === 'month') {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  }

  if (period === 'year') {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end, label: periodLabel(period) };
}

function periodLabel(period) {
  return {
    day: 'Diario',
    week: 'Semanal',
    month: 'Mensal',
    year: 'Anual'
  }[period] || 'Periodo';
}

function periodTitle(period, date) {
  if (period === 'day') {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  if (period === 'week') {
    const { start, end } = periodRange(period, date);
    return `${formatShortDate(start)} ate ${formatShortDate(end)}`;
  }

  if (period === 'month') {
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
  }

  return new Intl.DateTimeFormat('pt-BR', { year: 'numeric' }).format(date);
}

function donutTemplate(title, subtitle, slices, center) {
  return `
    <article class="chart-card">
      <div class="chart-copy">
        <span>${title}</span>
        <strong>${subtitle}</strong>
      </div>
      <div class="donut" style="--chart:${donutGradient(slices)}">
        <div>${center}</div>
      </div>
      <div class="chart-legend">
        ${slices.map(slice => `<span><i style="background:${slice.color}"></i>${slice.label}</span>`).join('')}
      </div>
    </article>
  `;
}

function ringTemplate(title, percent, value, color) {
  return `
    <article class="chart-card compact-chart">
      <div class="chart-copy">
        <span>${title}</span>
        <strong>${value}</strong>
      </div>
      <div class="donut ring" style="--chart: ${color} ${percent}%, #2a352f 0">
        <div>${percent}%</div>
      </div>
    </article>
  `;
}

function donutGradient(slices) {
  const total = slices.reduce((sum, slice) => sum + Number(slice.value || 0), 0) || 1;
  let current = 0;

  return slices.map(slice => {
    const start = current;
    current += (Number(slice.value || 0) / total) * 100;
    return `${slice.color} ${start}% ${current}%`;
  }).join(', ');
}

function percentage(value, total) {
  if (!total) {
    return 0;
  }

  return Math.round((Number(value || 0) / Number(total)) * 100);
}

function adminTemplate() {
  const editingProduct = state.products.find(product => product.id === state.productEditingId);
  const draftId = editingProduct?.id || '';
  const draft = state.productDraft?.id === draftId ? state.productDraft : {};
  const productForm = {
    id: draftId,
    name: draft.name ?? editingProduct?.name ?? '',
    category: draft.category ?? editingProduct?.category ?? 'Lanches',
    price: draft.price ?? editingProduct?.price ?? '',
    stock: draft.stock ?? editingProduct?.stock ?? '',
    image: draft.image ?? editingProduct?.image ?? '',
    description: draft.description ?? editingProduct?.description ?? '',
    available: draft.available ?? editingProduct?.available ?? true,
    highlight: draft.highlight ?? editingProduct?.highlight ?? false
  };

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
        <input type="hidden" name="id" value="${productForm.id}" />
        <input class="input" name="name" data-product-field placeholder="Nome do produto" value="${escapeHtml(productForm.name)}" required />
        <input class="input" name="category" data-product-field placeholder="Categoria" value="${escapeHtml(productForm.category)}" required />
        <input class="input" name="price" data-product-field type="number" step="0.01" min="0" placeholder="Valor" value="${escapeHtml(productForm.price)}" required />
        <input class="input" name="stock" data-product-field type="number" step="1" min="0" placeholder="Quantidade em estoque" value="${escapeHtml(productForm.stock)}" required />
        <input class="input" name="image" data-product-field placeholder="Imagem ou URL" value="${escapeHtml(productForm.image)}" />
        <label class="file-picker">
          <input name="imageFile" data-product-image-file type="file" accept="image/*" />
          <span>Escolher foto do aparelho</span>
        </label>
        ${productForm.image ? `<img class="image-preview" src="${escapeHtml(productForm.image)}" alt="Foto do produto" />` : ''}
        <textarea class="textarea" name="description" data-product-field placeholder="Descricao do produto" required>${escapeHtml(productForm.description)}</textarea>
        <label><input name="available" data-product-field type="checkbox" ${productForm.available ? 'checked' : ''} /> Produto disponivel</label>
        <label><input name="highlight" data-product-field type="checkbox" ${productForm.highlight ? 'checked' : ''} /> Marcar como destaque</label>
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
      state.historyPeriod = button.dataset.tab === 'historico' ? state.historyPeriod : null;
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
  document.querySelectorAll('[data-product-field]').forEach(field => {
    field.addEventListener('input', updateProductDraft);
    field.addEventListener('change', updateProductDraft);
  });
  document.querySelector('[data-product-image-file]')?.addEventListener('change', updateProductImageFromFile);

  document.querySelectorAll('[data-history-period]').forEach(button => {
    button.addEventListener('click', () => {
      state.historyPeriod = button.dataset.historyPeriod;
      render();
    });
  });

  document.querySelector('[data-report-pdf]')?.addEventListener('click', () => {
    generateHistoryReport(state.historyPeriod);
  });

  document.querySelector('[data-cancel-edit]')?.addEventListener('click', () => {
    state.productEditingId = null;
    clearProductDraft();
    render();
  });

  document.querySelectorAll('[data-edit-product]').forEach(button => {
    button.addEventListener('click', () => {
      state.productEditingId = button.dataset.editProduct;
      const product = state.products.find(candidate => candidate.id === state.productEditingId);

      state.productDraft = productToDraft(product);
      saveProductDraft();
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
    phone: '',
    address: '',
    notes: '',
    paymentMethod: form.get('paymentMethod'),
    paymentStatus: 'pending',
    cashReceived: '',
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
    await loadState({ forceRender: true });
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
    clearProductDraft();
    showToast(id ? 'Produto atualizado.' : 'Produto adicionado.');
    await loadState({ forceRender: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteProduct(productId) {
  if (!confirm('Excluir este produto?')) return;

  try {
    await api(`/api/products/${productId}`, { method: 'DELETE' });
    showToast('Produto excluido.');
    await loadState({ forceRender: true });
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
    await loadState({ forceRender: true });
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
    await loadState({ forceRender: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteOrder(orderId) {
  if (!confirm('Remover este pedido da fila?')) return;

  try {
    await api(`/api/orders/${orderId}`, { method: 'DELETE' });
    showToast('Pedido removido.');
    await loadState({ forceRender: true });
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

async function updateProductImageFromFile(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith('image/')) {
    showToast('Escolha um arquivo de imagem.');
    return;
  }

  try {
    const image = await resizeImage(file);
    const form = event.target.closest('[data-product-form]');
    const imageInput = form?.querySelector('input[name="image"]');

    if (imageInput) {
      imageInput.value = image;
    }

    updateProductDraft({ target: imageInput || event.target });
    showToast('Foto carregada.');
    render();
  } catch {
    showToast('Nao foi possivel carregar a foto.');
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };

      image.onerror = reject;
      image.src = reader.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function updateProductDraft(event) {
  const form = event.target.closest('[data-product-form]');

  if (!form) {
    return;
  }

  const data = new FormData(form);
  state.productDraft = {
    id: data.get('id') || '',
    name: data.get('name') || '',
    category: data.get('category') || '',
    price: data.get('price') || '',
    stock: data.get('stock') || '',
    image: data.get('image') || '',
    description: data.get('description') || '',
    available: data.get('available') === 'on',
    highlight: data.get('highlight') === 'on'
  };
  saveProductDraft();
}

function productToDraft(product) {
  return {
    id: product?.id || '',
    name: product?.name || '',
    category: product?.category || 'Lanches',
    price: product?.price ?? '',
    stock: product?.stock ?? '',
    image: product?.image || '',
    description: product?.description || '',
    available: product?.available ?? true,
    highlight: product?.highlight ?? false
  };
}

function saveProductDraft() {
  localStorage.setItem('deus-proverar-product-draft', JSON.stringify(state.productDraft));
}

function clearProductDraft() {
  state.productDraft = {};
  localStorage.removeItem('deus-proverar-product-draft');
}

function generateHistoryReport(period) {
  const report = historyReport(period);
  const rows = report.orders.map(order => `
    <tr>
      <td>${escapeHtml(formatDate(order.createdAt))}</td>
      <td>${escapeHtml(order.customerName)}</td>
      <td>${escapeHtml(paymentMethodLabel(order.paymentMethod))}</td>
      <td>${money.format(order.total)}</td>
    </tr>
  `).join('');
  const reportWindow = window.open('', '_blank');

  if (!reportWindow) {
    showToast('Permita pop-up para gerar o PDF.');
    return;
  }

  reportWindow.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Relatorio DEUS PROVERAR</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 28px; color: #17221b; }
          h1, h2, p { margin: 0; }
          header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #17221b; padding-bottom: 14px; margin-bottom: 18px; }
          .brand { font-size: 22px; font-weight: 900; }
          .muted { color: #64736a; font-size: 13px; margin-top: 4px; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
          .card { border: 1px solid #ccd8d0; border-radius: 8px; padding: 12px; }
          .card span { display: block; color: #64736a; font-size: 11px; font-weight: 900; text-transform: uppercase; }
          .card strong { display: block; margin-top: 5px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { border-bottom: 1px solid #dbe4df; padding: 9px; text-align: left; font-size: 13px; }
          th { background: #edf5f0; font-size: 11px; text-transform: uppercase; }
          @media print { button { display: none; } body { margin: 18px; } }
        </style>
      </head>
      <body>
        <header>
          <div>
            <div class="brand">DEUS PROVERAR</div>
            <p class="muted">Relatorio ${escapeHtml(report.label)} - ${escapeHtml(report.title)}</p>
          </div>
          <button onclick="window.print()">Salvar em PDF</button>
        </header>
        <section class="grid">
          <div class="card"><span>Vendido</span><strong>${money.format(report.total)}</strong></div>
          <div class="card"><span>Vendas</span><strong>${report.count}</strong></div>
          <div class="card"><span>Media</span><strong>${money.format(report.average)}</strong></div>
          <div class="card"><span>Itens</span><strong>${report.items}</strong></div>
        </section>
        <section class="grid">
          <div class="card"><span>Dinheiro</span><strong>${money.format(report.byPaymentMethod.cash)}</strong></div>
          <div class="card"><span>PIX</span><strong>${money.format(report.byPaymentMethod.pix)}</strong></div>
          <div class="card"><span>Credito</span><strong>${money.format(report.byPaymentMethod.credit)}</strong></div>
          <div class="card"><span>Debito</span><strong>${money.format(report.byPaymentMethod.debit)}</strong></div>
        </section>
        <h2>Vendas</h2>
        <table>
          <thead>
            <tr><th>Data</th><th>Cliente</th><th>Pagamento</th><th>Total</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4">Nenhuma venda paga nesse periodo.</td></tr>'}</tbody>
        </table>
        <script>setTimeout(() => window.print(), 400);</script>
      </body>
    </html>
  `);
  reportWindow.document.close();
}

function handlePullStart(event) {
  if (window.scrollY <= 0) {
    state.touchStartY = event.touches?.[0]?.clientY || 0;
  }
}

async function handlePullEnd(event) {
  const endY = event.changedTouches?.[0]?.clientY || 0;
  const pulled = endY - state.touchStartY;

  if (isUserEditing()) {
    return;
  }

  if (window.scrollY <= 0 && pulled > 70 && !state.refreshing) {
    state.refreshing = true;
    render();
    await loadState({ forceRender: true });
    state.refreshing = false;
    showToast('App atualizado.');
  }
}

function isUserEditing() {
  const active = document.activeElement;

  if (!active) {
    return false;
  }

  return Boolean(active.closest('form') && active.matches('input, textarea, select'));
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

function formatShortDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit'
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

function iconSvg(name) {
  const icons = {
    home: '<path d="M3 10.8 12 3l9 7.8"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    queue: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-7"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>'
  };

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.home}</svg>`;
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
