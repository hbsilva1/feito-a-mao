// ================================================================
// app.js — Feito à Mão • Crochê Artesanal • Juliana Mussi
// SPA com hash routing, carrinho, encomenda, checkout, admin
// ================================================================
(function() {
'use strict';

const LS = {
  CART: 'fem_cart',
  PRODUCTS: 'fem_admin_products',
  ORDERS: 'fem_orders',
  ADMIN_AUTH: 'fem_admin_auth'
};

function $(sel, ctx) { return (ctx || document).querySelector(sel); }
function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

function formatPriceSimple(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
}

function getLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch(e) { return fallback; }
}
function setLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.warn(e); }
}

function genId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6);
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

let toastTimer = null;
function toast(msg, dur) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hide');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('hide');
  }, dur || 2800);
}

// PRODUCTS
function getAllProducts() {
  const built = (typeof window.PRODUCTS_DATA !== 'undefined') ? window.PRODUCTS_DATA : [];
  const admin = getLS(LS.PRODUCTS, []);
  const merged = built.map(p => {
    const a = admin.find(x => x.id === p.id);
    return a ? Object.assign({}, p, a) : p;
  });
  admin.forEach(a => {
    if (!built.find(b => b.id === a.id)) merged.push(a);
  });
  return merged;
}

function getProduct(id) { return getAllProducts().find(p => p.id === id); }

function saveAdminProduct(prod) {
  const admin = getLS(LS.PRODUCTS, []);
  const idx = admin.findIndex(p => p.id === prod.id);
  if (idx >= 0) admin[idx] = prod; else admin.push(prod);
  setLS(LS.PRODUCTS, admin);
}

function deleteAdminProduct(id) {
  setLS(LS.PRODUCTS, getLS(LS.PRODUCTS, []).filter(p => p.id !== id));
}

// CART
function getCart() { return getLS(LS.CART, []); }
function setCart(cart) { setLS(LS.CART, cart); updateCartUI(); }

function addToCart(productId, qty) {
  const prod = getProduct(productId);
  if (!prod) return;
  const cart = getCart();
  const existing = cart.find(i => i.id === productId);
  if (existing) existing.qty = (existing.qty || 1) + (qty || 1);
  else cart.push({ id: productId, qty: qty || 1 });
  setCart(cart);
  toast('Adicionado ao carrinho! 🧶');
  const badge = $('#cartCount');
  if (badge) { badge.classList.remove('pulse'); void badge.offsetWidth; badge.classList.add('pulse'); }
}

function updateCartUI() {
  const cart = getCart();
  const count = cart.reduce((s, i) => s + (i.qty || 1), 0);
  const badge = $('#cartCount');
  if (badge) badge.textContent = count;
  const itemsEl = $('#cartItems');
  const subtotalEl = $('#cartSubtotal');
  const freteEl = $('#cartFrete');
  const totalEl = $('#cartTotal');
  const freteFill = $('#freteFill');
  const freteMsg = $('#freteMsg');
  if (!itemsEl) return;

  if (cart.length === 0) {
    itemsEl.innerHTML = '<div class="cart-empty"><span class="ce-icon">🧺</span><p>Seu carrinho está vazio</p></div>';
  } else {
    itemsEl.innerHTML = cart.map(item => {
      const p = getProduct(item.id);
      if (!p) return '';
      return '<div class="cart-item" data-id="'+item.id+'">'
        + '<img src="'+p.img+'" alt="'+escapeHtml(p.name)+'">'
        + '<div class="ci-info"><div class="ci-name">'+escapeHtml(p.name)+'</div>'
        + '<div class="ci-price">'+formatPriceSimple(p.price)+'</div>'
        + '<div class="ci-controls">'
        + '<button onclick="App.decrementItem(\''+item.id+'\')">&minus;</button>'
        + '<span>'+(item.qty||1)+'</span>'
        + '<button onclick="App.incrementItem(\''+item.id+'\')">+</button>'
        + '<button class="remove" onclick="App.removeItem(\''+item.id+'\')">&#10005;</button>'
        + '</div></div></div>';
    }).join('');
  }

  const subtotal = cart.reduce((s, i) => {
    const p = getProduct(i.id);
    return s + (p ? (p.price || 0) * (i.qty || 1) : 0);
  }, 0);
  const freeShipping = subtotal >= 300;
  const frete = freeShipping ? 0 : (subtotal > 0 ? 15 : 0);

  if (subtotalEl) subtotalEl.textContent = formatPriceSimple(subtotal);
  if (freteEl) freteEl.textContent = freeShipping ? 'Grátis 🎉' : (subtotal > 0 ? formatPriceSimple(frete) : '—');
  if (totalEl) totalEl.textContent = formatPriceSimple(subtotal + frete);
  if (freteFill) freteFill.style.width = Math.min(100, (subtotal / 300) * 100) + '%';
  if (freteMsg) {
    if (freeShipping) { freteMsg.textContent = '🎉 Você ganhou frete grátis!'; freteMsg.classList.add('free'); }
    else if (subtotal > 0) { freteMsg.textContent = 'Faltam ' + formatPriceSimple(300 - subtotal) + ' para frete grátis!'; freteMsg.classList.remove('free'); }
    else { freteMsg.textContent = 'Frete grátis acima de R$ 300,00'; freteMsg.classList.remove('free'); }
  }
}

// ORDERS
function getOrders() { return getLS(LS.ORDERS, []); }
function addOrder(order) {
  const orders = getOrders();
  order.id = order.id || genId('ord');
  order.date = new Date().toISOString();
  orders.unshift(order);
  setLS(LS.ORDERS, orders);
  return order;
}

// ADMIN AUTH
function isAdminLoggedIn() { return sessionStorage.getItem(LS.ADMIN_AUTH) === 'true'; }
function adminLogin(user, pass) {
  if (user === 'ju' && pass === 'ju') { sessionStorage.setItem(LS.ADMIN_AUTH, 'true'); return true; }
  return false;
}
function adminLogout() { sessionStorage.removeItem(LS.ADMIN_AUTH); }

// ROUTER
const view = $('#view');
function getRoute() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/');
  return { path: parts[0] || '', param: parts[1] || '' };
}

function render() {
  const route = getRoute();
  const page = route.path || '';
  const param = route.param;
  closeCart();
  $$('.mainnav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + (page === '' ? '/' : '/' + page));
  });
  window.scrollTo(0, 0);
  switch (page) {
    case '': case 'inicio': renderHome(); break;
    case 'loja': renderLoja(param); break;
    case 'encomenda': renderEncomenda(); break;
    case 'sobre': renderSobre(); break;
    case 'checkout': renderCheckout(); break;
    case 'admin': renderAdmin(); break;
    default: render404();
  }
}

// HOME
function renderHome() {
  const products = getAllProducts();
  const featured = products.slice(0, 4);
  view.innerHTML =
    '<div class="hero"><span class="hero-icon">🧶</span>'
    + '<h1>Feito à <em>Mão</em></h1>'
    + '<p>Cada peça é feita com amor e dedicação pela <strong>Juliana Mussi</strong>. Crochê artesanal, único e cheio de carinho.</p>'
    + '<div class="hero-ctas">'
    + '<a href="#/loja" class="btn btn-primary btn-lg">Ver Produtos</a>'
    + '<a href="#/encomenda" class="btn btn-outline btn-lg">Encomenda Personalizada</a>'
    + '</div>'
    + '<div class="hero-badges"><span>🎨 Feito à mão</span><span>🚚 Frete grátis R$300+</span><span>💝 Peça única</span></div></div>'
    + '<div class="features">'
    + '<div class="feature-card"><span class="f-icon">🧶</span><h3>Artesanal</h3><p>Cada peça é feita com fios selecionados e muito amor.</p></div>'
    + '<div class="feature-card"><span class="f-icon">📸</span><h3>Personalizado</h3><p>Envie sua foto e a Juliana transforma em crochê!</p></div>'
    + '<div class="feature-card"><span class="f-icon">🚚</span><h3>Frete Grátis</h3><p>Em compras acima de R$300, o frete é por nossa conta.</p></div>'
    + '</div>'
    + '<h2 class="section-title">Nossos Favoritos</h2>'
    + '<p class="section-sub">Um pedacinho do que a Juliana já criou</p>'
    + '<div class="product-grid">' + featured.map(p => productCardHtml(p)).join('') + '</div>'
    + '<div style="text-align:center;margin-top:24px"><a href="#/loja" class="btn btn-outline">Ver todos os produtos →</a></div>';
}

// LOJA
function cLabel(c) {
  const map = { bolsa: 'Bolsinhas', bichinho: 'Bichinhos', chaveiro: 'Chaveiros', outros: 'Outros' };
  return map[c] || c;
}

function productCardHtml(p) {
  return '<article class="product-card" data-id="'+p.id+'">'
    + '<div class="pc-img-wrap"><img src="'+p.img+'" alt="'+escapeHtml(p.name)+'" loading="lazy"></div>'
    + '<div class="pc-body"><span class="pc-cat">'+escapeHtml(cLabel(p.category||'outros'))+'</span>'
    + '<h3 class="pc-name">'+escapeHtml(p.name)+'</h3>'
    + '<p class="pc-desc">'+escapeHtml(p.desc)+'</p>'
    + '<div class="pc-footer"><span class="pc-price">'+formatPriceSimple(p.price)+'</span>'
    + '<button class="pc-add-btn" onclick="App.addToCart(\''+p.id+'\')">Adicionar</button>'
    + '</div></div></article>';
}

function renderLoja(catFilter) {
  const products = getAllProducts();
  const cats = [...new Set(products.map(p => p.category || 'outros'))];
  const filtered = catFilter ? products.filter(p => (p.category||'outros') === catFilter) : products;
  view.innerHTML = '<h2 class="section-title">Nossa Loja</h2>'
    + '<p class="section-sub">Todos os produtos feitos à mão com carinho</p>'
    + '<div class="cat-filter" id="catFilter">'
    + '<button class="'+(!catFilter?'active':'')+'" data-cat="">Todos</button>'
    + cats.map(c => '<button class="'+(catFilter===c?'active':'')+'" data-cat="'+escapeHtml(c)+'">'+escapeHtml(cLabel(c))+'</button>').join('')
    + '</div><div class="product-grid">'
    + (filtered.length ? filtered.map(p => productCardHtml(p)).join('') : '<p style="text-align:center;color:var(--c-ink-faint)">Nenhum produto nesta categoria.</p>')
    + '</div>';
  $$('#catFilter button').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat || '';
      location.hash = cat ? '#/loja/' + cat : '#/loja';
    });
  });
}

// ENCOMENDA (custom order with image upload)
function renderEncomenda() {
  view.innerHTML = '<div class="encomenda-page">'
    + '<h1>Encomenda Personalizada</h1>'
    + '<p class="ep-sub">Envie uma foto e a Juliana vai transformá-la em crochê! 🧶</p>'
    
    + '<div class="ep-highlights">'
    + '<div class="ep-hl-box"><div class="ep-hl-icon">💰</div><div class="ep-hl-text"><strong>Pagamento 50% antecipado</strong><br>O valor combinado da encomenda é pago em 50% para iniciar a produção.</div></div>'
    + '<div class="ep-hl-box"><div class="ep-hl-icon">⏳</div><div class="ep-hl-text"><strong>Prazo a combinar</strong><br>Por ser 100% artesanal, a criação de cada peça pode levar um tempinho. O prazo é combinado com você antes de iniciar!</div></div>'
    + '</div>'
    + '<form id="encomendaForm" novalidate>'
    + '<div class="form-row">'
    + '<div class="form-group"><label>Seu nome <span class="req">*</span></label><input type="text" id="encNome" required placeholder="Como podemos te chamar?"></div>'
    + '<div class="form-group"><label>WhatsApp / Telefone <span class="req">*</span></label><input type="tel" id="encTel" required placeholder="(00) 00000-0000"></div>'
    + '</div>'
    + '<div class="form-group"><label>Seu e-mail</label><input type="email" id="encEmail" placeholder="seuemail@exemplo.com"></div>'
    + '<div class="form-group"><label>Descrição do que deseja <span class="req">*</span></label><textarea id="encDesc" required placeholder="Descreva a peça: bichinho, bolsa, chaveiro, tamanho, cores..."></textarea></div>'
    + '<div class="form-group"><label>📸 Envie a foto que vai virar crochê <span class="req">*</span></label>'
    + '<div class="upload-zone" id="encUploadZone"><span class="uz-icon">📷</span><p>Clique aqui ou arraste a imagem</p><p class="uz-hint">JPG, PNG ou GIF — máx. 10 MB</p>'
    + '<input type="file" id="encFile" accept="image/*" hidden></div>'
    + '<div class="upload-preview" id="encPreview"><img id="encPreviewImg" alt="Preview"><button type="button" class="remove-img" id="encRemoveImg">✕</button></div>'
    + '</div>'
    + '<div class="form-group"><label>Valor estimado (opcional)</label><input type="number" id="encValor" min="0" step="0.01" placeholder="Se souber o valor"></div>'
    + '<button type="submit" class="btn btn-primary btn-lg btn-block">Enviar Encomenda 💕</button>'
    + '</form></div>';

  const zone = $('#encUploadZone');
  const fileInput = $('#encFile');
  const preview = $('#encPreview');
  const previewImg = $('#encPreviewImg');
  let imageDataUrl = null;

  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });
  $('#encRemoveImg').addEventListener('click', () => {
    imageDataUrl = null; preview.classList.remove('show'); zone.style.display = ''; fileInput.value = '';
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) { toast('Envie uma imagem 📷'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Imagem muito grande (máx. 10 MB)'); return; }
    const reader = new FileReader();
    reader.onload = e => { imageDataUrl = e.target.result; previewImg.src = imageDataUrl; preview.classList.add('show'); zone.style.display = 'none'; };
    reader.readAsDataURL(file);
  }

  $('#encomendaForm').addEventListener('submit', e => {
    e.preventDefault();
    const nome = $('#encNome').value.trim();
    const tel = $('#encTel').value.trim();
    const email = $('#encEmail').value.trim();
    const desc = $('#encDesc').value.trim();
    const valor = parseFloat($('#encValor').value) || 0;
    if (!nome || !tel || !desc) { toast('Preencha os campos obrigatórios 📝'); return; }
    if (!imageDataUrl) { toast('Envie a foto da sua encomenda 📷'); return; }
    addOrder({ type: 'encomenda', nome, tel, email, desc, valor, image: imageDataUrl, status: 'novo' });
    toast('Encomenda enviada com sucesso! 💕');
    setTimeout(() => { location.hash = '#/sobre'; }, 1500);
  });
}

// SOBRE
function renderSobre() {
  view.innerHTML = '<div class="sobre-page">'
    + '<span class="sobre-avatar">🧶</span>'
    + '<h1>Sobre a Juliana</h1>'
    + '<p>Olá! Eu sou a <strong>Juliana Mussi</strong>, artesã apaixonada por crochê. Cada peça que sai das minhas mãos carrega um pedacinho do meu coração.</p>'
    + '<p>Trabalho com fios macios e cores que alegram, criando bichinhos fofos, bolsinhas charmosas e chaveiros cheios de personalidade. Tudo é feito manualmente, com o carinho de quem ama o que faz.</p>'
    + '<p>Precisa de algo especial? <a href="#/encomenda">Envie sua foto</a> e eu transformo em crochê para você! 💕</p>'
    + '<p style="margin-top:24px"><strong>Feito à Mão</strong> — porque o que é feito com amor nunca é igual ao dos outros. 🧶</p>'
    + '</div>';
}

// CHECKOUT
function renderCheckout() {
  const cart = getCart();
  if (cart.length === 0) {
    view.innerHTML = '<div class="error-404"><span class="e404-icon">🛒</span><h1>Carrinho vazio</h1><p>Adicione produtos antes de finalizar.</p><a href="#/loja" class="btn btn-primary">Ir para a loja</a></div>';
    return;
  }
  const items = cart.map(i => Object.assign({}, getProduct(i.id), { qty: i.qty || 1 })).filter(p => p);
  const subtotal = items.reduce((s, p) => s + p.price * p.qty, 0);
  const frete = subtotal >= 300 ? 0 : 15;
  const total = subtotal + frete;

  view.innerHTML = '<div class="checkout-page"><h1>Finalizar Pedido</h1>'
    + '<div class="checkout-summary"><h3>Resumo do pedido</h3><div class="cs-items">'
    + items.map(p => '<div class="cs-item"><img src="'+p.img+'" alt=""><span>'+escapeHtml(p.name)+' × '+p.qty+'</span><strong>'+formatPriceSimple(p.price*p.qty)+'</strong></div>').join('')
    + '</div>'
    + '<div class="cart-line"><span>Subtotal</span><strong>'+formatPriceSimple(subtotal)+'</strong></div>'
    + '<div class="cart-line"><span>Frete</span><strong>'+(frete===0?'Grátis 🎉':formatPriceSimple(frete))+'</strong></div>'
    + '<div class="cart-line total"><span>Total</span><strong>'+formatPriceSimple(total)+'</strong></div></div>'
    + '<form id="checkoutForm" novalidate>'
    + '<div class="form-row">'
    + '<div class="form-group"><label>Nome completo <span class="req">*</span></label><input type="text" id="ckNome" required></div>'
    + '<div class="form-group"><label>WhatsApp / Telefone <span class="req">*</span></label><input type="tel" id="ckTel" required></div>'
    + '</div>'
    + '<div class="form-group"><label>E-mail</label><input type="email" id="ckEmail"></div>'
    + '<div class="form-group"><label>Endereço de entrega <span class="req">*</span></label><textarea id="ckEnd" required placeholder="Rua, número, bairro, cidade, CEP"></textarea></div>'
    + '<div class="form-group"><label>Forma de pagamento</label><select id="ckPag"><option value="pix">Pix</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option></select></div>'
    + '<div class="form-group"><label>Observações</label><textarea id="ckObs" placeholder="Alguma informação extra"></textarea></div>'
    + '<button type="submit" class="btn btn-primary btn-lg btn-block">Confirmar Pedido 💕</button>'
    + '</form></div>';

  $('#checkoutForm').addEventListener('submit', e => {
    e.preventDefault();
    const nome = $('#ckNome').value.trim();
    const tel = $('#ckTel').value.trim();
    const email = $('#ckEmail').value.trim();
    const end = $('#ckEnd').value.trim();
    const pag = $('#ckPag').value;
    const obs = $('#ckObs').value.trim();
    if (!nome || !tel || !end) { toast('Preencha nome, telefone e endereço 📝'); return; }
    addOrder({ type: 'compra', nome, tel, email, end, pag, obs,
      items: items.map(p => ({ id: p.id, name: p.name, price: p.price, qty: p.qty })),
      subtotal, frete, total, status: 'novo' });
    setLS(LS.CART, []);
    updateCartUI();
    toast('Pedido realizado com sucesso! 🎉');
    setTimeout(() => { location.hash = '#/'; }, 1500);
  });
}

// ADMIN
function renderAdmin() {
  if (!isAdminLoggedIn()) {
    view.innerHTML = '<div class="admin-page"><div class="admin-login">'
      + '<h2>🔐 Área Administrativa</h2>'
      + '<div class="form-group"><label>Usuário</label><input type="text" id="admUser" placeholder="usuário" autocomplete="off"></div>'
      + '<div class="form-group"><label>Senha</label><input type="password" id="admPass" placeholder="senha"></div>'
      + '<p class="login-error" id="admError">Usuário ou senha incorretos</p>'
      + '<button class="btn btn-primary btn-lg" id="admLoginBtn">Entrar</button>'
      + '</div></div>';
    const doLogin = () => {
      if (adminLogin($('#admUser').value.trim(), $('#admPass').value.trim())) renderAdmin();
      else $('#admError').classList.add('show');
    };
    $('#admLoginBtn').addEventListener('click', doLogin);
    $('#admPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    return;
  }
  const products = getAllProducts();
  const orders = getOrders();
  view.innerHTML = '<div class="admin-page"><h1>⚙️ Admin — Feito à Mão</h1>'
    + '<div style="text-align:right;margin-bottom:16px"><button class="btn btn-danger btn-sm" id="admLogout">Sair</button></div>'
    + '<div class="admin-tabs"><button class="active" data-tab="produtos">Produtos</button><button data-tab="pedidos">Pedidos ('+orders.length+')</button></div>'
    + '<div id="admTabProdutos">'
    + '<div class="admin-panel"><h2>➕ Adicionar / Editar Produto</h2>'
    + '<div class="admin-product-form">'
    + '<div class="form-group"><label>ID (vazio = novo)</label><input type="text" id="admProdId" placeholder="ex: p24"></div>'
    + '<div class="form-row"><div class="form-group"><label>Nome *</label><input type="text" id="admProdNome"></div>'
    + '<div class="form-group"><label>Preço (R$) *</label><input type="number" id="admProdPreco" min="0" step="0.01"></div></div>'
    + '<div class="form-group"><label>Categoria</label><select id="admProdCat"><option value="bolsa">Bolsa</option><option value="bichinho">Bichinho</option><option value="chaveiro">Chaveiro</option><option value="outros">Outros</option></select></div>'
    + '<div class="form-group"><label>Descrição</label><textarea id="admProdDesc"></textarea></div>'
    + '<div class="form-group"><label>Imagem (opcional)</label><input type="file" id="admProdImg" accept="image/*"></div>'
    + '<button type="button" class="btn btn-primary" id="admProdSalvar">Salvar Produto</button>'
    + '</div></div>'
    + '<div class="admin-panel"><h2>📦 Produtos ('+products.length+')</h2><div class="admin-product-list">'
    + products.map(p => '<div class="admin-product-item"><img src="'+p.img+'" alt="" loading="lazy"><div class="api-info"><div class="api-name">'+escapeHtml(p.name)+'</div><div class="api-price">'+formatPriceSimple(p.price)+' • '+escapeHtml(cLabel(p.category||'outros'))+'</div></div><div class="api-actions"><button class="btn btn-sm" onclick="App.editProduct(\''+p.id+'\')">🗑</button>< <button class="btn btn-danger btn-sm" onclick="App.deleteProduct(\''+p.id+'\')">🗑</button></div></div>').join('')
    + '</div></div></div>'
    + '<div id="admTabPedidos" hidden><div class="admin-panel"><h2>📋 Pedidos ('+orders.length+')</h2><div class="admin-orders-list">'
    + (orders.length === 0 ? '<p style="color:var(--c-ink-faint)">Nenhum pedido ainda.</p>' : orders.map(o => '<div class="admin-order-card"><div class="aoc-header"><span class="aoc-id">'+(o.type==="encomenda"?"📸 Encomenda":"🛒 Pedido")+' — '+escapeHtml(o.nome||"—")+'</span><span class="aoc-status '+(o.status||"novo")+'">'+escapeHtml(o.status||"novo")+'</span></div>'
      + '<div class="aoc-date">'+new Date(o.date).toLocaleDateString("pt-BR",{dateStyle:"medium",timeStyle:"short"})+'</div>'
      + '<div class="aoc-items">'
      + (o.type==="encomenda"
        ? '<p><strong>Desc:</strong> '+escapeHtml(o.desc)+'</p>'+(o.tel?'<p>📱 '+escapeHtml(o.tel)+'</p>':'')+(o.email?'<p>📧 '+escapeHtml(o.email)+'</p>':'')+(o.valor?'<p>💰 '+formatPriceSimple(o.valor)+'</p>':'')+(o.image?'<img src="'+o.image+'" class="aoc-img">':'')
        : '<ul>'+ (o.items||[]).map(i=>'<li>'+escapeHtml(i.name)+' × '+i.qty+' — '+formatPriceSimple(i.price*i.qty)+'</li>').join('') +'</ul><p>Total: <strong>'+formatPriceSimple(o.total)+'</strong> • '+escapeHtml(o.pag||'—')+'</p>'+(o.end?'<p>📍 '+escapeHtml(o.end)+'</p>':'')+(o.tel?'<p>📱 '+escapeHtml(o.tel)+'</p>':'')
      )
      + '</div><div style="margin-top:8px">'
      + '<button class="btn btn-sm" onclick="App.setOrderStatus(\''+o.id+'\',\'processando\')">Processando</button> '
      + '<button class="btn btn-sm btn-success" onclick="App.setOrderStatus(\''+o.id+'\',\'enviado\')">Enviado</button> '
      + '<button class="btn btn-sm btn-danger" onclick="App.setOrderStatus(\''+o.id+'\',\'cancelado\')">Cancelar</button>'
      + '</div></div>').join(''))
    + '</div></div></div></div>';

  $('#admLogout').addEventListener('click', () => { adminLogout(); location.hash = '#/'; });
  $$('.admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.admin-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('#admTabProdutos').hidden = btn.dataset.tab !== 'produtos';
      $('#admTabPedidos').hidden = btn.dataset.tab !== 'pedidos';
    });
  });
  $('#admProdSalvar').addEventListener('click', () => {
    const id = $('#admProdId').value.trim() || genId('p');
    const nome = $('#admProdNome').value.trim();
    const preco = parseFloat($('#admProdPreco').value);
    const cat = $('#admProdCat').value;
    const desc = $('#admProdDesc').value.trim();
    const fileInput = $('#admProdImg');
    if (!nome) { toast('Informe o nome'); return; }
    if (!preco || preco < 0) { toast('Preço inválido'); return; }
    const existing = getAllProducts().find(p => p.id === id);
    const baseImg = existing ? existing.img : 'assets/img-14.0.jpg';
    function save(imgData) {
      saveAdminProduct({ id, name: nome, price: preco, category: cat, desc: desc || 'Feito à mão com carinho.', img: imgData || baseImg });
      toast('Produto salvo! ✅');
      renderAdmin();
    }
    if (fileInput.files.length) {
      const reader = new FileReader();
      reader.onload = e => save(e.target.result);
      reader.readAsDataURL(fileInput.files[0]);
    } else save(null);
  });
}

// 404
function render404() {
  view.innerHTML = '<div class="error-404"><span class="e404-icon">🧶</span><h1>Página não encontrada</h1><p>Ops, essa página não existe (ou está se enrolando no fio!)</p><a href="#/" class="btn btn-primary">Voltar para o início</a></div>';
}

// CART DRAWER
let cartOpen = false;
function openCart() {
  cartOpen = true;
  const drawer = $('#cartDrawer');
  const overlay = $('#overlay');
  if (drawer) { drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false'); }
  if (overlay) overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  if (!cartOpen) return;
  cartOpen = false;
  const drawer = $('#cartDrawer');
  const overlay = $('#overlay');
  if (drawer) { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); }
  if (overlay) overlay.hidden = true;
  document.body.style.overflow = '';
}

// INIT
function init() {
  const cartBtn = $('#cartBtn');
  if (cartBtn) cartBtn.addEventListener('click', e => { e.preventDefault(); cartOpen ? closeCart() : openCart(); });
  const cartClose = $('#cartClose');
  if (cartClose) cartClose.addEventListener('click', closeCart);
  const overlay = $('#overlay');
  if (overlay) overlay.addEventListener('click', closeCart);
  const checkoutBtn = $('#checkoutBtn');
  if (checkoutBtn) checkoutBtn.addEventListener('click', () => { closeCart(); location.hash = '#/checkout'; });
  window.addEventListener('hashchange', render);
  render();
  updateCartUI();
}

// PUBLIC API
window.App = {
  addToCart: (id, qty) => addToCart(id, qty),
  incrementItem: (id) => { const c = getCart(); const i = c.find(x => x.id === id); if (i) { i.qty = (i.qty||1)+1; setCart(c); } },
  decrementItem: (id) => { const c = getCart(); const i = c.find(x => x.id === id); if (i) { i.qty = (i.qty||1)-1; if (i.qty <= 0) c.splice(c.indexOf(i), 1); setCart(c); } },
  removeItem: (id) => { setCart(getCart().filter(i => i.id !== id)); },
  editProduct: (id) => {
    const p = getAllProducts().find(x => x.id === id);
    if (!p) return;
    document.getElementById("admProdId").value = p.id;
    document.getElementById("admProdNome").value = p.name;
    document.getElementById("admProdPreco").value = p.price;
    document.getElementById("admProdCat").value = p.category || "outros";
    document.getElementById("admProdDesc").value = p.desc || "";
    toast("Editando: " + p.name);
  },
  deleteProduct: (id) => { if (confirm('Remover este produto?')) { deleteAdminProduct(id); toast('Produto removido'); renderAdmin(); } },
  setOrderStatus: (id, status) => { const orders = getOrders(); const o = orders.find(x => x.id === id); if (o) { o.status = status; setLS(LS.ORDERS, orders); toast('Status atualizado'); renderAdmin(); } },
  _init: init
};

document.addEventListener('DOMContentLoaded', () => window.App._init());
if (document.readyState !== 'loading') window.App._init();

})();
