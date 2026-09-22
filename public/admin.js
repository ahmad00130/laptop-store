const TAGS = ['school', 'office', 'light', 'programming', 'design', 'video-editing', 'gaming'];

const FIELDS = [
  'brand', 'model', 'processor', 'ram_gb', 'storage_gb', 'storage_type',
  'screen_size', 'battery_health', 'condition', 'price', 'discount_percent',
  'stock', 'image',
];

const $ = (id) => document.getElementById(id);
const form = $('laptop-form');
let laptops = [];
let uploading = false;

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

  if (response.status === 401 && !url.endsWith('/login')) {
    showLogin();
    throw new Error('Please log in again');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------- Views ---------- */

function showLogin() {
  $('dashboard-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  $('login-form').reset();
}

async function showDashboard(username) {
  $('login-view').classList.add('hidden');
  $('dashboard-view').classList.remove('hidden');
  $('admin-name').textContent = username;
  buildTagBoxes();
  resetForm();
  await loadLaptops();
}

/* ---------- Tags ---------- */

function buildTagBoxes() {
  $('tag-boxes').innerHTML = TAGS.map((tag) =>
    `<label class="tag-option"><input type="checkbox" value="${tag}"> ${tag}</label>`
  ).join('');
}

function setTags(csv) {
  const chosen = String(csv || '').split(',').map((t) => t.trim()).filter(Boolean);
  document.querySelectorAll('#tag-boxes input').forEach((box) => {
    box.checked = chosen.includes(box.value);
  });
}

function getTags() {
  return [...document.querySelectorAll('#tag-boxes input:checked')]
    .map((box) => box.value)
    .join(',');
}

/* ---------- Photo ---------- */

function photoStatus(text, ok) {
  const el = $('photo-status');
  el.textContent = text;
  el.className = 'message ' + (ok ? 'ok' : 'bad');
}

// Shows the photo in the preview box and remembers its link in the hidden field
function setPhoto(url) {
  form.elements.image.value = url || '';
  const preview = $('photo-preview');

  if (url) {
    preview.innerHTML = `<img src="${escapeHtml(url)}" alt="Laptop photo">`;
    $('photo-remove').classList.remove('hidden');
  } else {
    preview.textContent = 'No photo';
    $('photo-remove').classList.add('hidden');
  }
}

// Shrinks a photo to at most 1200px wide/tall and converts it to JPEG
function compressImage(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process the photo'))),
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('That file could not be read as a photo'));
    };

    img.src = objectUrl;
  });
}

$('photo-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    photoStatus('Please choose an image file.', false);
    event.target.value = '';
    return;
  }

  uploading = true;
  $('save-btn').disabled = true;
  photoStatus('Uploading photo...', true);

  try {
    const blob = await compressImage(file);
    const result = await api('/api/admin/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    setPhoto(result.url);
    photoStatus('Photo ready. Click "Save laptop" to keep it.', true);
  } catch (error) {
    photoStatus(error.message, false);
  } finally {
    uploading = false;
    $('save-btn').disabled = false;
    event.target.value = '';
  }
});

$('photo-remove').addEventListener('click', () => {
  setPhoto('');
  photoStatus('Photo removed. Click "Save laptop" to keep the change.', true);
});

/* ---------- Form ---------- */

function showMessage(text, ok) {
  const el = $('form-message');
  el.textContent = text;
  el.className = 'message ' + (ok ? 'ok' : 'bad');
}

function resetForm() {
  form.reset();
  form.elements.laptop_id.value = '';
  setPhoto('');
  photoStatus('', true);
  $('form-title').textContent = 'Add a laptop';
  $('cancel-edit').classList.add('hidden');
  setTags('');
}

function startEdit(id) {
  const laptop = laptops.find((l) => l.id === id);
  if (!laptop) return;

  FIELDS.forEach((name) => {
    form.elements[name].value = laptop[name] ?? '';
  });
  form.elements.laptop_id.value = laptop.id;
  setPhoto(laptop.image || '');
  photoStatus('', true);
  setTags(laptop.use_tags);

  $('form-title').textContent = `Edit: ${laptop.brand} ${laptop.model}`;
  $('cancel-edit').classList.remove('hidden');
  showMessage('', true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (uploading) {
    showMessage('Please wait for the photo to finish uploading.', false);
    return;
  }

  const data = {};
  FIELDS.forEach((name) => {
    data[name] = form.elements[name].value.trim();
  });
  data.use_tags = getTags();

  const id = form.elements.laptop_id.value;

  try {
    await api(id ? `/api/laptops/${id}` : '/api/laptops', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    resetForm();
    showMessage(id ? 'Laptop updated.' : 'Laptop added.', true);
    await loadLaptops();
  } catch (error) {
    showMessage(error.message, false);
  }
});

$('cancel-edit').addEventListener('click', () => {
  resetForm();
  showMessage('', true);
});

/* ---------- Table ---------- */

async function loadLaptops() {
  const response = await fetch('/api/laptops');
  laptops = await response.json();
  renderTable();
}

function renderTable() {
  if (laptops.length === 0) {
    $('laptop-rows').innerHTML = '<tr><td colspan="8">No laptops yet.</td></tr>';
    return;
  }

  $('laptop-rows').innerHTML = laptops.map((l) => `
    <tr>
      <td>${l.image
        ? `<img src="${escapeHtml(l.image)}" alt="" width="56" height="40" style="object-fit:cover;border-radius:6px;">`
        : '\uD83D\uDCBB'}</td>
      <td><strong>${escapeHtml(l.brand)} ${escapeHtml(l.model)}</strong><br>${escapeHtml(l.condition)}</td>
      <td>${escapeHtml(l.processor)}<br>${l.ram_gb}GB RAM, ${l.storage_gb}GB ${escapeHtml(l.storage_type)}</td>
      <td>${formatNaira(l.price)}</td>
      <td>${l.discount_percent}%</td>
      <td>${formatNaira(l.final_price)}</td>
      <td>${l.stock}</td>
      <td>
        <button class="btn small" data-action="edit" data-id="${l.id}">Edit</button>
        <button class="btn small danger" data-action="delete" data-id="${l.id}">Delete</button>
      </td>
    </tr>
  `).join('');
}

$('laptop-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = Number(button.dataset.id);

  if (button.dataset.action === 'edit') {
    startEdit(id);
  }

  if (button.dataset.action === 'delete') {
    const laptop = laptops.find((l) => l.id === id);
    if (!laptop) return;
    if (!confirm(`Delete ${laptop.brand} ${laptop.model}? This cannot be undone.`)) return;

    try {
      await api(`/api/laptops/${id}`, { method: 'DELETE' });
      showMessage('Laptop deleted.', true);
      await loadLaptops();
    } catch (error) {
      showMessage(error.message, false);
    }
  }
});

/* ---------- Login / logout ---------- */

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';

  const formData = new FormData(event.target);
  try {
    const result = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
      }),
    });
    await showDashboard(result.username);
  } catch (error) {
    $('login-error').textContent = error.message;
  }
});

$('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch (e) {
    // ignore
  }
  showLogin();
});

/* ---------- Start ---------- */

(async function init() {
  try {
    const me = await api('/api/admin/me');
    await showDashboard(me.username);
  } catch (e) {
    showLogin();
  }
})();