const $ = (id) => document.getElementById(id);
const form = $('order-form');

let orders = [];
let laptops = [];
let requests = [];

/* ---------- Helpers ---------- */

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

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// The database stores times in UTC like "2026-09-21 14:05:00"
function formatDateTime(stamp) {
  const date = new Date(String(stamp).replace(' ', 'T') + 'Z');
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 08012345678 becomes 2348012345678 for WhatsApp links
function waNumber(phone) {
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '234' + digits.slice(1);
  return digits;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    // no JSON in the response
  }

  if (response.status === 401) {
    window.location.href = '/admin.html';
    throw new Error('Please log in again');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showMessage(text, ok) {
  const el = $('page-message');
  el.textContent = text;
  el.className = 'message ' + (ok ? 'ok' : 'bad');
}

/* ---------- New order form ---------- */

function fillLaptopSelect() {
  const inStock = laptops.filter((l) => l.stock > 0);
  const current = form.elements.laptop_id.value;

  form.elements.laptop_id.innerHTML =
    '<option value="">Choose a laptop</option>' +
    inStock
      .map((l) =>
        `<option value="${l.id}">${escapeHtml(l.brand)} ${escapeHtml(l.model)} - ${formatNaira(l.final_price)} (${l.stock} in stock)</option>`
      )
      .join('');

  form.elements.laptop_id.value = inStock.some((l) => String(l.id) === current) ? current : '';
}

function setDefaults() {
  form.elements.start_date.value = todayISO();
  form.elements.months.value = '3';
  form.elements.markup_percent.value = '0';
  updatePreview();
}

function updatePreview() {
  const preview = $('order-preview');
  const laptop = laptops.find((l) => String(l.id) === form.elements.laptop_id.value);

  if (!laptop) {
    preview.textContent = 'Choose a laptop to see the plan.';
    return;
  }

  const price = laptop.final_price;
  const deposit = Number(form.elements.deposit_amount.value || 0);
  const months = Number(form.elements.months.value || 1);
  const markup = Number(form.elements.markup_percent.value || 0);

  if (deposit < 0 || deposit > price) {
    preview.textContent = `The deposit must be between ${formatNaira(0)} and ${formatNaira(price)}.`;
    return;
  }

  const balance = price - deposit;
  const extra = Math.round((balance * markup) / 100);
  const monthly = Math.ceil((balance + extra) / months);
  const total = deposit + monthly * months;

  preview.innerHTML =
    `Price <strong>${formatNaira(price)}</strong>. ` +
    `Deposit <strong>${formatNaira(deposit)}</strong>, then ` +
    `<strong>${formatNaira(monthly)}</strong> a month for ${months} month${months === 1 ? '' : 's'}. ` +
    `Customer pays <strong>${formatNaira(total)}</strong> in total.`;
}

function clearSource() {
  form.elements.request_id.value = '';
  $('order-source').classList.add('hidden');
}

form.elements.laptop_id.addEventListener('change', () => {
  const laptop = laptops.find((l) => String(l.id) === form.elements.laptop_id.value);
  if (laptop) {
    // Suggest a 40% deposit. It can be changed.
    form.elements.deposit_amount.value = Math.round(laptop.final_price * 0.4);
  }
  updatePreview();
});

['deposit_amount', 'months', 'markup_percent'].forEach((name) => {
  form.elements[name].addEventListener('input', updatePreview);
});

$('order-source-clear').addEventListener('click', clearSource);

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const data = {};
  ['laptop_id', 'customer_name', 'customer_phone', 'deposit_amount', 'months',
   'markup_percent', 'start_date', 'notes'].forEach((name) => {
    data[name] = form.elements[name].value.trim();
  });
  const requestId = form.elements.request_id.value;

  try {
    await api('/api/admin/orders', { method: 'POST', body: JSON.stringify(data) });

    // If the order came from a customer request, mark that request as done
    if (requestId) {
      try {
        await api(`/api/admin/requests/${requestId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'converted' }),
        });
      } catch (e) {
        // the order itself was created, so carry on
      }
    }

    form.reset();
    clearSource();
    await Promise.all([loadOrders(), loadLaptops(), loadRequests()]);
    setDefaults();
    showMessage('Order created. Record each payment when the money arrives.', true);
  } catch (error) {
    showMessage(error.message, false);
  }
});

/* ---------- Summary ---------- */

function renderSummary() {
  const active = orders.filter((o) => o.status === 'active');
  const owed = active.reduce((sum, o) => sum + o.balance, 0);
  const late = active.filter((o) => o.overdue).length;
  const fresh = requests.filter((r) => r.status === 'new').length;

  $('summary').innerHTML = `
    <div class="stat accent"><span>New requests</span><strong>${fresh}</strong></div>
    <div class="stat"><span>Active orders</span><strong>${active.length}</strong></div>
    <div class="stat"><span>Still owed to you</span><strong>${formatNaira(owed)}</strong></div>
    <div class="stat ${late > 0 ? 'warn' : ''}"><span>Overdue orders</span><strong>${late}</strong></div>
  `;
}

/* ---------- Customer requests ---------- */

function requestWhatsApp(r) {
  const message =
    `Hello ${r.customer_name}, thank you for your interest in the ${r.laptop_name}. ` +
    `I'm following up on your request.`;
  return `https://wa.me/${waNumber(r.customer_phone)}?text=${encodeURIComponent(message)}`;
}

function renderRequest(r) {
  const labels = { new: 'New', contacted: 'Contacted', converted: 'Order created', declined: 'Declined' };
  const open = r.status === 'new' || r.status === 'contacted';

  const wants = r.pay_mode === 'installment'
    ? `Wants to pay in installments: ${r.deposit_percent}% deposit over ${r.months} month${r.months === 1 ? '' : 's'}`
    : 'Wants to pay in full';

  const actions = [];
  if (open) {
    actions.push(`<a class="btn small secondary" href="${requestWhatsApp(r)}" target="_blank" rel="noopener">Chat on WhatsApp</a>`);
    actions.push(`<button type="button" class="btn small" data-req="create" data-id="${r.id}">Create order</button>`);
  }
  if (r.status === 'new') {
    actions.push(`<button type="button" class="btn small secondary" data-req="contacted" data-id="${r.id}">Mark contacted</button>`);
  }
  if (open) {
    actions.push(`<button type="button" class="btn small secondary" data-req="declined" data-id="${r.id}">Decline</button>`);
  }
  actions.push(`<button type="button" class="btn small danger" data-req="delete" data-id="${r.id}">Delete</button>`);

  return `
    <article class="req ${r.status === 'new' ? 'new' : ''}">
      <div class="req-head">
        <div>
          <h3>${escapeHtml(r.customer_name)} <span class="pill ${r.status}">${labels[r.status] || escapeHtml(r.status)}</span></h3>
          <div class="muted">${escapeHtml(r.customer_phone)} &middot; ${escapeHtml(r.laptop_name)}</div>
        </div>
        <div class="muted">Request #${r.id} &middot; ${formatDateTime(r.created_at)}</div>
      </div>
      <div class="req-wants">${wants}</div>
      ${r.message ? `<div class="muted">Message: ${escapeHtml(r.message)}</div>` : ''}
      <div class="req-actions">${actions.join('')}</div>
    </article>
  `;
}

function renderRequests() {
  const filter = $('request-filter').value;
  const list = requests.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'open') return r.status === 'new' || r.status === 'contacted';
    return r.status === filter;
  });

  $('requests').innerHTML = list.length
    ? list.map(renderRequest).join('')
    : '<p class="muted">No requests here.</p>';

  renderSummary();
}

$('request-filter').addEventListener('change', renderRequests);

function startOrderFromRequest(r) {
  const laptop = laptops.find((l) => l.id === r.laptop_id && l.stock > 0);
  if (!laptop) {
    showMessage('That laptop is no longer in stock, so an order cannot be created from this request.', false);
    return;
  }

  form.elements.laptop_id.value = String(laptop.id);
  form.elements.customer_name.value = r.customer_name;
  form.elements.customer_phone.value = r.customer_phone;
  form.elements.notes.value = (r.message || '').slice(0, 300);
  form.elements.markup_percent.value = '0';
  form.elements.start_date.value = todayISO();

  if (r.pay_mode === 'installment') {
    form.elements.deposit_amount.value = Math.round((laptop.final_price * r.deposit_percent) / 100);
    form.elements.months.value = String(r.months);
  } else {
    form.elements.deposit_amount.value = laptop.final_price;
    form.elements.months.value = '1';
  }

  form.elements.request_id.value = r.id;
  $('order-source-text').textContent =
    `Creating an order from request #${r.id}: ${r.customer_name} (${r.laptop_name}). Check the details, then click Create order.`;
  $('order-source').classList.remove('hidden');

  updatePreview();
  showMessage('', true);
  $('order-panel').scrollIntoView({ behavior: 'smooth' });
}

$('requests').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-req]');
  if (!button) return;

  const id = Number(button.dataset.id);
  const action = button.dataset.req;
  const request = requests.find((r) => r.id === id);
  if (!request) return;

  try {
    if (action === 'create') {
      startOrderFromRequest(request);
      return;
    }

    if (action === 'contacted' || action === 'declined') {
      await api(`/api/admin/requests/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: action }),
      });
      showMessage(action === 'declined' ? 'Request declined.' : 'Marked as contacted.', true);
    }

    if (action === 'delete') {
      if (!confirm('Delete this request? This cannot be undone.')) return;
      await api(`/api/admin/requests/${id}`, { method: 'DELETE' });
      showMessage('Request deleted.', true);
    }

    await loadRequests();
  } catch (error) {
    showMessage(error.message, false);
  }
});

/* ---------- Orders list ---------- */

function stateOf(order) {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'completed') return 'completed';
  return order.overdue ? 'overdue' : 'active';
}

function reminderLink(order) {
  const dueText = order.overdue
    ? `${formatNaira(order.next_due_amount)} was due on ${formatDate(order.next_due_date)}.`
    : `${formatNaira(order.next_due_amount)} is due on ${formatDate(order.next_due_date)}.`;

  const message =
    `Hello ${order.customer_name}, this is a friendly reminder about your ${order.laptop_name} installment plan. ` +
    `${dueText} Balance remaining: ${formatNaira(order.balance)}. Thank you.`;

  return `https://wa.me/${waNumber(order.customer_phone)}?text=${encodeURIComponent(message)}`;
}

function renderOrder(o) {
  const state = stateOf(o);
  const labels = { active: 'Active', overdue: 'Overdue', completed: 'Completed', cancelled: 'Cancelled' };
  const isActive = o.status === 'active';

  let nextDue = '-';
  if (isActive && o.balance > 0 && o.next_due_date) {
    nextDue = `${formatDate(o.next_due_date)}<br><span class="muted">${formatNaira(o.next_due_amount)}${
      o.overdue ? `, ${o.days_overdue} day${o.days_overdue === 1 ? '' : 's'} late` : ''
    }</span>`;
  }

  const schedule = o.schedule
    .map((s) =>
      `<li class="${s.done ? 'done' : ''}"><span>${s.done ? '\u2713 ' : ''}${escapeHtml(s.label)} - ${formatDate(s.due_date)}</span><strong>${formatNaira(s.amount)}</strong></li>`
    )
    .join('');

  const payments = o.payments.length
    ? o.payments
        .map((p) => `
          <li>
            <span>${formatDate(p.paid_on)} - ${escapeHtml(p.method)}${p.note ? ' - ' + escapeHtml(p.note) : ''}</span>
            <span>
              <strong>${formatNaira(p.amount)}</strong>
              ${o.status !== 'cancelled'
                ? `<button type="button" class="btn small danger" data-action="delete-payment" data-id="${o.id}" data-payment="${p.id}">Remove</button>`
                : ''}
            </span>
          </li>`)
        .join('')
    : '<li class="muted">No payments yet</li>';

  const payForm = isActive
    ? `
      <form class="pay-form" data-order-id="${o.id}">
        <input type="number" name="amount" min="1" max="${o.balance}" value="${o.next_due_amount || ''}" placeholder="Amount (\u20A6)" required>
        <input type="date" name="paid_on" value="${todayISO()}" max="${todayISO()}" required>
        <select name="method">
          <option>Transfer</option><option>Cash</option><option>POS</option><option>Other</option>
        </select>
        <input type="text" name="note" placeholder="Note (optional)" maxlength="200">
        <button type="submit" class="btn small">Record payment</button>
      </form>`
    : '';

  const actions = [];
  if (isActive && o.balance > 0) {
    actions.push(`<a class="btn small secondary" href="${reminderLink(o)}" target="_blank" rel="noopener">Send reminder on WhatsApp</a>`);
  }
  if (o.status !== 'cancelled') {
    actions.push(
      o.handed_over
        ? `<button type="button" class="btn small secondary" data-action="handover" data-id="${o.id}" data-value="0">Undo "handed over"</button>`
        : `<button type="button" class="btn small" data-action="handover" data-id="${o.id}" data-value="1">Mark laptop as handed over</button>`
    );
  }
  if (isActive && !o.handed_over) {
    actions.push(`<button type="button" class="btn small danger" data-action="cancel" data-id="${o.id}">Cancel order</button>`);
  }

  return `
    <article class="order ${state === 'overdue' ? 'overdue' : ''}">
      <div class="order-head">
        <div>
          <h3>${escapeHtml(o.customer_name)}
            <span class="pill ${state}">${labels[state]}</span>
            ${o.handed_over ? '<span class="pill handed">Handed over</span>' : ''}
          </h3>
          <div class="muted">${escapeHtml(o.customer_phone)} &middot; ${escapeHtml(o.laptop_name)}</div>
          ${o.notes ? `<div class="muted">Note: ${escapeHtml(o.notes)}</div>` : ''}
        </div>
        <div class="muted">Order #${o.id} &middot; started ${formatDate(o.start_date)}</div>
      </div>

      <div class="money">
        <div>Total<strong>${formatNaira(o.total_amount)}</strong></div>
        <div>Paid<strong>${formatNaira(o.paid)}</strong></div>
        <div>Balance<strong>${formatNaira(o.balance)}</strong></div>
        <div>Next payment<strong style="font-size:14px">${nextDue}</strong></div>
      </div>

      <div class="two-col">
        <div>
          <h4>Payment plan</h4>
          <ul class="mini">${schedule || '<li class="muted">No installments</li>'}</ul>
        </div>
        <div>
          <h4>Payments received</h4>
          <ul class="mini">${payments}</ul>
        </div>
      </div>

      ${payForm}
      <div class="order-actions">${actions.join('')}</div>
    </article>
  `;
}

function renderOrders() {
  renderSummary();

  const filter = $('order-filter').value;
  const list = orders.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'active') return o.status === 'active';
    if (filter === 'overdue') return o.status === 'active' && o.overdue;
    return o.status === filter;
  });

  $('orders').innerHTML = list.length
    ? list.map(renderOrder).join('')
    : '<p class="muted">No orders here.</p>';
}

$('order-filter').addEventListener('change', renderOrders);

/* ---------- Order actions ---------- */

$('orders').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = Number(button.dataset.id);
  const action = button.dataset.action;

  try {
    if (action === 'handover') {
      await api(`/api/admin/orders/${id}/handover`, {
        method: 'POST',
        body: JSON.stringify({ handed_over: button.dataset.value === '1' }),
      });
      showMessage('Order updated.', true);
    }

    if (action === 'cancel') {
      if (!confirm('Cancel this order? The laptop goes back into stock. Payments already received stay on record.')) return;
      await api(`/api/admin/orders/${id}/cancel`, { method: 'POST' });
      showMessage('Order cancelled and the laptop is back in stock.', true);
    }

    if (action === 'delete-payment') {
      if (!confirm('Remove this payment? Only do this if it was entered by mistake.')) return;
      await api(`/api/admin/orders/${id}/payments/${button.dataset.payment}`, { method: 'DELETE' });
      showMessage('Payment removed.', true);
    }

    await Promise.all([loadOrders(), loadLaptops()]);
  } catch (error) {
    showMessage(error.message, false);
  }
});

$('orders').addEventListener('submit', async (event) => {
  const payForm = event.target.closest('form.pay-form');
  if (!payForm) return;
  event.preventDefault();

  const id = Number(payForm.dataset.orderId);
  const data = {
    amount: payForm.elements.amount.value.trim(),
    paid_on: payForm.elements.paid_on.value,
    method: payForm.elements.method.value,
    note: payForm.elements.note.value.trim(),
  };

  try {
    await api(`/api/admin/orders/${id}/payments`, { method: 'POST', body: JSON.stringify(data) });
    showMessage('Payment recorded.', true);
    await loadOrders();
  } catch (error) {
    showMessage(error.message, false);
  }
});

$('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch (e) {
    // ignore
  }
  window.location.href = '/admin.html';
});

/* ---------- Loading ---------- */

async function loadOrders() {
  orders = await api('/api/admin/orders');
  renderOrders();
}

async function loadRequests() {
  requests = await api('/api/admin/requests');
  renderRequests();
}

async function loadLaptops() {
  const response = await fetch('/api/laptops');
  laptops = await response.json();
  fillLaptopSelect();
  updatePreview();
}

(async function init() {
  try {
    await api('/api/admin/me');
  } catch (e) {
    return; // api() already sent us to the login page
  }
  await loadLaptops();
  setDefaults();
  await Promise.all([loadOrders(), loadRequests()]);
})();