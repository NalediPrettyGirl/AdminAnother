/* =============================================
   ANOTHER MOMENT — Admin Panel JS
   Completely separate from main site
   ============================================= */

const API = 'https://anotherm-api.onrender.com';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute cache

/* ── Auth Guard ──────────────────────────────── */
(function() {
    if (!sessionStorage.getItem('am_admin_token')) {
        window.location.href = 'admin-login.html';
    }
})();

/* ── State ───────────────────────────────────── */
const adminState = {
    products: [],
    categories: [],
    chats: [],
    users: [],
    loaded: {}
};

// Promise that resolves when ALL data is prefetched
let prefetchPromise = null;

/* ── Server wake-up + prefetch (runs immediately) ── */
// Fire a lightweight ping as soon as the script loads to wake Render from sleep
fetch(`${API}/products`, { method: 'HEAD' }).catch(() => {});

/* ── sessionStorage cache helpers ─────────────── */
function cacheSet(key, data) {
    try {
        sessionStorage.setItem('am_cache_' + key, JSON.stringify({ ts: Date.now(), data }));
    } catch(e) {}
}

function cacheGet(key) {
    try {
        const raw = sessionStorage.getItem('am_cache_' + key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem('am_cache_' + key); return null; }
        return data;
    } catch(e) { return null; }
}

function cacheClear() {
    ['products','categories','chats','users'].forEach(k => {
        sessionStorage.removeItem('am_cache_' + k);
    });
}

/* ── DOM Ready ───────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    initAdmin();
});

function initAdmin() {
    const user = sessionStorage.getItem('am_admin_user') || 'admin';
    const displayName = user.charAt(0).toUpperCase() + user.slice(1);
    const initial = displayName.charAt(0).toUpperCase();

    setText('adminDisplayName', displayName);
    setText('welcomeName', displayName);
    setText('adminAvatarInitial', initial);

    // Nav events
    document.querySelectorAll('.sidebar-link[data-section]').forEach(btn => {
        btn.addEventListener('click', () => switchSection(btn.dataset.section));
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        cacheClear();
        sessionStorage.removeItem('am_admin_auth');
        sessionStorage.removeItem('am_admin_user');
        window.location.href = 'admin-login.html';
    });

    // Refresh — clears cache and re-fetches everything
    document.getElementById('refreshBtn').addEventListener('click', refreshCurrentSection);

    // Sidebar toggle (mobile)
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.style.display = window.innerWidth <= 900 ? 'flex' : 'none';
        sidebarToggle.addEventListener('click', () => {
            document.getElementById('adminSidebar').classList.toggle('open');
        });
    }
    window.addEventListener('resize', () => {
        if (sidebarToggle) sidebarToggle.style.display = window.innerWidth <= 900 ? 'flex' : 'none';
    });

    // Product modal
    document.getElementById('addProductBtn').addEventListener('click', () => openProductModal());
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);

    // Category modal
    document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());
    document.getElementById('saveCategoryBtn').addEventListener('click', saveCategory);

    // Search / filter listeners
    document.getElementById('productSearch').addEventListener('input', renderProducts);
    document.getElementById('productCategoryFilter').addEventListener('change', renderProducts);
    document.getElementById('subscriberSearch').addEventListener('input', renderSubscribers);
    document.getElementById('chatSearch').addEventListener('input', renderChats);
    document.getElementById('userSearch').addEventListener('input', renderUsers);

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Kick off prefetch of ALL data in parallel immediately,
    // then render overview using that data
    prefetchAll().then(() => renderOverviewFromState());
}

/* ── Prefetch ALL collections in parallel ────── */
async function prefetchAll(forceRefresh = false) {
    // Return existing in-flight request if already running
    if (prefetchPromise && !forceRefresh) return prefetchPromise;

    prefetchPromise = (async () => {
        const startMs = Date.now();
        const collections = ['products', 'categories', 'chats', 'users'];

        // Check which collections are already cached
        const needsFetch = collections.filter(k => forceRefresh || !cacheGet(k));
        const hasCached  = collections.filter(k => !forceRefresh && cacheGet(k));

        // Load cached data into state immediately
        hasCached.forEach(k => {
            const cached = cacheGet(k);
            if (cached) {
                adminState[k] = cached;
                adminState.loaded[k] = true;
            }
        });

        if (needsFetch.length === 0) {
            updateBadges();
            return; // Everything was cached — instant!
        }

        // Show server wake-up notice if first load
        if (!forceRefresh && !cacheGet('products')) {
            showServerStatus('Connecting to database…');
        }

        // Fetch all needed collections in parallel
        const results = await Promise.allSettled(
            needsFetch.map(k => apiFetch('/' + k))
        );

        // Store results in state and cache
        needsFetch.forEach((k, i) => {
            const result = results[i];
            const data = result.status === 'fulfilled' && Array.isArray(result.value)
                ? result.value
                : (adminState[k] || []); // keep old data on error
            adminState[k] = data;
            adminState.loaded[k] = true;
            cacheSet(k, data);
        });

        hideServerStatus();
        updateBadges();

        console.log(`[Admin] Prefetch complete in ${Date.now() - startMs}ms`);
    })();

    return prefetchPromise;
}

function updateBadges() {
    setText('badge-products', adminState.products.length);
    setText('badge-subscribers', adminState.products.length);
    setText('stat-products',  adminState.products.length);
    setText('stat-subscribers', adminState.products.length);
    setText('stat-users',     adminState.users.length);
    setText('stat-chats',     adminState.chats.length);
    const revenue = adminState.products.length * 49;
    setText('stat-revenue', `R ${revenue.toFixed(2)}`);
}

/* ── Server status banner ────────────────────── */
function showServerStatus(msg) {
    let banner = document.getElementById('serverStatusBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'serverStatusBanner';
        banner.style.cssText = [
            'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
            'background:var(--admin-card)', 'border:1px solid var(--admin-border)',
            'border-left:3px solid var(--admin-accent)',
            'border-radius:10px', 'padding:12px 20px',
            'display:flex', 'align-items:center', 'gap:12px',
            'font-size:0.87rem', 'color:var(--admin-text)',
            'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
            'z-index:9000', 'transition:opacity 0.3s ease'
        ].join(';');
        banner.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin" style="color:var(--admin-accent);"></i>
            <span id="serverStatusText"></span>
            <small style="color:var(--admin-text-muted);">(Render free tier wakes up in ~30s)</small>
        `;
        document.body.appendChild(banner);
    }
    document.getElementById('serverStatusText').textContent = msg;
    banner.style.opacity = '1';
    banner.style.display = 'flex';
}

function hideServerStatus() {
    const banner = document.getElementById('serverStatusBanner');
    if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => banner && (banner.style.display = 'none'), 300);
    }
}

/* ── Navigation ──────────────────────────────── */
function switchSection(name) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sidebar-link[data-section]').forEach(b => b.classList.remove('active'));

    const section = document.getElementById('section-' + name);
    const navBtn  = document.getElementById('nav-' + name);
    if (section) section.classList.add('active');
    if (navBtn)  navBtn.classList.add('active');

    const titles = {
        overview: 'Overview', products: 'Products', categories: 'Categories',
        subscribers: 'Subscribers', chats: 'Messages', users: 'Users'
    };
    setText('topbarTitle', titles[name] || name);

    // Data is already in adminState from prefetch — render immediately
    // If somehow not loaded yet (edge case), fetch now
    const renders = {
        overview:    renderOverviewFromState,
        products:    renderProducts,
        categories:  renderCategories,
        subscribers: renderSubscribers,
        chats:       renderChats,
        users:       renderUsers
    };

    if (adminState.loaded[name] || name === 'overview') {
        // Instant render from cached state
        if (renders[name]) renders[name]();
    } else {
        // Fallback: wait for prefetch to complete then render
        adminState.loaded[name] = true;
        prefetchAll().then(() => { if (renders[name]) renders[name](); });
    }

    document.getElementById('adminSidebar').classList.remove('open');
}

function refreshCurrentSection() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    cacheClear();
    // Reset all loaded flags
    adminState.loaded = {};
    prefetchPromise = null;

    prefetchAll(true).then(() => {
        // Re-render whichever section is active
        const activeLink = document.querySelector('.sidebar-link.active');
        const name = activeLink ? activeLink.dataset.section : 'overview';
        const renders = {
            overview: renderOverviewFromState, products: renderProducts,
            categories: renderCategories, subscribers: renderSubscribers,
            chats: renderChats, users: renderUsers
        };
        if (renders[name]) renders[name]();
        icon.classList.remove('fa-spin');
    }).catch(() => icon.classList.remove('fa-spin'));
}

/* ── API Helpers ─────────────────────────────── */
async function apiFetch(endpoint, options = {}) {
    try {
        const url = `${API}${endpoint}`;
        const token = sessionStorage.getItem('am_admin_token');
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(url, {
            ...options,
            headers
        });
        if (!res.ok) {
            const text = await res.text();
            let msg = `API error: ${res.status}`;
            try { msg = JSON.parse(text).error || msg; } catch(e){}
            throw new Error(msg);
        }
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? await res.json() : await res.text();
    } catch (err) {
        console.error('Admin API error:', err.message);
        return null;
    }
}

/* ── Overview ────────────────────────────────── */
// Pure render from prefetched adminState — no API calls
function renderOverviewFromState() {
    updateBadges();
    renderRecentSubscribers();
    renderRecentProducts();
}

function renderRecentSubscribers() {
    const recentSubs = [...adminState.products]
        .sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt))
        .slice(0, 5);

    const tbody = document.getElementById('recentSubscribersBody');
    if (!tbody) return;

    if (recentSubs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="fa-solid fa-address-card"></i><p>No subscribers yet</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = recentSubs.map(p => {
        const user = adminState.users.find(u => u.id === p.sellerId) || {};
        const userName = user.firstName ? `${user.firstName} ${user.lastName || ''}` : (user.email || 'Unknown User');
        return `
        <tr>
            <td>
                <div style="font-weight:600;">${esc(userName)}</div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">${esc(user.email || '—')}</div>
            </td>
            <td>${esc(p.title || '—')}</td>
            <td style="font-weight:600;color:var(--admin-accent);">R 49.00</td>
        </tr>
    `}).join('');
}

function renderRecentProducts() {
    const recentProducts = [...adminState.products]
        .sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt))
        .slice(0, 5);

    const tbody = document.getElementById('recentProductsBody');
    if (!tbody) return;

    if (recentProducts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="fa-solid fa-tags"></i><p>No products yet</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = recentProducts.map(p => `
        <tr>
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    ${p.imageUrl
                        ? `<img src="${esc(p.imageUrl)}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;" onerror="this.style.display='none'">`
                        : `<div style="width:32px;height:32px;border-radius:6px;background:var(--admin-dark-3);display:flex;align-items:center;justify-content:center;color:var(--admin-text-muted);font-size:13px;"><i class="fa-solid fa-image"></i></div>`
                    }
                    <span style="font-weight:600;">${esc(p.title || '—')}</span>
                </div>
            </td>
            <td style="font-weight:700;color:var(--admin-accent);">R ${parseFloat(p.price || 0).toFixed(2)}</td>
            <td><span class="badge badge-gold">${esc(p.category || '—')}</span></td>
        </tr>
    `).join('');
}


/* ── Products ────────────────────────────────── */

function renderProducts() {
    const search    = (document.getElementById('productSearch').value || '').toLowerCase();
    const catFilter = (document.getElementById('productCategoryFilter').value || '').toLowerCase();

    let list = adminState.products.filter(p => {
        const matchSearch = !search || (p.title || '').toLowerCase().includes(search)
                                    || (p.color || '').toLowerCase().includes(search)
                                    || (p.description || '').toLowerCase().includes(search);
        const matchCat = !catFilter || (p.category || '').toLowerCase().includes(catFilter);
        return matchSearch && matchCat;
    }).sort((a,b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));

    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-tags"></i><p>No products found.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(p => `
        <tr>
            <td>
                <div class="table-product-info">
                    ${p.imageUrl
                        ? `<img src="${esc(p.imageUrl)}" class="table-product-img" alt="${esc(p.title)}" onerror="this.style.display='none'">`
                        : `<div class="table-product-img"><i class="fa-solid fa-image"></i></div>`
                    }
                    <div>
                        <span class="table-product-name">${esc(p.title || '—')}</span>
                        <span class="table-product-sub">${esc(p.description ? p.description.substring(0,55) + (p.description.length > 55 ? '…' : '') : '')}</span>
                    </div>
                </div>
            </td>
            <td><span class="badge badge-gold">${esc(p.category || '—')}</span></td>
            <td style="font-weight:700;color:var(--admin-accent);">R ${parseFloat(p.price || 0).toFixed(2)}</td>
            <td>${esc(p.size || '—')}</td>
            <td>${esc(p.color || p.condition || '—')}</td>
            <td>${productStatusBadge(p.status)}</td>
            <td>
                <div class="table-actions">
                    <button class="table-action-btn" title="Edit" onclick='openProductModal(${safeJson(p)})'>
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="table-action-btn danger" title="Delete" onclick="confirmDelete('product','${esc(p.id)}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openProductModal(product = null) {
    const isEdit = !!product;
    document.getElementById('productModalTitle').textContent = isEdit ? 'Edit Product' : 'Add Product';
    document.getElementById('pEditId').value       = isEdit ? product.id          || '' : '';
    document.getElementById('pTitle').value        = isEdit ? product.title       || '' : '';
    document.getElementById('pCategory').value     = isEdit ? product.category    || '' : '';
    document.getElementById('pPrice').value        = isEdit ? product.price       || '' : '';
    document.getElementById('pSize').value         = isEdit ? product.size        || '' : '';
    document.getElementById('pColor').value        = isEdit ? product.color       || product.condition || '' : '';
    document.getElementById('pStatus').value       = isEdit ? product.status      || 'available' : 'available';
    document.getElementById('pDescription').value  = isEdit ? product.description || '' : '';
    document.getElementById('pImageUrl').value     = isEdit ? product.imageUrl    || '' : '';
    openModal('productModal');
}

async function saveProduct() {
    const id       = document.getElementById('pEditId').value;
    const title    = document.getElementById('pTitle').value.trim();
    const category = document.getElementById('pCategory').value;
    const price    = document.getElementById('pPrice').value;

    if (!title || !category || !price) {
        showToast('Title, Category and Price are required.', 'error');
        return;
    }

    const data = {
        title, category,
        price: parseFloat(price),
        size:        document.getElementById('pSize').value.trim(),
        color:       document.getElementById('pColor').value.trim(),
        status:      document.getElementById('pStatus').value,
        description: document.getElementById('pDescription').value.trim(),
        imageUrl:    document.getElementById('pImageUrl').value.trim()
    };

    const btn = document.getElementById('saveProductBtn');
    setLoading(btn, true, 'Saving…');

    const result = id
        ? await apiFetch(`/products/${id}`, { method: 'PUT',  body: JSON.stringify(data) })
        : await apiFetch('/products',        { method: 'POST', body: JSON.stringify(data) });

    setLoading(btn, false, '<i class="fa-solid fa-floppy-disk"></i> Save Product');

    if (result !== null) {
        showToast(id ? 'Product updated!' : 'Product created!', 'success');
        closeModal('productModal');
        adminState.loaded.products = false;
        await loadProducts();
    } else {
        showToast('Failed to save product. Check console.', 'error');
    }
}

/* ── Categories ──────────────────────────────── */
async function loadCategories() {
    setTableLoading('categoriesTableBody', 4);
    const cats = await apiFetch('/categories');
    adminState.categories = Array.isArray(cats) ? cats : [];
    renderCategories();
    return Promise.resolve();
}

function renderCategories() {
    const tbody = document.getElementById('categoriesTableBody');
    if (!tbody) return;

    if (adminState.categories.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>No categories yet.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = adminState.categories.map(c => `
        <tr>
            <td style="font-weight:600;">${esc(c.name || '—')}</td>
            <td style="color:var(--admin-text-muted);font-size:0.85rem;">${esc(c.description ? c.description.substring(0,80)+(c.description.length>80?'…':'') : '—')}</td>
            <td style="font-size:0.8rem;">
                ${c.imageUrl
                    ? `<a href="${esc(c.imageUrl)}" target="_blank" style="color:var(--admin-accent);">View Image <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;"></i></a>`
                    : '—'
                }
            </td>
            <td>
                <div class="table-actions">
                    <button class="table-action-btn" title="Edit" onclick='openCategoryModal(${safeJson(c)})'>
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="table-action-btn danger" title="Delete" onclick="confirmDelete('category','${esc(c.id)}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openCategoryModal(cat = null) {
    const isEdit = !!cat;
    document.getElementById('categoryModalTitle').textContent = isEdit ? 'Edit Category' : 'Add Category';
    document.getElementById('cEditId').value       = isEdit ? cat.id          || '' : '';
    document.getElementById('cName').value         = isEdit ? cat.name        || '' : '';
    document.getElementById('cDescription').value  = isEdit ? cat.description || '' : '';
    document.getElementById('cImageUrl').value     = isEdit ? cat.imageUrl    || '' : '';
    openModal('categoryModal');
}

async function saveCategory() {
    const id   = document.getElementById('cEditId').value;
    const name = document.getElementById('cName').value.trim();
    if (!name) { showToast('Category name is required.', 'error'); return; }

    const data = {
        name,
        description: document.getElementById('cDescription').value.trim(),
        imageUrl:    document.getElementById('cImageUrl').value.trim()
    };

    const btn = document.getElementById('saveCategoryBtn');
    setLoading(btn, true, 'Saving…');

    const result = id
        ? await apiFetch(`/categories/${id}`, { method: 'PUT',  body: JSON.stringify(data) })
        : await apiFetch('/categories',        { method: 'POST', body: JSON.stringify(data) });

    setLoading(btn, false, '<i class="fa-solid fa-floppy-disk"></i> Save Category');

    if (result !== null) {
        showToast(id ? 'Category updated!' : 'Category created!', 'success');
        closeModal('categoryModal');
        adminState.loaded.categories = false;
        await loadCategories();
    } else {
        showToast('Failed to save category.', 'error');
    }
}

/* ── Subscribers ───────────────────────────────── */
function renderSubscribers() {
    const search = (document.getElementById('subscriberSearch').value || '').toLowerCase();

    let list = adminState.products.filter(p => {
        const user = adminState.users.find(u => u.id === p.sellerId) || {};
        const userName = user.firstName ? `${user.firstName} ${user.lastName || ''}` : (user.email || 'Unknown User');
        
        const matchSearch = !search
            || userName.toLowerCase().includes(search)
            || (user.email || '').toLowerCase().includes(search)
            || (p.title || '').toLowerCase().includes(search);
        return matchSearch;
    }).sort((a,b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));

    const tbody = document.getElementById('subscribersTableBody');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-address-card"></i><p>No subscribers found.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(p => {
        const user = adminState.users.find(u => u.id === p.sellerId) || {};
        const userName = user.firstName ? `${user.firstName} ${user.lastName || ''}` : (user.email || 'Unknown User');
        return `
        <tr>
            <td>
                <div style="font-weight:600;">${esc(userName)}</div>
                <div style="font-size:0.83rem;color:var(--admin-text-muted);">${esc(user.email || '—')}</div>
            </td>
            <td>
                <div style="font-weight:600;">${esc(p.title || '—')}</div>
                <div style="font-size:0.75rem;color:var(--admin-accent);">${esc(p.category || '')}</div>
            </td>
            <td style="font-weight:700;color:var(--admin-accent);">R 49.00</td>
            <td style="font-size:0.82rem;color:var(--admin-text-muted);">${formatDate(p.createdAt)}</td>
        </tr>
    `}).join('');
}


/* ── Chats ───────────────────────────────────── */
async function loadChats() {
    setTableLoading('chatsTableBody', 6);
    const chats = await apiFetch('/chats');
    adminState.chats = Array.isArray(chats) ? chats : [];
    setText('stat-chats', adminState.chats.length);
    renderChats();
    return Promise.resolve();
}

function renderChats() {
    const search = (document.getElementById('chatSearch').value || '').toLowerCase();

    let list = adminState.chats.filter(c =>
        !search
        || (c.buyerName || '').toLowerCase().includes(search)
        || (c.productTitle || '').toLowerCase().includes(search)
        || (c.buyerEmail || '').toLowerCase().includes(search)
    ).sort((a,b) => getTimestamp(b.updatedAt) - getTimestamp(a.updatedAt));

    const tbody = document.getElementById('chatsTableBody');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-comments"></i><p>No chat threads yet.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(c => `
        <tr>
            <td><code style="font-size:0.75rem;color:var(--admin-text-muted);">${esc((c.id||'').substring(0,18))}…</code></td>
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    ${c.productImage
                        ? `<img src="${esc(c.productImage)}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;" onerror="this.style.display='none'">`
                        : `<div style="width:32px;height:32px;border-radius:6px;background:var(--admin-dark-3);display:flex;align-items:center;justify-content:center;color:var(--admin-text-muted);font-size:13px;"><i class="fa-solid fa-image"></i></div>`
                    }
                    <span style="font-weight:600;">${esc(c.productTitle || '—')}</span>
                </div>
            </td>
            <td>
                <span style="font-weight:600;">${esc(c.buyerName || '—')}</span>
                <div style="font-size:0.78rem;color:var(--admin-text-muted);">${esc(c.buyerEmail || '')}</div>
            </td>
            <td><span class="badge badge-blue">${(c.messages || []).length} msg${(c.messages||[]).length===1?'':'s'}</span></td>
            <td style="font-size:0.82rem;color:var(--admin-text-muted);">${formatDate(c.updatedAt)}</td>
            <td>
                <button class="table-action-btn" title="View Thread" onclick='viewChat(${safeJson(c)})'>
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function viewChat(chat) {
    document.getElementById('chatModalTitle').textContent = `Chat: ${chat.productTitle || 'Unknown Product'}`;
    const body = document.getElementById('chatModalBody');
    const msgs  = chat.messages || [];

    if (msgs.length === 0) {
        body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-comments"></i><p>No messages in this thread.</p></div>`;
    } else {
        const infoHtml = `
            <div style="margin-bottom:16px;padding:14px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--admin-border);">
                <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--admin-text-muted);margin-bottom:10px;">Thread Info</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;">
                    <div><span style="color:var(--admin-text-muted);">Buyer:</span> <strong>${esc(chat.buyerName || '—')}</strong></div>
                    <div><span style="color:var(--admin-text-muted);">Email:</span> ${esc(chat.buyerEmail || '—')}</div>
                    <div><span style="color:var(--admin-text-muted);">Phone:</span> ${esc(chat.buyerPhone || '—')}</div>
                    <div><span style="color:var(--admin-text-muted);">Product:</span> <strong>${esc(chat.productTitle || '—')}</strong></div>
                </div>
            </div>
        `;

        const msgsHtml = msgs.map(m => {
            const isBuyer  = (m.sender || '').toLowerCase() === 'buyer';
            const msgText  = m.text || m.message || '—';
            const msgTime  = m.timestamp ? formatDate(m.timestamp) : '';
            return `
                <div style="
                    background:${isBuyer ? 'rgba(96,165,250,0.07)' : 'rgba(179,154,88,0.07)'};
                    border:1px solid ${isBuyer ? 'rgba(96,165,250,0.18)' : 'rgba(179,154,88,0.18)'};
                    border-radius:10px; padding:12px 14px;
                    margin-${isBuyer ? 'right' : 'left'}:40px; margin-bottom:10px;
                ">
                    <div style="font-size:0.7rem;font-weight:700;color:${isBuyer ? 'var(--admin-blue)' : 'var(--admin-accent)'};text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">
                        <i class="fa-solid fa-${isBuyer ? 'user' : 'store'}" style="margin-right:5px;"></i>${esc(m.sender || 'unknown')}
                    </div>
                    <div style="font-size:0.9rem;color:var(--admin-text);line-height:1.5;">${esc(msgText)}</div>
                    ${msgTime ? `<div style="font-size:0.72rem;color:var(--admin-text-muted);margin-top:6px;">${msgTime}</div>` : ''}
                </div>
            `;
        }).join('');

        body.innerHTML = infoHtml + `<div style="display:flex;flex-direction:column;">${msgsHtml}</div>`;
    }
    openModal('chatModal');
}

/* ── Users ───────────────────────────────────── */
async function loadUsers() {
    setTableLoading('usersTableBody', 6);
    const users = await apiFetch('/users');
    adminState.users = Array.isArray(users) ? users : [];
    setText('stat-users', adminState.users.length);
    renderUsers();
    return Promise.resolve();
}

function renderUsers() {
    const search = (document.getElementById('userSearch').value || '').toLowerCase();

    let list = adminState.users.filter(u =>
        !search
        || (u.name || '').toLowerCase().includes(search)
        || (u.surname || '').toLowerCase().includes(search)
        || (u.email || '').toLowerCase().includes(search)
        || (u.username || '').toLowerCase().includes(search)
    ).sort((a,b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));

    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-users"></i><p>No users found.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(u => {
        const fullName = [u.name, u.surname].filter(Boolean).join(' ') || '—';
        const initials = (u.name || u.username || '?').charAt(0).toUpperCase();
        return `
        <tr>
            <td>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="
                        width:38px;height:38px;border-radius:50%;
                        background:linear-gradient(135deg,var(--admin-accent),#8a7040);
                        display:flex;align-items:center;justify-content:center;
                        font-weight:700;color:white;font-size:15px;flex-shrink:0;
                    ">${initials}</div>
                    <span style="font-weight:600;">${esc(fullName)}</span>
                </div>
            </td>
            <td><code style="font-size:0.83rem;color:var(--admin-text-muted);">@${esc(u.username || '—')}</code></td>
            <td style="font-size:0.85rem;">${esc(u.email || '—')}</td>
            <td style="font-size:0.85rem;">
                ${u.whatsapp
                    ? `<a href="https://wa.me/${esc(u.whatsapp.replace(/\D/g,''))}" target="_blank" style="color:var(--admin-green);display:inline-flex;align-items:center;gap:5px;"><i class="fa-brands fa-whatsapp"></i> ${esc(u.whatsapp)}</a>`
                    : '—'
                }
            </td>
            <td style="font-size:0.82rem;color:var(--admin-text-muted);">${formatDate(u.createdAt)}</td>
            <td>
                <button class="table-action-btn danger" title="Delete User" onclick="confirmDelete('user','${esc(u.id)}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>
        `;
    }).join('');
}

/* ── Confirm Delete ──────────────────────────── */
let pendingDelete = null;

function confirmDelete(type, id) {
    pendingDelete = { type, id };
    document.getElementById('confirmDeleteBtn').onclick = executePendingDelete;
    openModal('confirmModal');
}

async function executePendingDelete() {
    if (!pendingDelete) return;
    const { type, id } = pendingDelete;

    const endpoints = {
        product: '/products', category: '/categories',
        order: '/orders', user: '/users'
    };

    const btn = document.getElementById('confirmDeleteBtn');
    setLoading(btn, true, 'Deleting…');

    const result = await apiFetch(`${endpoints[type]}/${id}`, { method: 'DELETE' });

    setLoading(btn, false, '<i class="fa-solid fa-trash"></i> Delete');

    if (result !== null) {
        showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted.`, 'success');
        closeModal('confirmModal');
        pendingDelete = null;

        const reloaders = {
            product:  () => { adminState.loaded.products  = false; loadProducts(); },
            category: () => { adminState.loaded.categories = false; loadCategories(); },
            order:    () => { adminState.loaded.orders    = false; loadOrders(); },
            user:     () => { adminState.loaded.users     = false; loadUsers(); }
        };
        if (reloaders[type]) reloaders[type]();
    } else {
        showToast(`Failed to delete ${type}.`, 'error');
        setLoading(btn, false, '<i class="fa-solid fa-trash"></i> Delete');
    }
}

/* ── Modals ──────────────────────────────────── */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ── Toast ───────────────────────────────────── */
function showToast(message, type = 'info') {
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${esc(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'all 0.3s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(24px)';
        setTimeout(() => toast.remove(), 320);
    }, 3500);
}

/* ── Utility ─────────────────────────────────── */

/** Safely escape HTML */
function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

/** Set innerText of element by id */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/** Set table to loading state */
function setTableLoading(tbodyId, colspan) {
    const el = document.getElementById(tbodyId);
    if (el) el.innerHTML = `<tr><td colspan="${colspan}" class="table-loading"><i class="fa-solid fa-spinner fa-spin" style="font-size:22px;"></i><div style="margin-top:10px;font-size:0.82rem;">Loading from database…</div></td></tr>`;
}

/** Toggle button loading state */
function setLoading(btn, isLoading, restoreHtml) {
    if (!btn) return;
    btn.disabled = isLoading;
    if (isLoading) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (typeof restoreHtml === 'string' && !restoreHtml.includes('<') ? restoreHtml : 'Loading…');
    } else {
        btn.innerHTML = restoreHtml;
    }
}

/** Get numeric timestamp from Firestore timestamp or ISO string */
function getTimestamp(ts) {
    if (!ts) return 0;
    if (ts._seconds) return ts._seconds * 1000;
    if (ts.seconds)  return ts.seconds  * 1000;
    const d = new Date(ts);
    return isNaN(d) ? 0 : d.getTime();
}

/** Format a Firestore timestamp or ISO string for display */
function formatDate(ts) {
    const t = getTimestamp(ts);
    if (!t) return '—';
    return new Date(t).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Order status badge */
function statusBadge(status) {
    const map = {
        pending:   'badge-orange',
        confirmed: 'badge-blue',
        completed: 'badge-green',
        cancelled: 'badge-red',
        active:    'badge-green'
    };
    return `<span class="badge ${map[status] || 'badge-grey'}">${esc(status || 'pending')}</span>`;
}

/** Product availability badge */
function productStatusBadge(status) {
    const map = { available: 'badge-green', rented: 'badge-orange', unavailable: 'badge-red' };
    return `<span class="badge ${map[status] || 'badge-grey'}">${esc(status || 'available')}</span>`;
}

/** Safely serialize an object for inline onclick attributes */
function safeJson(obj) {
    return JSON.stringify(obj)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;');
}
