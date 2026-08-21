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
  ADMIN_AUTH: 'fem_admin_auth',
  SETTINGS: 'fem_settings',
  ADMIN_CREDS: 'fem_admin_creds'
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

// ===== SUPABASE =====
const SUPABASE_URL = 'https://fsrlcbhbuobcoglyijia.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-mN8_5CGze8pPxW7xJpIGQ_ImISAeet';
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let _productCache = null;
let _ordersCache = null;

function parseProductImages(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string' && value.trim().charAt(0) === '[') {
    try { return JSON.parse(value).filter(Boolean); } catch(e) { /* URL simples */ }
  }
  return [value];
}

function normalizeProduct(p) {
  const images = parseProductImages(p.images || p.image_url || p.img || '');
  return {
    id: p.id,
    name: p.name,
    desc: p.description || p.desc || '',
    price: Number(p.price),
    category: p.category || 'outros',
    img: images[0] || 'assets/img-14.0.jpg',
    images: images.length ? images : ['assets/img-14.0.jpg']
  };
}

function productImageValue(prod) {
  const images = parseProductImages(prod.images && prod.images.length ? prod.images : prod.img);
  return images.length > 1 ? JSON.stringify(images) : (images[0] || '');
}

// ===== SETTINGS (frete configuravel + admin) =====
const DEFAULT_SETTINGS = {
  freeShippingThreshold: 300,
  shippingRates: { rj: 10, southeast: 15, south: 20, centerwest: 25, north: 30 }
};
let settings = { freeShippingThreshold: 300, shippingRates: { rj: 10, southeast: 15, south: 20, centerwest: 25, north: 30 } };
let adminCreds = { user: 'ju', pass: 'ju' };

async function loadSettings() {
  const creds = getLS(LS.ADMIN_CREDS, null);
  if (creds) adminCreds = creds;
  if (sb) {
    try {
      const { data, error } = await sb.from('settings').select('*').eq('id', 'main').maybeSingle();
      if (error) throw error;
      if (data) {
        settings.freeShippingThreshold = data.free_shipping_threshold != null ? Number(data.free_shipping_threshold) : DEFAULT_SETTINGS.freeShippingThreshold;
        settings.shippingRates = data.shipping_rates || DEFAULT_SETTINGS.shippingRates;
        return;
      }
    } catch(e) { console.warn('loadSettings:', e); }
  }
  const stored = getLS(LS.SETTINGS, null);
  if (stored) {
    settings.freeShippingThreshold = stored.freeShippingThreshold != null ? stored.freeShippingThreshold : DEFAULT_SETTINGS.freeShippingThreshold;
    settings.shippingRates = stored.shippingRates || DEFAULT_SETTINGS.shippingRates;
  }
}

async function saveGlobalSettings() {
  if (sb) {
    const { data, error } = await sb.from('settings').update({
      free_shipping_threshold: settings.freeShippingThreshold,
      shipping_rates: settings.shippingRates
    }).eq('id', 'main').select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('Configuração principal não encontrada');
  }
  setLS(LS.SETTINGS, settings);
  toast('Configuracoes salvas! ✅');
}

function saveAdminCreds() {
  setLS(LS.ADMIN_CREDS, adminCreds);
  toast('Senha alterada com sucesso! 🔒');
}

// ===== VIA CEP + FRETE =====
function getShippingZone(uf) {
  if (uf === 'RJ') return 'rj';
  if (['SP','MG','ES'].indexOf(uf) >= 0) return 'southeast';
  if (['SC','PR','RS'].indexOf(uf) >= 0) return 'south';
  if (['DF','GO','MT','MS','TO'].indexOf(uf) >= 0) return 'centerwest';
  return 'north';
}

async function lookupCep(cep) {
  const clean = cep.replace(/\D/g, '');
  if (clean.length < 8) throw new Error('CEP invalido');
  const res = await fetch('https://viacep.com.br/ws/' + clean + '/json/');
  const data = await res.json();
  if (data.erro) throw new Error('CEP nao encontrado');
  return data;
}

function calcShipping(uf, subtotal) {
  if (subtotal <= 0) return 0;
  if (subtotal >= settings.freeShippingThreshold) return 0;
  const zone = getShippingZone(uf || 'RJ');
  return settings.shippingRates[zone] || settings.shippingRates.north || 30;
}

// ===== PRAZO DE ENTREGA (dias uteis; postagem no proximo dia util) =====
const DELIVERY_DAYS = { rj: [2, 4], southeast: [3, 6], south: [4, 8], centerwest: [5, 10], north: [6, 12] };
function nextBusinessDay(from) {
  const d = new Date(from);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}
function addBusinessDays(date, n) {
  const d = new Date(date);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}
function deliveryWindow(zone) {
  const range = DELIVERY_DAYS[zone] || DELIVERY_DAYS.rj;
  const ship = nextBusinessDay(new Date());
  return { ship: ship, min: addBusinessDays(ship, range[0]), max: addBusinessDays(ship, range[1]) };
}
function fmtBRDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ===== SUPABASE CRUD =====
async function loadProducts() {
  if (!sb) { _productCache = getAllProducts(); return; }
  try {
    const { data, error } = await sb.from('products').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const dbProducts = data || [];
    const sbIds = new Set(dbProducts.map(p => p.id));
    _productCache = dbProducts.filter(p => p.category !== '__deleted__').map(normalizeProduct);
    const built = (typeof window.PRODUCTS_DATA !== 'undefined') ? window.PRODUCTS_DATA : [];
    built.forEach(bp => {
      if (!sbIds.has(bp.id)) _productCache.push(bp);
    });
    // Migra produtos antigos do navegador (localStorage) para o Supabase
    const legacy = getLS(LS.PRODUCTS, []) || [];
    for (const lp of legacy) {
      if (!lp || !lp.id || sbIds.has(lp.id) || built.some(b => b.id === lp.id)) continue;
      const norm = {
        id: lp.id,
        name: lp.name || 'Produto importado',
        desc: lp.desc || lp.description || '',
        price: Number(lp.price) || 0,
        category: lp.category || 'outros',
        img: lp.img || lp.image_url || 'assets/img-14.0.jpg'
      };
      _productCache.push(normalizeProduct(norm));
      sbIds.add(lp.id);
      await sbAddProduct(norm);
    }
  } catch(e) {
    console.warn('Supabase load failed, using local:', e.message);
    _productCache = getAllProducts();
  }
}

async function sbAddProduct(prod) {
  if (!sb) throw new Error('Banco de dados indisponível');
  const { error } = await sb.from('products').upsert({
      id: prod.id,
      name: prod.name,
      description: prod.desc || prod.description || '',
      price: prod.price,
      category: prod.category || 'outros',
      image_url: productImageValue(prod)
    }, { onConflict: 'id' });
  if (error) throw error;
}

async function sbDeleteProduct(id) {
  if (!sb) throw new Error('Banco de dados indisponível');
  const builtIn = (window.PRODUCTS_DATA || []).some(p => p.id === id);
  const result = builtIn
    ? await sb.from('products').upsert({ id, name: '__DELETED__', description: '', price: 0, category: '__deleted__', image_url: '' }, { onConflict: 'id' })
    : await sb.from('products').delete().eq('id', id);
  const { error } = result;
  if (error) throw error;
}

async function sbAddOrder(order) {
  if (!sb) throw new Error('Banco de dados indisponível');
  const { error } = await sb.from('orders').insert({
      id: order.id,
      type: order.type || 'compra',
      nome: order.nome,
      tel: order.tel,
      email: order.email,
      endereco: order.end,
      desconto: order.desconto,
      obs: order.obs,
      items: order.items,
      subtotal: order.subtotal,
      frete: order.frete,
      total: order.total,
      status: order.status || 'novo'
    });
  if (error) throw error;
}

async function sbAddEncomenda(enc) {
  if (!sb) throw new Error('Banco de dados indisponível');
  const { error } = await sb.from('encomendas').insert({
      id: enc.id,
      nome: enc.nome,
      tel: enc.tel,
      email: enc.email,
      description: enc.desc,
      image_url: enc.img,
      obs: enc.obs,
      status: 'novo'
    });
  if (error) throw error;
}

async function uploadToStorage(file, path) {
  if (!sb) return '';
  try {
    const { error } = await sb.storage.from('imagens').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = sb.storage.from('imagens').getPublicUrl(path);
    return data.publicUrl;
  } catch(e) {
    console.warn('uploadToStorage:', e);
    return '';
  }
}
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
function getAllProducts() { return _productCache || (typeof window.PRODUCTS_DATA !== "undefined" ? window.PRODUCTS_DATA : []); }
function _legacyGetAllProducts() {
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

async function saveAdminProduct(prod) {
  await sbAddProduct(prod);
  const normalized = normalizeProduct(prod);
  if (_productCache) {
    const idx = _productCache.findIndex(p => p.id === prod.id);
    if (idx >= 0) _productCache[idx] = normalized;
    else _productCache.unshift(normalized);
  }
  const admin = getLS(LS.PRODUCTS, []);
  const idx = admin.findIndex(p => p.id === prod.id);
  if (idx >= 0) admin[idx] = normalized; else admin.push(normalized);
  setLS(LS.PRODUCTS, admin);
}

async function deleteAdminProduct(id) {
  await sbDeleteProduct(id);
  if (_productCache) _productCache = _productCache.filter(p => p.id !== id);
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
  const freeShipping = subtotal >= settings.freeShippingThreshold;
  const minFrete = settings.shippingRates.rj || 10;
  const frete = freeShipping ? 0 : (subtotal > 0 ? minFrete : 0);

  if (subtotalEl) subtotalEl.textContent = formatPriceSimple(subtotal);
  if (freteEl) freteEl.textContent = freeShipping ? 'Grátis 🎉' : (subtotal > 0 ? 'a partir de ' + formatPriceSimple(minFrete) : '—');
  if (totalEl) totalEl.textContent = freeShipping ? formatPriceSimple(subtotal) : (subtotal > 0 ? 'a partir de ' + formatPriceSimple(subtotal + minFrete) : '—');
  if (freteFill) freteFill.style.width = Math.min(100, (subtotal / settings.freeShippingThreshold) * 100) + '%';
  if (freteMsg) {
    if (freeShipping) { freteMsg.textContent = '🎉 Você ganhou frete grátis!'; freteMsg.classList.add('free'); }
    else if (subtotal > 0) { freteMsg.textContent = 'Faltam ' + formatPriceSimple(settings.freeShippingThreshold - subtotal) + ' para frete grátis!'; freteMsg.classList.remove('free'); }
    else { freteMsg.textContent = 'Frete grátis acima de ' + formatPriceSimple(settings.freeShippingThreshold); freteMsg.classList.remove('free'); }
  }
}

// ORDERS
async function loadOrders() {
  const localOrders = getLS(LS.ORDERS, []);
  if (!sb) { _ordersCache = localOrders; return; }
  try {
    const [ordersResult, encomendasResult] = await Promise.all([
      sb.from('orders').select('*').order('created_at', { ascending: false }),
      sb.from('encomendas').select('*').order('created_at', { ascending: false })
    ]);
    if (ordersResult.error) throw ordersResult.error;
    if (encomendasResult.error) throw encomendasResult.error;
    const purchases = (ordersResult.data || []).map(o => Object.assign({}, o, {
      end: o.endereco || o.end || '',
      date: o.created_at || o.date || new Date().toISOString()
    }));
    const customOrders = (encomendasResult.data || []).map(o => ({
      id: o.id, type: 'encomenda', nome: o.nome, tel: o.tel, email: o.email,
      desc: o.description || '', image: o.image_url || '', obs: o.obs || '',
      status: o.status || 'novo', date: o.created_at || new Date().toISOString()
    }));
    _ordersCache = purchases.concat(customOrders).sort((a, b) => new Date(b.date) - new Date(a.date));
    const ids = new Set(_ordersCache.map(o => o.id));
    localOrders.forEach(o => { if (o && o.id && !ids.has(o.id)) _ordersCache.push(o); });
  } catch(e) {
    console.warn('loadOrders:', e);
    _ordersCache = localOrders;
  }
}

async function addEncomenda(enc) {
  enc.id = enc.id || genId('enc');
  enc.date = enc.date || new Date().toISOString();
  await sbAddEncomenda(enc);
  const orders = getOrders();
  orders.unshift(Object.assign({ type: 'encomenda', image: enc.img }, enc));
  _ordersCache = orders;
  setLS(LS.ORDERS, orders);
}

function getOrders() { return _ordersCache || getLS(LS.ORDERS, []); }
async function addOrder(order) {
  order.id = order.id || genId('ord');
  order.date = order.date || new Date().toISOString();
  try { await sbAddOrder(order); } catch(e) { console.warn('Pedido salvo apenas neste navegador:', e); }
  const orders = getOrders();
  orders.unshift(order);
  _ordersCache = orders;
  setLS(LS.ORDERS, orders);
  return order;
}

async function saveOrderStatus(id, status) {
  const orders = getOrders();
  const order = orders.find(o => o.id === id);
  if (sb) {
    const table = order && order.type === 'encomenda' ? 'encomendas' : 'orders';
    const { error } = await sb.from(table).update({ status }).eq('id', id);
    if (error) throw error;
  }
  if (order) order.status = status;
  _ordersCache = orders;
  setLS(LS.ORDERS, orders);
}

// ADMIN AUTH
function isAdminLoggedIn() { return sessionStorage.getItem(LS.ADMIN_AUTH) === 'true'; }
function adminLogin(user, pass) {
  if (user === adminCreds.user && pass === adminCreds.pass) { sessionStorage.setItem(LS.ADMIN_AUTH, 'true'); return true; }
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
  const th = settings.freeShippingThreshold;
  view.innerHTML =
    '<section class="hero-band" aria-label="Crochê artesanal Feito à Mão"><video class="hero-video" autoplay muted loop playsinline preload="metadata" poster="assets/img-24.0.jpg"><source src="assets/hero.mp4" type="video/mp4"></video><div class="hero-overlay" aria-hidden="true"></div>'
    + '<div class="hero"><span class="hero-icon">🧶</span>'
    + '<h1>Feito à <em>Mão</em></h1>'
    + '<p>Cada peça é feita com amor e dedicação pela <strong>Juliana Mussi</strong>. Crochê artesanal, único e cheio de carinho.</p>'
    + '<div class="hero-ctas">'
    + '<a href="#/loja" class="btn btn-primary btn-lg">Ver Produtos</a>'
    + '<a href="#/encomenda" class="btn btn-outline btn-lg">Encomenda Personalizada</a>'
    + '</div>'
    + '<div class="hero-badges"><span>🎨 Feito à mão</span><span>🚚 Frete grátis R$'+th+'+</span><span>💝 Peça única</span></div></div></section>'
    + '<div class="features">'
    + '<div class="feature-card"><span class="f-icon">🧶</span><h3>Artesanal</h3><p>Cada peça é feita com fios selecionados e muito amor.</p></div>'
    + '<div class="feature-card"><span class="f-icon">📸</span><h3>Personalizado</h3><p>Envie sua foto e a Juliana transforma em crochê!</p></div>'
    + '<div class="feature-card"><span class="f-icon">🚚</span><h3>Frete Grátis</h3><p>Em compras acima de R$'+th+', o frete é por nossa conta.</p></div>'
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
  const photoCount = parseProductImages(p.images || p.img).length;
  return '<article class="product-card" data-id="'+p.id+'" role="button" tabindex="0" aria-label="Ver detalhes de '+escapeHtml(p.name)+'" onclick="App.openProduct(\''+p.id+'\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();App.openProduct(\''+p.id+'\')}">'
    + '<div class="pc-img-wrap"><img src="'+p.img+'" alt="'+escapeHtml(p.name)+'" loading="lazy"><span class="pc-view-hint">Ver detalhes</span>'+(photoCount > 1 ? '<span class="pc-photo-count">📷 '+photoCount+'</span>' : '')+'</div>'
    + '<div class="pc-body"><span class="pc-cat">'+escapeHtml(cLabel(p.category||'outros'))+'</span>'
    + '<h3 class="pc-name">'+escapeHtml(p.name)+'</h3>'
    + '<p class="pc-desc">'+escapeHtml(p.desc)+'</p>'
    + '<div class="pc-footer"><span class="pc-price">'+formatPriceSimple(p.price)+'</span>'
    + '<button class="pc-add-btn" onclick="event.stopPropagation();App.addToCart(\''+p.id+'\')">Adicionar</button>'
    + '</div></div></article>';
}

function ensureProductModal() {
  let modal = $('#productModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'productModal';
  modal.className = 'product-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = '<div class="product-modal-backdrop" data-close-modal></div><section class="product-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="productModalTitle"><button class="product-modal-close" type="button" aria-label="Fechar detalhes" data-close-modal>✕</button><div id="productModalContent"></div></section>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target.closest('[data-close-modal]')) closeProductModal(); });
  return modal;
}

function openProductModal(id) {
  const p = getProduct(id);
  if (!p) return;
  const modal = ensureProductModal();
  const images = parseProductImages(p.images && p.images.length ? p.images : p.img);
  const gallery = images.length ? images : [p.img];
  $('#productModalContent').innerHTML = '<div class="product-detail">'
    + '<div class="product-gallery"><div class="product-main-image"><img id="productMainImage" src="'+gallery[0]+'" alt="'+escapeHtml(p.name)+'"></div>'
    + (gallery.length > 1 ? '<div class="product-thumbs" aria-label="Outras fotos">'+gallery.map((img, i) => '<button type="button" class="product-thumb '+(i===0?'active':'')+'" onclick="App.selectProductImage(this,\''+encodeURI(img).replace(/'/g,'%27')+'\')"><img src="'+img+'" alt="Foto '+(i+1)+' de '+escapeHtml(p.name)+'"></button>').join('')+'</div>' : '')
    + '</div><div class="product-detail-info"><span class="pc-cat">'+escapeHtml(cLabel(p.category||'outros'))+'</span><h2 id="productModalTitle">'+escapeHtml(p.name)+'</h2>'
    + '<p class="product-detail-desc">'+escapeHtml(p.desc || 'Peça artesanal feita à mão com carinho.')+'</p><strong class="product-detail-price">'+formatPriceSimple(p.price)+'</strong>'
    + '<p class="product-handmade-note">🧶 Peça artesanal: pequenas diferenças tornam cada criação única.</p>'
    + '<button class="btn btn-primary btn-lg btn-block" type="button" onclick="App.addToCart(\''+p.id+'\');App.closeProduct()">Adicionar ao carrinho</button></div></div>';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('.product-modal-close', modal).focus();
}

function closeProductModal() {
  const modal = $('#productModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
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
  let imageFile = null;

  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });
  $('#encRemoveImg').addEventListener('click', () => {
    imageDataUrl = null; imageFile = null; preview.classList.remove('show'); zone.style.display = ''; fileInput.value = '';
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) { toast('Envie uma imagem 📷'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Imagem muito grande (máx. 10 MB)'); return; }
    imageFile = file;
    const reader = new FileReader();
    reader.onload = e => { imageDataUrl = e.target.result; previewImg.src = imageDataUrl; preview.classList.add('show'); zone.style.display = 'none'; };
    reader.readAsDataURL(file);
  }

  $('#encomendaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const nome = $('#encNome').value.trim();
    const tel = $('#encTel').value.trim();
    const email = $('#encEmail').value.trim();
    const desc = $('#encDesc').value.trim();
    const valor = parseFloat($('#encValor').value) || 0;
    if (!nome || !tel || !desc) { toast('Preencha os campos obrigatórios 📝'); return; }
    if (!imageDataUrl) { toast('Envie a foto da sua encomenda 📷'); return; }
    
    // Upload image to Supabase
    const submitBtn = $('#encomendaForm button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';
    try {
      const ext = imageFile.name.split('.').pop() || 'jpg';
      const imageUrl = await uploadToStorage(imageFile, 'encomendas/' + genId('enc') + '.' + ext);
      if (!imageUrl) throw new Error('Falha no envio da imagem');
      await addEncomenda({ nome, tel, email, desc, valor, img: imageUrl, obs: '', status: 'novo' });
      toast('Encomenda enviada com sucesso! 💕');
      setTimeout(() => { location.hash = '#/sobre'; }, 1500);
    } catch (err) {
      console.error('addEncomenda:', err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar Encomenda 💕';
      toast('Não foi possível enviar. Tente novamente. ❌', 5000);
    }
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

// CHECKOUT (com CEP e frete dinamico)
function renderCheckout() {
  const cart = getCart();
  if (cart.length === 0) {
    view.innerHTML = '<div class="error-404"><span class="e404-icon">🛒</span><h1>Carrinho vazio</h1><p>Adicione produtos antes de finalizar.</p><a href="#/loja" class="btn btn-primary">Ir para a loja</a></div>';
    return;
  }
  const items = cart.map(i => Object.assign({}, getProduct(i.id), { qty: i.qty || 1 })).filter(p => p);
  const subtotal = items.reduce((s, p) => s + p.price * p.qty, 0);
  const freeShipping = subtotal >= settings.freeShippingThreshold;
  const defaultFrete = freeShipping ? 0 : (settings.shippingRates.rj || 10);
  const total = subtotal + defaultFrete;

  view.innerHTML = '<div class="checkout-page"><h1>Finalizar Pedido</h1>'
    + '<div class="checkout-summary"><h3>Resumo do pedido</h3><div class="cs-items">'
    + items.map(p => '<div class="cs-item"><img src="' + p.img + '" alt=""><span>' + escapeHtml(p.name) + ' × ' + p.qty + '</span><strong>' + formatPriceSimple(p.price * p.qty) + '</strong></div>').join('')
    + '</div>'
    + '<div class="cart-line"><span>Subtotal</span><strong id="ckSubtotal">' + formatPriceSimple(subtotal) + '</strong></div>'
    + '<div class="cart-line"><span>Frete</span><strong id="ckFrete">' + (freeShipping ? 'Grátis 🎉' : 'Informe o CEP') + '</strong></div>'
    + '<div class="cart-line"><span>Prazo de entrega</span><strong id="ckDelivery">informe o CEP</strong></div>'
    + '<div class="cart-line total"><span>Total</span><strong id="ckTotal">' + formatPriceSimple(total) + '</strong></div></div>'
    + '<div class="checkout-whatsapp-note">📱 Seu pedido será enviado para o nosso WhatsApp. A Juliana entrará em contato para confirmar o pagamento via <strong>Pix</strong>.</div>'
    + '<form id="checkoutForm" novalidate>'
    + '<div class="form-row">'
    + '<div class="form-group"><label>Nome completo <span class="req">*</span></label><input type="text" id="ckNome" required></div>'
    + '<div class="form-group"><label>WhatsApp / Telefone <span class="req">*</span></label><input type="tel" id="ckTel" required></div>'
    + '</div>'
    + '<div class="form-group"><label>CEP <span class="req">*</span></label><input type="text" id="ckCep" maxlength="9" placeholder="00000-000" required><span id="ckCepStatus" class="cep-status"></span></div>'
    + '<div class="form-group"><label>Endereço de entrega <span class="req">*</span></label><textarea id="ckEnd" required placeholder="Rua, número, bairro, cidade"></textarea></div>'
    + '<div class="form-group"><label>Desconto (cupom) - opcional</label><input type="text" id="ckDesconto" placeholder="ex: 10% ou R$ 15"></div>'
    + '<div class="form-group"><label>Observações</label><textarea id="ckObs" placeholder="Alguma informação extra"></textarea></div>'
    + '<button type="submit" class="btn btn-primary btn-lg btn-block">Enviar Pedido pelo WhatsApp 💕</button>'
    + '</form></div>';

  // CEP lookup logic
  let cepUf = '';
  const cepInput = $('#ckCep');
  const cepStatus = $('#ckCepStatus');
  
  cepInput.addEventListener('blur', async () => {
    const val = cepInput.value.trim();
    if (!val) return;
    cepStatus.textContent = 'Buscando...';
    cepStatus.className = 'cep-status';
    try {
      const cepData = await lookupCep(val);
      cepUf = cepData.uf;
      const zone = getShippingZone(cepUf);
      const zoneNames = { rj: 'RJ (local)', southeast: 'Sudeste', south: 'Sul', centerwest: 'Centro-Oeste', north: 'Norte' };
      const frete = calcShipping(cepUf, subtotal);
      const newTotal = subtotal + frete;
      $('#ckFrete').textContent = frete === 0 ? 'Grátis 🎉' : formatPriceSimple(frete);
      $('#ckTotal').textContent = formatPriceSimple(newTotal);
      const dw = deliveryWindow(zone);
      $('#ckDelivery').textContent = fmtBRDate(dw.min) + ' a ' + fmtBRDate(dw.max);
      cepStatus.textContent = '✅ ' + (cepData.localidade || '') + ' - ' + cepUf + ' • ' + (zoneNames[zone] || zone);
      cepStatus.className = 'cep-status ok';
    } catch(err) {
      cepUf = '';
      cepStatus.textContent = '❌ ' + err.message;
      cepStatus.className = 'cep-status err';
    }
  });

  cepInput.addEventListener('input', () => {
    // Auto-format CEP
    let v = cepInput.value.replace(/\D/g, '').substring(0, 8);
    if (v.length > 5) v = v.substring(0,5) + '-' + v.substring(5);
    cepInput.value = v;
    cepUf = '';
    cepStatus.textContent = '';
  });

  $('#checkoutForm').addEventListener('submit', async e => {
    e.preventDefault();
    const nome = $('#ckNome').value.trim();
    const tel = $('#ckTel').value.trim();
    const end = $('#ckEnd').value.trim();
    const desconto = $('#ckDesconto').value.trim();
    const obs = $('#ckObs').value.trim();
    const cep = cepInput.value.trim();
    if (!nome || !tel || !end || !cep) { toast('Preencha todos os campos obrigatórios 📝'); return; }
    
    const frete = calcShipping(cepUf || 'RJ', subtotal);
    const finalTotal = subtotal + frete;
    const dw = deliveryWindow(getShippingZone(cepUf || 'RJ'));

    let msg = '🛒 *NOVO PEDIDO — Feito à Mão*\n';
    msg += '─'.repeat(22) + '\n';
    items.forEach(p => {
      msg += '• ' + p.name + ' × ' + p.qty + ' = ' + formatPriceSimple(p.price * p.qty) + '\n';
    });
    msg += '─'.repeat(22) + '\n';
    msg += 'Subtotal: ' + formatPriceSimple(subtotal) + '\n';
    if (desconto) msg += 'Desconto: ' + desconto + '\n';
    msg += 'Frete: ' + (frete === 0 ? 'GRATIS 🎉' : formatPriceSimple(frete)) + '\n';
    msg += 'Total: ' + formatPriceSimple(finalTotal) + '\n';
    msg += '─'.repeat(22) + '\n';
    msg += '👤 Cliente: ' + nome + '\n';
    msg += '📞 WhatsApp: ' + tel + '\n';
    msg += '📬 CEP: ' + cep + (cepUf ? ' (' + cepUf + ')' : '') + '\n';
    msg += 'Postagem: ' + fmtBRDate(dw.ship) + ' - Entrega prevista: ' + fmtBRDate(dw.min) + ' a ' + fmtBRDate(dw.max) + '\n';
    msg += '📍 Endereço: ' + end + '\n';
    if (desconto) msg += '🏷️ Desconto: ' + desconto + '\n';
    if (obs) msg += '📝 Obs: ' + obs + '\n';
    msg += '─'.repeat(22) + '\n';
    msg += 'Pagamento: Pix (enviar codigo para o cliente)';

    const waUrl = 'https://wa.me/5521983248918?text=' + encodeURIComponent(msg);
    window.open(waUrl, '_blank');

    await addOrder({ type: 'compra', nome, tel, end, obs, desconto,
      items: items.map(p => ({ id: p.id, name: p.name, price: p.price, qty: p.qty })),
      subtotal, frete, total: finalTotal, status: 'novo' });
    setLS(LS.CART, []);
    updateCartUI();
    toast('Pedido enviado pelo WhatsApp! 🎉');
    setTimeout(() => { location.hash = '#/'; }, 2000);
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
    + '<div class="admin-tabs"><button class="active" data-tab="produtos">Produtos</button><button data-tab="pedidos">Pedidos ('+orders.length+')</button><button data-tab="config">Config</button></div>'
    + '<div id="admTabProdutos">'
    + '<div class="admin-panel"><h2>➕ Adicionar / Editar Produto</h2>'
    + '<div class="admin-product-form">'
    + '<div class="form-group"><label>ID (vazio = novo)</label><input type="text" id="admProdId" placeholder="ex: p24"></div>'
    + '<div class="form-row"><div class="form-group"><label>Nome *</label><input type="text" id="admProdNome"></div>'
    + '<div class="form-group"><label>Preço (R$) *</label><input type="number" id="admProdPreco" min="0" step="0.01"></div></div>'
    + '<div class="form-group"><label>Categoria</label><select id="admProdCat"><option value="bolsa">Bolsa</option><option value="bichinho">Bichinho</option><option value="chaveiro">Chaveiro</option><option value="outros">Outros</option></select></div>'
    + '<div class="form-group"><label>Descrição</label><textarea id="admProdDesc"></textarea></div>'
    + '<div class="form-group"><label>Fotos do produto (opcional)</label><input type="file" id="admProdImg" accept="image/*" multiple><small class="form-help">Selecione uma ou várias fotos. A primeira será a capa do produto.</small><div id="admCurrentImages" class="admin-image-preview"></div></div>'
    + '<button type="button" class="btn btn-primary" id="admProdSalvar">Salvar Produto</button>'
    + '</div></div>'
    + '<div class="admin-panel"><h2>📦 Produtos ('+products.length+')</h2><div class="admin-product-list">'
    + (products.length === 0 ? '<p style="color:var(--c-ink-faint)">Nenhum produto.</p>' : products.map(p => '<div class="admin-product-row"><span>'+escapeHtml(p.name)+' — '+formatPriceSimple(p.price)+'</span><div class="api-actions"><button class="btn btn-sm" onclick="App.editProduct(\''+p.id+'\')">✏️ Editar</button> <button class="btn btn-danger btn-sm" onclick="App.deleteProduct(\''+p.id+'\')">🗑 Remover</button></div></div>').join(''))
    + '</div></div></div>'
    + '<div id="admTabPedidos" hidden><div class="admin-panel"><h2>📋 Pedidos ('+orders.length+')</h2><div class="admin-orders-list">'
    + (orders.length === 0 ? '<p style="color:var(--c-ink-faint)">Nenhum pedido ainda.</p>' : orders.map(o => '<div class="admin-order-card"><div class="aoc-header"><span class="aoc-id">'+(o.type==="encomenda"?"📸 Encomenda":"🛒 Pedido")+' — '+escapeHtml(o.nome||"—")+'</span><span class="aoc-status '+(o.status||"novo")+'">'+escapeHtml(o.status||"novo")+'</span></div>'
      + '<div class="aoc-date">'+new Date(o.date).toLocaleDateString("pt-BR",{dateStyle:"medium",timeStyle:"short"})+'</div>'
      + '<div class="aoc-items">'
      + (o.type==="encomenda"
        ? '<p><strong>Desc:</strong> '+escapeHtml(o.desc||o.description||'')+'</p>'+(o.tel?'<p>📱 '+escapeHtml(o.tel)+'</p>':'')+(o.email?'<p>📧 '+escapeHtml(o.email)+'</p>':'')+(o.valor?'<p>💰 '+formatPriceSimple(o.valor)+'</p>':'')+(o.image?'<img src="'+o.image+'" class="aoc-img">':'')
        : '<ul>'+ (o.items||[]).map(i=>'<li>'+escapeHtml(i.name)+' × '+i.qty+' — '+formatPriceSimple(i.price*i.qty)+'</li>').join('') +'</ul><p>Total: <strong>'+formatPriceSimple(o.total)+'</strong></p>'+(o.end?'<p>📍 '+escapeHtml(o.end)+'</p>':'')+(o.tel?'<p>📱 '+escapeHtml(o.tel)+'</p>':'')
      )
      + '</div><div style="margin-top:8px">'
      + '<button class="btn btn-sm" onclick="App.setOrderStatus(\''+o.id+'\',\'processando\')">Processando</button> '
      + '<button class="btn btn-sm btn-success" onclick="App.setOrderStatus(\''+o.id+'\',\'enviado\')">Enviado</button> '
      + '<button class="btn btn-sm btn-danger" onclick="App.setOrderStatus(\''+o.id+'\',\'cancelado\')">Cancelar</button>'
      + '</div></div>').join(''))
    + '</div></div></div>'
    + '<div id="admTabConfig" hidden><div class="admin-panel">'
    + '<h2>⚙️ Configurações</h2>'
    + '<h3 style="margin-top:16px">🔑 Alterar Senha</h3>'
    + '<div class="form-row">'
    + '<div class="form-group"><label>Senha atual</label><input type="password" id="cfgPassAtual" placeholder="senha atual"></div>'
    + '<div class="form-group"><label>Senha nova</label><input type="password" id="cfgPassNova" placeholder="nova senha"></div>'
    + '</div>'
    + '<div class="form-group"><label>Confirmar senha nova</label><input type="password" id="cfgPassConfirm" placeholder="repita a nova senha"></div>'
    + '<button type="button" class="btn btn-primary" id="cfgBtnPass">Alterar Senha</button>'
    + '<hr style="margin:20px 0">'
    + '<h3>🚚 Frete Grátis</h3>'
    + '<div class="form-group"><label>Valor mínimo para frete grátis (R$)</label><input type="number" id="cfgFreteGratis" min="0" step="0.01" value="'+settings.freeShippingThreshold+'"></div>'
    + '<h3>💰 Tarifas de Frete por Região</h3>'
    + '<p style="color:var(--c-ink-faint);font-size:0.9em">Aplicadas quando a compra nao atinge o valor minimo de frete gratis. Valores de referencia para encomenda PAC (item leve, ate 500 g), origem Jacarepagua/RJ - ajuste para a tabela atual da Correios.</p>'
    + '<p style="color:var(--c-ink-faint);font-size:0.9em">Prazo de entrega (dias uteis, postagem no proximo dia util): RJ 2-4 | Sudeste 3-6 | Sul 4-8 | Centro-Oeste 5-10 | Norte 6-12</p>'
    + '<div class="form-row">'
    + '<div class="form-group"><label>Rio de Janeiro (RJ) - local</label><input type="number" id="cfgFreteRJ" min="0" step="0.01" value="'+(settings.shippingRates.rj||10)+'"></div>'
    + '<div class="form-group"><label>Sudeste (SP/MG/ES)</label><input type="number" id="cfgFreteSE" min="0" step="0.01" value="'+(settings.shippingRates.southeast||15)+'"></div>'
    + '</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label>Sul (SC/PR/RS)</label><input type="number" id="cfgFreteSU" min="0" step="0.01" value="'+(settings.shippingRates.south||20)+'"></div>'
    + '<div class="form-group"><label>Centro-Oeste (DF/GO/MT/MS/TO)</label><input type="number" id="cfgFreteCO" min="0" step="0.01" value="'+(settings.shippingRates.centerwest||25)+'"></div>'
    + '</div>'
    + '<div class="form-group"><label>Norte / Outros</label><input type="number" id="cfgFreteN" min="0" step="0.01" value="'+(settings.shippingRates.north||30)+'"></div>'
    + '<button type="button" class="btn btn-primary" id="cfgBtnSave" style="margin-top:12px">Salvar Configurações</button>'
    + '</div></div>'
    + '</div>';

  $('#admLogout').addEventListener('click', () => { adminLogout(); location.hash = '#/'; });
  $$('.admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.admin-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('#admTabProdutos').hidden = btn.dataset.tab !== 'produtos';
      $('#admTabPedidos').hidden = btn.dataset.tab !== 'pedidos';
      $('#admTabConfig').hidden = btn.dataset.tab !== 'config';
    });
  });

  // Save product
  $('#admProdSalvar').addEventListener('click', async () => {
    const id = $('#admProdId').value.trim() || genId('p');
    const nome = $('#admProdNome').value.trim();
    const preco = parseFloat($('#admProdPreco').value);
    const cat = $('#admProdCat').value;
    const desc = $('#admProdDesc').value.trim();
    const fileInput = $('#admProdImg');
    if (!nome) { toast('Informe o nome'); return; }
    if (!preco || preco < 0) { toast('Preço inválido'); return; }
    const existing = getAllProducts().find(p => p.id === id);
    const existingImages = existing ? parseProductImages(existing.images || existing.img) : [];
    let images = existingImages.slice();
    if (fileInput.files.length) {
      const uploadedImages = [];
      for (let i = 0; i < fileInput.files.length; i++) {
        const file = fileInput.files[i];
        const ext = file.name.split('.').pop() || 'jpg';
        const path = 'products/' + id + '/' + Date.now() + '-' + i + '.' + ext;
        const uploaded = await uploadToStorage(file, path);
        if (!uploaded) { toast('Não foi possível enviar uma das fotos ❌'); return; }
        uploadedImages.push(uploaded);
      }
      images = uploadedImages;
    }
    if (!images.length) images = ['assets/img-14.0.jpg'];
    const saveBtn = $('#admProdSalvar');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      await saveAdminProduct({ id, name: nome, price: preco, category: cat, desc: desc || 'Feito à mão com carinho.', img: images[0], images });
      toast('Produto salvo e confirmado no banco! ✅');
      renderAdmin();
    } catch (err) {
      console.error('saveAdminProduct:', err);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar Produto';
      toast('Erro ao salvar no banco. Tente novamente. ❌', 5000);
    }
  });

  // Change password
  $('#cfgBtnPass').addEventListener('click', () => {
    const atual = $('#cfgPassAtual').value;
    const nova = $('#cfgPassNova').value;
    const confirm = $('#cfgPassConfirm').value;
    if (atual !== adminCreds.pass) { toast('Senha atual incorreta ❌'); return; }
    if (!nova || nova.length < 3) { toast('Nova senha deve ter ao menos 3 caracteres'); return; }
    if (nova !== confirm) { toast('As senhas não conferem ❌'); return; }
    adminCreds.pass = nova;
    saveAdminCreds();
    $('#cfgPassAtual').value = '';
    $('#cfgPassNova').value = '';
    $('#cfgPassConfirm').value = '';
  });

  // Save shipping settings
  $('#cfgBtnSave').addEventListener('click', async () => {
    const th = parseFloat($('#cfgFreteGratis').value) || 0;
    settings.freeShippingThreshold = th;
    settings.shippingRates = {
      rj: parseFloat($('#cfgFreteRJ').value) || 0,
      southeast: parseFloat($('#cfgFreteSE').value) || 0,
      south: parseFloat($('#cfgFreteSU').value) || 0,
      centerwest: parseFloat($('#cfgFreteCO').value) || 0,
      north: parseFloat($('#cfgFreteN').value) || 0
    };
    const btn = $('#cfgBtnSave');
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    try {
      await saveGlobalSettings();
      updateCartUI();
      btn.textContent = 'Configurações salvas ✓';
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Salvar Configurações'; } }, 1400);
    } catch (err) {
      console.error('saveGlobalSettings:', err);
      btn.disabled = false;
      btn.textContent = 'Salvar Configurações';
      toast('Erro ao salvar configurações no banco. ❌', 5000);
    }
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
async function init() {
  await loadSettings();
  await loadProducts();
  await loadOrders();
  const cartBtn = $('#cartBtn');
  if (cartBtn) cartBtn.addEventListener('click', e => { e.preventDefault(); cartOpen ? closeCart() : openCart(); });
  const cartClose = $('#cartClose');
  if (cartClose) cartClose.addEventListener('click', closeCart);
  const overlay = $('#overlay');
  if (overlay) overlay.addEventListener('click', closeCart);
  const checkoutBtn = $('#checkoutBtn');
  if (checkoutBtn) checkoutBtn.addEventListener('click', () => { closeCart(); location.hash = '#/checkout'; });
  window.addEventListener('hashchange', render);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeProductModal(); closeCart(); } });
  render();
  updateCartUI();
}

// PUBLIC API
window.App = {
  addToCart: (id, qty) => addToCart(id, qty),
  openProduct: openProductModal,
  closeProduct: closeProductModal,
  selectProductImage: (button, encodedUrl) => {
    const main = $('#productMainImage');
    if (main) main.src = decodeURI(encodedUrl);
    $$('.product-thumb').forEach(b => b.classList.toggle('active', b === button));
  },
  incrementItem: (id) => { const c = getCart(); const i = c.find(x => x.id === id); if (i) { i.qty=(i.qty||1)+1; setLS(LS.CART,c); updateCartUI(); } },
  decrementItem: (id) => { const c = getCart(); const i = c.find(x => x.id === id); if (i) { i.qty=(i.qty||1)-1; if(i.qty<=0) c.splice(c.indexOf(i),1); setLS(LS.CART,c); updateCartUI(); } },
  removeItem: (id) => { setCart(getCart().filter(i => i.id !== id)); },
  editProduct: (id) => {
    const p = getAllProducts().find(x => x.id === id);
    if (!p) return;
    document.getElementById('admProdId').value = p.id;
    document.getElementById('admProdNome').value = p.name;
    document.getElementById('admProdPreco').value = p.price;
    document.getElementById('admProdCat').value = p.category || 'outros';
    document.getElementById('admProdDesc').value = p.desc || '';
    const preview = document.getElementById('admCurrentImages');
    if (preview) preview.innerHTML = parseProductImages(p.images || p.img).map((img, i) => '<img src="'+img+'" alt="Foto atual '+(i+1)+'">').join('');
    document.getElementById('admProdNome').focus();
    toast('Editando: ' + p.name);
  },
  deleteProduct: async (id) => {
    if (!confirm('Remover este produto?')) return;
    try { await deleteAdminProduct(id); toast('Produto removido do catálogo'); renderAdmin(); }
    catch (err) { console.error('deleteAdminProduct:', err); toast('Erro ao remover o produto. ❌', 5000); }
  },
  setOrderStatus: async (id, status) => {
    try { await saveOrderStatus(id, status); toast('Status atualizado no banco'); renderAdmin(); }
    catch (err) { console.error('saveOrderStatus:', err); toast('Erro ao atualizar status. ❌', 5000); }
  },
  _init: init
};

document.addEventListener('DOMContentLoaded', () => window.App._init());
if (document.readyState !== 'loading') window.App._init();

})();
