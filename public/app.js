/* ===== Settings you can change ===== */

const STORE_NAME = 'Laptop Store';

// The seller's WhatsApp number (country code, no + or spaces)
const WHATSAPP_NUMBER = '2348100796083';

// Installment choices shown to customers. The seller confirms the final terms.
const INSTALLMENT = {
  depositOptions: [40, 50, 60, 70], // deposit choices in percent
  defaultDeposit: 40,
  monthOptions: [2, 3, 4, 6],       // months to pay the balance
  defaultMonths: 3,
  markupPercent: 0,                 // extra charge on the balance (0 = none)
};

// Minimum specs for each use. The keys match the tags in the admin page.
const USE_CASES = {
  school:          { label: 'School & assignments',          short: 'School',        icon: '🎓', minRam: 4,  minStorage: 128, ssd: false, note: 'at least 4GB RAM and 128GB storage' },
  light:           { label: 'Browsing, Netflix & light use', short: 'Everyday use',  icon: '🍿', minRam: 4,  minStorage: 128, ssd: false, note: 'at least 4GB RAM and 128GB storage' },
  office:          { label: 'Office work & business',        short: 'Office',        icon: '💼', minRam: 8,  minStorage: 256, ssd: true,  note: 'at least 8GB RAM and a 256GB SSD' },
  programming:     { label: 'Programming',                   short: 'Programming',   icon: '👨‍💻', minRam: 16, minStorage: 256, ssd: true,  note: 'at least 16GB RAM and a 256GB SSD' },
  design:          { label: 'Graphic design',                short: 'Design',        icon: '🎨', minRam: 16, minStorage: 512, ssd: true,  note: 'at least 16GB RAM and a 512GB SSD' },
  'video-editing': { label: 'Video editing',                 short: 'Video editing', icon: '🎬', minRam: 16, minStorage: 512, ssd: true,  note: 'at least 16GB RAM and a 512GB SSD' },
  gaming:          { label: 'Gaming',                        short: 'Gaming',        icon: '🎮', minRam: 16, minStorage: 512, ssd: true,  note: 'at least 16GB RAM and a 512GB SSD' },
};

/* ===== Setup ===== */

const $ = (id) => document.getElementById(id);
const grid = $('laptop-grid');
const statusText = $('status');
const filtersForm = $('filters');

let allLaptops = [];
let active = null;    // the laptop and payment mode in the request window
let lastFocus = null;

document.querySelectorAll('[data-store-name]').forEach((el) => { el.textContent = STORE_NAME; });
document.title = `${STORE_NAME} - Find the right laptop, pay your way`;

/* ===== Helpers ===== */

// Stops special characters in data from being run as HTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNaira(amount) {
  return '\u20A6' + Number(amount).toLocaleString();
}

function waLink(text) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function tagsOf(laptop) {
  return String(laptop.use_tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function hasTag(laptop, key) {
  return tagsOf(laptop).includes(key);
}

function meetsUseCase(laptop, useCase) {
  if (!useCase) return true;
  if (laptop.ram_gb < useCase.minRam) return false;
  if (laptop.storage_gb < useCase.minStorage) return false;
  if (useCase.ssd && laptop.storage_type !== 'SSD') return false;
  return true;
}

/* ===== Filtering and sorting ===== */

function getFiltered(key) {
  const useCase = USE_CASES[key] || null;
  const text = $('search').value.trim().toLowerCase();
  const brand = $('brand').value;
  const minRam = Number($('ram').value || 0);
  const minStorage = Number($('storage').value || 0);
  const condition = $('condition').value;
  const budget = Number($('budget').value || 0);
  const inStockOnly = $('instock').checked;
  const sortMode = $('sort').value;

  const list = allLaptops.filter((l) => {
    const haystack = `${l.brand} ${l.model} ${l.processor}`.toLowerCase();
    if (text && !haystack.includes(text)) return false;
    if (brand && l.brand !== brand) return false;
    if (l.ram_gb < minRam) return false;
    if (l.storage_gb < minStorage) return false;
    if (condition && l.condition !== condition) return false;
    if (budget > 0 && l.final_price > budget) return false;
    if (inStockOnly && l.stock <= 0) return false;
    if (!meetsUseCase(l, useCase)) return false;
    return true;
  });

  if (sortMode === 'price-asc') {
    list.sort((a, b) => a.final_price - b.final_price);
  } else if (sortMode === 'price-desc') {
    list.sort((a, b) => b.final_price - a.final_price);
  } else if (sortMode === 'discount') {
    list.sort((a, b) => b.discount_percent - a.discount_percent);
  } else {
    // Best match: in stock first, then tagged for the use, then cheapest
    list.sort((a, b) => {
      const stockDiff = Number(b.stock > 0) - Number(a.stock > 0);
      if (stockDiff) return stockDiff;
      if (key) {
        const tagDiff = Number(hasTag(b, key)) - Number(hasTag(a, key));
        if (tagDiff) return tagDiff;
        return a.final_price - b.final_price;
      }
      return 0; // keeps the newest-first order from the server
    });
  }

  return list;
}

/* ===== Cards ===== */

function buildCard(laptop, pickLabel, matchKey, index) {
  const name = `${laptop.brand} ${laptop.model}`;
  const inStock = laptop.stock > 0;
  const saved = laptop.price - laptop.final_price;

  const image = laptop.image
    ? `<img src="${escapeHtml(laptop.image)}" alt="${escapeHtml(name)}" loading="lazy">`
    : '<span class="card-placeholder" aria-hidden="true">💻</span>';

  const discount = laptop.discount_percent > 0
    ? `<span class="badge-discount">-${laptop.discount_percent}%</span>`
    : '';

  const pick = pickLabel ? `<span class="badge-pick">★ ${pickLabel}</span>` : '';

  const chips = [
    `⚡ ${laptop.ram_gb}GB RAM`,
    `💾 ${laptop.storage_gb}GB ${escapeHtml(laptop.storage_type)}`,
    laptop.screen_size ? `🖥 ${laptop.screen_size}"` : '',
    laptop.battery_health ? `🔋 ${escapeHtml(laptop.battery_health)}` : '',
  ].filter(Boolean).map((c) => `<li>${c}</li>`).join('');

  const useTags = tagsOf(laptop)
    .map((t) => `<span class="use-tag ${t === matchKey ? 'match' : ''}">${escapeHtml(t)}</span>`)
    .join('');

  const oldPrice = laptop.discount_percent > 0
    ? `<span class="old-price">${formatNaira(laptop.price)}</span>`
    : '';
  const savePill = saved > 0 ? `<span class="save">Save ${formatNaira(saved)}</span>` : '';

  let stockHtml;
  if (!inStock) stockHtml = '<span class="stock out">Sold out</span>';
  else if (laptop.stock <= 2) stockHtml = `<span class="stock low">Only ${laptop.stock} left</span>`;
  else stockHtml = '<span class="stock ok">In stock</span>';

  const chat = waLink(`Hello, I'm interested in the ${name} (${formatNaira(laptop.final_price)}).`);

  return `
    <article class="card" style="--i:${Math.min(index, 11)}">
      <div class="card-media">
        ${image}
        ${discount}
        <span class="tag-condition">${escapeHtml(laptop.condition)}</span>
        ${pick}
      </div>
      <div class="card-body">
        <div>
          <h3 class="card-title">${escapeHtml(name)}</h3>
          <p class="card-cpu">${escapeHtml(laptop.processor)}</p>
        </div>
        <ul class="chips">${chips}</ul>
        <div class="use-tags">${useTags}</div>
        <div class="price-block">
          <div><span class="price">${formatNaira(laptop.final_price)}</span>${oldPrice}</div>
          ${savePill}
        </div>
        ${stockHtml}
        <div class="card-actions">
          <button type="button" class="btn btn-primary" data-request="${laptop.id}" ${inStock ? '' : 'disabled'}>
            ${inStock ? 'Request this laptop' : 'Sold out'}
          </button>
          <div class="card-actions-row">
            <button type="button" class="btn btn-outline btn-sm" data-plan="${laptop.id}" ${inStock ? '' : 'disabled'}>📅 Installments</button>
            <a class="btn btn-wa-outline btn-sm" href="${chat}" target="_blank" rel="noopener">💬 WhatsApp</a>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderSkeleton() {
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" aria-hidden="true"></div>').join('');
}

/* ===== Render ===== */

function updateTiles(key) {
  document.querySelectorAll('.tile').forEach((tile) => {
    tile.classList.toggle('on', tile.dataset.usecase === key);
  });
}

function updateFilterCount() {
  let count = 0;
  if ($('usecase').value) count++;
  if ($('brand').value) count++;
  if (Number($('ram').value)) count++;
  if (Number($('storage').value)) count++;
  if ($('condition').value) count++;
  if (Number($('budget').value) > 0) count++;
  if ($('instock').checked) count++;

  $('filter-count').textContent = count;
  $('filter-count').classList.toggle('hidden', count === 0);
}

function render() {
  const key = $('usecase').value;
  const useCase = USE_CASES[key] || null;
  const list = getFiltered(key);

  updateTiles(key);
  updateFilterCount();

  let info = `${list.length} laptop${list.length === 1 ? '' : 's'} found`;
  if (useCase) info += ` for ${useCase.short.toLowerCase()} (needs ${useCase.note})`;
  $('results-info').textContent = info;

  if (list.length === 0) {
    grid.innerHTML = '<div class="empty"><strong>No laptops match these filters</strong>Try a higher budget, or clear the filters to see everything.</div>';
    return;
  }

  const showPick = key && $('sort').value === 'best' && list[0].stock > 0;
  const pickLabel = showPick ? (hasTag(list[0], key) ? 'Top pick' : 'Best value') : '';

  grid.innerHTML = list
    .map((laptop, index) => buildCard(laptop, index === 0 ? pickLabel : '', key, index))
    .join('');
}

/* ===== Installment maths ===== */

function calcPlan(price, depositPercent, months) {
  const deposit = Math.round((price * depositPercent) / 100);
  const balance = price - deposit;
  const extra = Math.round((balance * INSTALLMENT.markupPercent) / 100);
  const owed = balance + extra;
  const monthly = Math.ceil(owed / months);
  const total = deposit + monthly * months;
  return { deposit, balance, extra, monthly, total };
}

/* ===== Request window ===== */

function setupModal() {
  const overlay = document.createElement('div');
  overlay.id = 'rq-overlay';
  overlay.className = 'modal-overlay hidden';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rq-title" tabindex="-1">
      <button type="button" class="modal-close" id="rq-close" aria-label="Close">&times;</button>

      <div id="rq-form-view">
        <h2 id="rq-title"></h2>
        <p class="modal-price" id="rq-price"></p>

        <div class="seg" role="group" aria-label="How do you want to pay?">
          <button type="button" class="seg-btn" data-mode="full">Pay in full</button>
          <button type="button" class="seg-btn" data-mode="installment">Installments</button>
        </div>

        <div id="rq-plan" class="plan hidden">
          <div class="plan-controls">
            <label>Deposit <select id="rq-deposit"></select></label>
            <label>Months to pay the rest <select id="rq-months"></select></label>
          </div>
          <div id="rq-summary"></div>
        </div>

        <form id="rq-form" novalidate>
          <label>Your name
            <input type="text" id="rq-name" maxlength="100" autocomplete="name" required>
          </label>
          <label>Phone / WhatsApp number
            <input type="tel" id="rq-phone" maxlength="20" autocomplete="tel" placeholder="e.g. 08012345678" required>
          </label>
          <label>Message (optional)
            <textarea id="rq-message" maxlength="300" rows="2" placeholder="Anything the seller should know?"></textarea>
          </label>
          <input type="text" id="rq-website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <p id="rq-error" class="form-error" role="alert"></p>
          <button type="submit" class="btn btn-primary btn-block" id="rq-submit">Send request</button>
          <a id="rq-whatsapp" class="btn btn-wa btn-block" target="_blank" rel="noopener">Or chat on WhatsApp</a>
          <p class="fine">No payment is taken on this website. The seller will contact you to confirm availability and terms.</p>
        </form>
      </div>

      <div id="rq-done-view" class="done hidden">
        <div class="done-icon" aria-hidden="true">✓</div>
        <h2>Request sent!</h2>
        <p id="rq-done-text"></p>
        <button type="button" class="btn btn-primary btn-block" id="rq-done-close">Back to laptops</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  $('rq-deposit').innerHTML = INSTALLMENT.depositOptions
    .map((p) => `<option value="${p}">${p}%</option>`).join('');
  $('rq-months').innerHTML = INSTALLMENT.monthOptions
    .map((m) => `<option value="${m}">${m} months</option>`).join('');

  overlay.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!active) return;
      active.mode = btn.dataset.mode;
      updateRequest();
    });
  });

  $('rq-deposit').addEventListener('change', updateRequest);
  $('rq-months').addEventListener('change', updateRequest);
  $('rq-close').addEventListener('click', closeRequest);
  $('rq-done-close').addEventListener('click', closeRequest);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeRequest();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) closeRequest();
  });

  $('rq-form').addEventListener('submit', submitRequest);
}

function openRequest(id, mode) {
  const laptop = allLaptops.find((l) => l.id === id);
  if (!laptop || laptop.stock <= 0) return;

  active = { laptop, mode: mode === 'installment' ? 'installment' : 'full' };
  lastFocus = document.activeElement;

  $('rq-form').reset();
  $('rq-deposit').value = String(INSTALLMENT.defaultDeposit);
  $('rq-months').value = String(INSTALLMENT.defaultMonths);
  $('rq-title').textContent = `${laptop.brand} ${laptop.model}`;
  $('rq-price').textContent = formatNaira(laptop.final_price);
  $('rq-error').textContent = '';
  $('rq-submit').disabled = false;
  $('rq-form-view').classList.remove('hidden');
  $('rq-done-view').classList.add('hidden');

  updateRequest();

  $('rq-overlay').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  $('rq-overlay').querySelector('.modal').focus();
}

function closeRequest() {
  $('rq-overlay').classList.add('hidden');
  document.body.classList.remove('no-scroll');
  active = null;
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}

function updateRequest() {
  if (!active) return;
  const { laptop, mode } = active;
  const name = `${laptop.brand} ${laptop.model}`;
  const price = laptop.final_price;

  $('rq-overlay').querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.mode === mode);
  });
  $('rq-plan').classList.toggle('hidden', mode !== 'installment');

  let text;
  if (mode === 'installment') {
    const depositPercent = Number($('rq-deposit').value);
    const months = Number($('rq-months').value);
    const plan = calcPlan(price, depositPercent, months);

    let rows = `
      <div class="plan-row"><span>Deposit today (${depositPercent}%)</span><strong>${formatNaira(plan.deposit)}</strong></div>
      <div class="plan-row big"><span>Then per month</span><span>${formatNaira(plan.monthly)}</span></div>
      <div class="plan-row"><span>For</span><span>${months} months</span></div>
    `;
    if (plan.extra > 0) {
      rows += `<div class="plan-row"><span>Installment charge</span><span>${formatNaira(plan.extra)}</span></div>`;
    }
    rows += `<div class="plan-row total"><span>Total you pay</span><span>${formatNaira(plan.total)}</span></div>`;

    let schedule = `<li><span>Today (deposit)</span><span>${formatNaira(plan.deposit)}</span></li>`;
    for (let i = 1; i <= months; i++) {
      schedule += `<li><span>Month ${i}</span><span>${formatNaira(plan.monthly)}</span></li>`;
    }
    $('rq-summary').innerHTML = `${rows}<ul class="plan-schedule">${schedule}</ul>`;

    text =
      `Hello, I want to buy the ${name} (${formatNaira(price)}) in installments.\n` +
      `Deposit: ${formatNaira(plan.deposit)} (${depositPercent}%)\n` +
      `Then ${formatNaira(plan.monthly)} per month for ${months} months.\n` +
      `Total: ${formatNaira(plan.total)}`;
  } else {
    text = `Hello, I want to buy the ${name} (${formatNaira(price)}).`;
  }

  $('rq-whatsapp').href = waLink(text);
}

async function submitRequest(event) {
  event.preventDefault();
  if (!active) return;

  const customerName = $('rq-name').value.trim();
  const customerPhone = $('rq-phone').value.trim();
  const errorBox = $('rq-error');
  errorBox.textContent = '';

  if (customerName.length < 2) {
    errorBox.textContent = 'Please enter your name.';
    return;
  }
  if (!/^[0-9+\s()-]{7,20}$/.test(customerPhone)) {
    errorBox.textContent = 'Please enter a valid phone number.';
    return;
  }

  const payload = {
    laptop_id: active.laptop.id,
    customer_name: customerName,
    customer_phone: customerPhone,
    message: $('rq-message').value.trim(),
    pay_mode: active.mode,
    website: $('rq-website').value,
  };
  if (active.mode === 'installment') {
    payload.deposit_percent = Number($('rq-deposit').value);
    payload.months = Number($('rq-months').value);
  }

  const submit = $('rq-submit');
  submit.disabled = true;
  submit.textContent = 'Sending...';

  try {
    const response = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data = {};
    try {
      data = await response.json();
    } catch (e) {
      // no JSON in the response
    }
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');

    $('rq-done-text').textContent =
      `Thanks ${customerName}! The seller will contact you on ${customerPhone} to confirm the ${active.laptop.brand} ${active.laptop.model}.`;
    $('rq-form-view').classList.add('hidden');
    $('rq-done-view').classList.remove('hidden');
  } catch (error) {
    errorBox.textContent = error instanceof TypeError
      ? 'Could not reach the store. Check your connection and try again.'
      : error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Send request';
  }
}

grid.addEventListener('click', (event) => {
  const requestBtn = event.target.closest('[data-request]');
  if (requestBtn) return openRequest(Number(requestBtn.dataset.request), 'full');

  const planBtn = event.target.closest('[data-plan]');
  if (planBtn) openRequest(Number(planBtn.dataset.plan), 'installment');
});

/* ===== Page setup ===== */

function setupUseCases() {
  $('usecase').innerHTML =
    '<option value="">Anything (show all laptops)</option>' +
    Object.entries(USE_CASES)
      .map(([key, uc]) => `<option value="${key}">${uc.label}</option>`)
      .join('');

  $('usecase-tiles').innerHTML = Object.entries(USE_CASES)
    .map(([key, uc]) => `
      <button type="button" class="tile" data-usecase="${key}">
        <span class="tile-icon" aria-hidden="true">${uc.icon}</span>
        <span class="tile-label">${uc.short}</span>
        <span class="tile-note">${uc.minRam}GB+ RAM</span>
      </button>`)
    .join('');
}

function setupBrands() {
  const brands = [...new Set(allLaptops.map((l) => l.brand))].sort();
  $('brand').innerHTML =
    '<option value="">All brands</option>' +
    brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
}

$('usecase-tiles').addEventListener('click', (event) => {
  const tile = event.target.closest('[data-usecase]');
  if (!tile) return;

  const key = tile.dataset.usecase;
  $('usecase').value = $('usecase').value === key ? '' : key;
  render();
  $('shop').scrollIntoView({ behavior: 'smooth' });
});

$('filter-toggle').addEventListener('click', () => {
  const panel = $('filter-panel');
  const open = panel.classList.toggle('hidden') === false;
  $('filter-toggle').setAttribute('aria-expanded', String(open));
});

filtersForm.addEventListener('submit', (event) => event.preventDefault());
filtersForm.addEventListener('input', render);
filtersForm.addEventListener('change', render);

$('reset').addEventListener('click', () => {
  filtersForm.reset();
  render();
});

async function loadLaptops() {
  renderSkeleton();
  try {
    const response = await fetch('/api/laptops');
    if (!response.ok) throw new Error('Server error');
    allLaptops = await response.json();

    if (allLaptops.length === 0) {
      grid.innerHTML = '';
      statusText.textContent = 'No laptops available right now. Please check back soon.';
      statusText.classList.remove('hidden');
      return;
    }

    setupBrands();
    render();
  } catch (error) {
    grid.innerHTML = '';
    statusText.textContent = 'Could not load laptops. Please refresh the page and try again.';
    statusText.classList.remove('hidden');
    console.error(error);
  }
}

const hello = waLink("Hello, I'd like to ask about a laptop.");
$('nav-whatsapp').href = hello;
$('footer-whatsapp').href = hello;

setupUseCases();
setupModal();
loadLaptops();