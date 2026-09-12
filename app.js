/**
 * B2B Trade — Mini-1C
 * Main application logic (Updated for New UI, Import & Advanced Analytics)
 */

(function () {
    'use strict';

    // ========== STATE ==========
    const state = {
        user: null,
        role: 'seller', // 'seller' | 'admin'
        products: [],
        cart: {},          // { productId: qty }
        invoices: [],
        carouselIndex: 0,
        searchQuery: '',
        sortBy: 'name',
        reportPeriod: 'today', // 'today' | 'week' | 'month' | 'all' | 'custom'
        reportDateFrom: null,
        reportDateTo: null
    };

    // ========== DOM REFS ==========
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ========== TOAST ==========
    function toast(message, type = 'info') {
        const container = $('#toastContainer');
        if (!container) return;
        
        const el = document.createElement('div');
        const colors = {
            info: 'bg-white border-pink-200 text-slate-700 shadow-lg shadow-pink-500/5',
            success: 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20',
            error: 'bg-rose-500 text-white shadow-lg shadow-rose-500/20',
            warn: 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
        };
        el.className = `pointer-events-auto px-5 py-3 rounded-2xl border text-sm font-semibold transition-all duration-300 ${colors[type] || colors.info}`;
        el.textContent = message;
        container.appendChild(el);
        
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    // ========== FORMAT ==========
    const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n || 0) + ' ₸';

    // ========== DATA LAYER ==========
    async function loadProducts() {
        if (window.B2B && window.B2B.USE_DEMO) {
            state.products = window.B2B.DemoStore.get('products', []);
            return;
        }
        try {
            const db = window.db || (window.B2B && window.B2B.db) || firebase.firestore();
            const snap = await db.collection('products').get();
            state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.error(e);
            toast('Ошибка загрузки товаров из базы', 'error');
        }
    }

    async function saveProduct(product) {
        if (window.B2B && window.B2B.USE_DEMO) {
            const list = window.B2B.DemoStore.get('products', []);
            if (product.id) {
                const idx = list.findIndex(p => p.id === product.id);
                if (idx >= 0) list[idx] = product;
                else list.push(product);
            } else {
                product.id = 'p' + Date.now() + Math.random().toString(36).substr(2, 4);
                list.push(product);
            }
            window.B2B.DemoStore.set('products', list);
            state.products = list;
            return product;
        }
        
        const db = window.db || (window.B2B && window.B2B.db) || firebase.firestore();
        if (product.id) {
            const id = product.id;
            delete product.id;
            await db.collection('products').doc(id).set(product, { merge: true });
            product.id = id;
        } else {
            product.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await db.collection('products').add(product);
            product.id = ref.id;
        }
        return product;
    }

    async function deleteProductFromDb(id) {
        if (window.B2B && window.B2B.USE_DEMO) {
            let list = window.B2B.DemoStore.get('products', []);
            list = list.filter(p => p.id !== id);
            window.B2B.DemoStore.set('products', list);
            state.products = list;
            return;
        }
        const db = window.db || (window.B2B && window.B2B.db) || firebase.firestore();
        await db.collection('products').doc(id).delete();
        state.products = state.products.filter(p => p.id !== id);
    }

    async function loadInvoices() {
        if (window.B2B && window.B2B.USE_DEMO) {
            state.invoices = window.B2B.DemoStore.get('invoices', []);
            return;
        }
        try {
            const db = window.db || (window.B2B && window.B2B.db) || firebase.firestore();
            const snap = await db.collection('invoices').orderBy('createdAt', 'desc').limit(100).get();
            state.invoices = snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
                };
            });
        } catch (e) {
            console.error(e);
        }
    }

    async function saveInvoice(invoice) {
        if (window.B2B && window.B2B.USE_DEMO) {
            const list = window.B2B.DemoStore.get('invoices', []);
            invoice.id = 'inv' + Date.now();
            invoice.createdAt = new Date().toISOString();
            list.unshift(invoice);
            window.B2B.DemoStore.set('invoices', list);
            
            // Deduct stock
            const products = window.B2B.DemoStore.get('products', []);
            invoice.items.forEach(item => {
                const p = products.find(x => x.id === item.productId);
                if (p) p.stock = Math.max(0, p.stock - item.qty);
            });
            window.B2B.DemoStore.set('products', products);
            state.products = products;
            state.invoices = list;
            return invoice;
        }

        const db = window.db || (window.B2B && window.B2B.db) || firebase.firestore();
        const ref = await db.collection('invoices').add({
            ...invoice,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Batch update product stocks
        const batch = db.batch();
        invoice.items.forEach(item => {
            if (item.productId) {
                const pRef = db.collection('products').doc(item.productId);
                const p = state.products.find(x => x.id === item.productId);
                if (p) {
                    const newStock = Math.max(0, p.stock - item.qty);
                    batch.update(pRef, { stock: newStock });
                    p.stock = newStock;
                }
            }
        });
        await batch.commit();

        invoice.id = ref.id;
        invoice.createdAt = new Date().toISOString();
        state.invoices.unshift(invoice);
        return invoice;
    }

    // ========== AUTH ==========
    async function showApp(user, role = 'seller') {
        state.user = user;
        state.role = role;
        $('#authScreen')?.classList.add('hidden');
        $('#appScreen')?.classList.remove('hidden');
        $('#userInfo')?.classList.remove('hidden');
        
        const badge = $('#userRoleBadge');
        if (badge) {
            if (role === 'admin') {
                badge.textContent = 'Администратор';
                badge.className = 'text-xs px-3 py-1 rounded-full font-semibold bg-violet-100 text-violet-700 border border-violet-200';
                $('#tabAdmin')?.classList.remove('hidden');
            } else {
                badge.textContent = 'Продавец';
                badge.className = 'text-xs px-3 py-1 rounded-full font-semibold bg-pink-100 text-pink-700 border border-pink-200';
                $('#tabAdmin')?.classList.add('hidden');
            }
        }
        
        if (window.lucide) lucide.createIcons();
        await initAppData();
    }

    function logout() {
        state.user = null;
        state.cart = {};
        state.products = [];
        state.invoices = [];
        
        if (window.B2B && window.B2B.USE_DEMO) {
            window.B2B.DemoStore.set('user', null);
        } else if (window.B2B && window.B2B.auth) {
            window.B2B.auth.signOut().catch(console.error);
        }
        
        $('#phoneAuthContainer')?.classList.remove('hidden');
        $('#otpContainer')?.classList.add('hidden');
        if ($('#otpCode')) $('#otpCode').value = '';
        if ($('#phoneNumber')) $('#phoneNumber').value = '';
        
        $('#appScreen')?.classList.add('hidden');
        $('#authScreen')?.classList.remove('hidden');
        $('#userInfo')?.classList.add('hidden');
        updateCartUI();
        toast('Вы вышли из системы');
    }

    function demoLogin(asAdmin = false) {
        const user = { uid: 'demo', displayName: asAdmin ? 'Админ' : 'Продавец', email: 'demo@b2b.local' };
        if (window.B2B) {
            window.B2B.DemoStore.set('user', { ...user, role: asAdmin ? 'admin' : 'seller' });
        }
        showApp(user, asAdmin ? 'admin' : 'seller');
        toast(asAdmin ? 'Вход выполнен: Администратор' : 'Вход выполнен: Продавец', 'success');
    }

    async function handleAuthSuccess(user) {
        try {
            const role = window.B2B ? await window.B2B.resolveUserRole(user) : 'admin';
            if (window.B2B) await window.B2B.ensureUserProfile(user, role);
            await showApp(user, role);
            toast('Добро пожаловать в систему!', 'success');
        } catch (e) {
            console.error(e);
            toast('Ошибка входа: ' + e.message, 'error');
        }
    }

    // ========== CART ==========
    function addToCart(productId, delta = 1) {
        const product = state.products.find(p => p.id === productId);
        if (!product) return;
        
        const current = state.cart[productId] || 0;
        const next = current + delta;
        
        if (next <= 0) {
            delete state.cart[productId];
        } else if (next > product.stock) {
            toast(`На складе доступно только ${product.stock} шт.`, 'warn');
            return;
        } else {
            state.cart[productId] = next;
        }
        updateCartUI();
        renderInvoice();
        renderCatalog();
    }

    function getCartCount() {
        return Object.values(state.cart).reduce((s, q) => s + q, 0);
    }

    function getCartTotal() {
        return Object.entries(state.cart).reduce((sum, [id, qty]) => {
            const p = state.products.find(x => x.id === id);
            return sum + (p ? p.price * qty : 0);
        }, 0);
    }

    function updateCartUI() {
        const count = getCartCount();
        const cartBadge = $('#cartCount');
        if (cartBadge) {
            cartBadge.textContent = count;
            cartBadge.classList.toggle('hidden', count === 0);
        }
        
        const total = getCartTotal();
        if ($('#invoiceTotal')) $('#invoiceTotal').textContent = fmt(total);
        if ($('#submitInvoiceBtn')) {
            $('#submitInvoiceBtn').disabled = count === 0 || !$('#selectStore')?.value;
        }
    }

    // ========== RENDER CATALOG ==========
    function renderCatalog() {
        const list = $('#productList');
        const empty = $('#emptyCatalog');
        if (!list) return;

        let items = [...state.products];
        
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            items = items.filter(p => p.name.toLowerCase().includes(q));
        }
        
        switch (state.sortBy) {
            case 'price-asc': items.sort((a, b) => a.price - b.price); break;
            case 'price-desc': items.sort((a, b) => b.price - a.price); break;
            case 'stock': items.sort((a, b) => b.stock - a.stock); break;
            default: items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        }
        
        if (items.length === 0) {
            list.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }
        empty?.classList.add('hidden');
        
        list.innerHTML = items.map(p => {
            const qty = state.cart[p.id] || 0;
            const img = p.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=fce7f3&color=db2777&size=200`;
            return `
            <div class="bg-white border border-pink-100 rounded-3xl overflow-hidden shadow-sm flex flex-col transition-all hover:shadow-md hover:border-pink-200">
                <div class="aspect-square bg-slate-50 relative overflow-hidden">
                    <img src="${img}" alt="${escapeHtml(p.name)}" class="w-full h-full object-cover" loading="lazy"
                         onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=fce7f3&color=db2777&size=200'">
                    ${p.stock < 10 ? '<span class="absolute top-3 left-3 text-[10px] px-2 py-0.5 bg-rose-500 text-white font-semibold rounded-full shadow-sm">Мало на складе</span>' : ''}
                </div>
                <div class="p-4 flex flex-col flex-1">
                    <h4 class="font-bold text-slate-800 text-sm leading-tight line-clamp-2 mb-1">${escapeHtml(p.name)}</h4>
                    <div class="text-pink-600 font-extrabold text-base mb-1">${fmt(p.price)}</div>
                    <div class="text-xs text-slate-400 mb-4 font-medium">Остаток: ${p.stock} шт</div>
                    <div class="mt-auto">
                        ${qty > 0 ? `
                            <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl p-1">
                                <button class="w-8 h-8 flex items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm font-bold active:scale-95" data-action="dec" data-id="${p.id}">−</button>
                                <span class="font-bold text-slate-800 text-sm px-2">${qty}</span>
                                <button class="w-8 h-8 flex items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm font-bold active:scale-95" data-action="inc" data-id="${p.id}">+</button>
                            </div>
                        ` : `
                            <button class="w-full py-2.5 bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 text-white text-xs font-semibold rounded-2xl shadow-sm transition-all active:scale-95" data-action="add" data-id="${p.id}">
                                В накладную
                            </button>
                        `}
                    </div>
                </div>
            </div>`;
        }).join('');
        
        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                if (action === 'add' || action === 'inc') addToCart(id, 1);
                if (action === 'dec') addToCart(id, -1);
            });
        });
        
        if (window.lucide) lucide.createIcons();
    }

    // ========== RENDER INVOICE ==========
    function renderInvoice() {
        const container = $('#invoiceItems');
        const empty = $('#emptyCart');
        if (!container) return;
        
        const entries = Object.entries(state.cart);
        
        if (entries.length === 0) {
            container.innerHTML = '';
            empty?.classList.remove('hidden');
            updateCartUI();
            return;
        }
        empty?.classList.add('hidden');
        
        container.innerHTML = entries.map(([id, qty]) => {
            const p = state.products.find(x => x.id === id);
            if (!p) return '';
            return `
            <div class="flex items-center justify-between py-3.5 gap-3">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm text-slate-800 truncate">${escapeHtml(p.name)}</div>
                    <div class="text-xs text-slate-400 mt-0.5">${fmt(p.price)} × ${qty} шт</div>
                </div>
                <div class="font-bold text-pink-600 text-sm whitespace-nowrap">${fmt(p.price * qty)}</div>
                <div class="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-100">
                    <button class="w-7 h-7 flex items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm font-bold" data-action="dec" data-id="${id}">−</button>
                    <span class="w-6 text-center text-xs font-bold">${qty}</span>
                    <button class="w-7 h-7 flex items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm font-bold" data-action="inc" data-id="${id}">+</button>
                </div>
            </div>`;
        }).join('');
        
        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                addToCart(id, btn.dataset.action === 'inc' ? 1 : -1);
            });
        });
        
        updateCartUI();
    }

    // ========== RENDER CAROUSEL ==========
    function renderCarousel() {
        const featured = state.products.slice(0, 5);
        const container = $('#carouselContainer');
        const dots = $('#carouselDots');
        if (!container || !dots) return;
        
        if (featured.length === 0) {
            container.innerHTML = `<div class="carousel-slide flex items-center justify-center text-slate-400 text-sm">Витрина товаров пуста</div>`;
            dots.innerHTML = '';
            return;
        }
        
        container.innerHTML = featured.map((p) => {
            const img = p.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=fce7f3&color=db2777&size=400`;
            return `
            <div class="carousel-slide flex items-center justify-between px-8 py-4 bg-gradient-to-r from-pink-500/10 to-violet-500/10 w-full shrink-0">
                <div class="max-w-xs">
                    <span class="text-[10px] font-bold uppercase tracking-widest text-pink-600 bg-pink-100 px-2.5 py-1 rounded-full">Рекомендуемый товар</span>
                    <h3 class="text-lg font-bold text-slate-800 mt-2 line-clamp-1">${escapeHtml(p.name)}</h3>
                    <div class="text-xl font-extrabold text-pink-600 mt-1">${fmt(p.price)}</div>
                </div>
                <img src="${img}" alt="${escapeHtml(p.name)}" class="w-28 h-28 object-cover rounded-2xl shadow-md border-2 border-white shrink-0">
            </div>`;
        }).join('');
        
        dots.innerHTML = featured.map((_, i) => 
            `<button class="w-2 h-2 rounded-full transition-all ${i === 0 ? 'bg-pink-500 w-5' : 'bg-slate-300'}" data-idx="${i}"></button>`
        ).join('');
        
        state.carouselIndex = 0;
        updateCarousel();
        
        dots.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                state.carouselIndex = +btn.dataset.idx;
                updateCarousel();
            });
        });
    }

    function updateCarousel() {
        const container = $('#carouselContainer');
        if (!container || !container.children.length) return;
        const slides = container.children.length;
        state.carouselIndex = (state.carouselIndex + slides) % slides;
        container.style.transform = `translateX(-${state.carouselIndex * 100}%)`;
        
        $$('#carouselDots button').forEach((btn, i) => {
            btn.className = `w-2 h-2 rounded-full transition-all ${i === state.carouselIndex ? 'bg-pink-500 w-5' : 'bg-slate-300'}`;
        });
    }

    // ========== RENDER ADMIN PRODUCTS & STATS ==========
    function renderAdminProducts() {
        const container = $('#adminProductsList');
        if (!container) return;

        if (state.products.length === 0) {
            container.innerHTML = `<p class="text-sm text-slate-400 text-center py-6">Товары отсутствуют в базе</p>`;
            return;
        }

        container.innerHTML = state.products.map(p => `
            <div class="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl transition-all hover:bg-white hover:shadow-sm">
                <div class="flex items-center space-x-3 min-w-0">
                    <img src="${p.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(p.name)}" class="w-10 h-10 rounded-xl object-cover shrink-0 border">
                    <div class="min-w-0">
                        <p class="font-bold text-slate-800 text-sm truncate">${escapeHtml(p.name)}</p>
                        <p class="text-xs text-slate-400 font-medium">Цена: <span class="text-pink-600 font-bold">${fmt(p.price)}</span> | Склад: ${p.stock} шт</p>
                    </div>
                </div>
                <div class="flex items-center space-x-2 shrink-0">
                    <button onclick="window.B2B_EditProduct('${p.id}')" class="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold rounded-xl border border-amber-200 transition-colors">Изменить</button>
                    <button onclick="window.B2B_DeleteProduct('${p.id}')" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-xl border border-rose-200 transition-colors">Удалить</button>
                </div>
            </div>
        `).join('');
    }

    function filterInvoicesByPeriod() {
        const now = new Date();
        return state.invoices.filter(inv => {
            if (!inv.createdAt) return false;
            const invDate = new Date(inv.createdAt);
            
            if (state.reportPeriod === 'today') {
                return invDate.toDateString() === now.toDateString();
            }
            if (state.reportPeriod === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return invDate >= weekAgo;
            }
            if (state.reportPeriod === 'month') {
                return invDate.getMonth() === now.getMonth() && invDate.getFullYear() === now.getFullYear();
            }
            if (state.reportPeriod === 'custom') {
                const from = state.reportDateFrom ? new Date(state.reportDateFrom) : new Date(0);
                const to = state.reportDateTo ? new Date(state.reportDateTo) : new Date(8640000000000000);
                to.setHours(23, 59, 59, 999);
                return invDate >= from && invDate <= to;
            }
            return true; // 'all'
        });
    }

    function renderAdminStats() {
        const filteredInvoices = filterInvoicesByPeriod();
        const revenue = filteredInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
        
        if ($('#statRevenue')) $('#statRevenue').textContent = fmt(revenue);
        if ($('#statCount')) $('#statCount').textContent = filteredInvoices.length;
        if ($('#statProducts')) $('#statProducts').textContent = state.products.length;
        
        const list = $('#invoicesHistoryList');
        if (!list) return;

        if (filteredInvoices.length === 0) {
            list.innerHTML = `<p class="text-xs text-slate-400 text-center py-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">Накладные за выбранный период отсутствуют</p>`;
            return;
        }
        
        list.innerHTML = filteredInvoices.map(inv => {
            const date = inv.createdAt ? new Date(inv.createdAt).toLocaleString('ru-RU') : '—';
            return `
            <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 text-xs">
                <div class="flex justify-between items-start gap-2">
                    <div>
                        <div class="font-bold text-slate-800">${escapeHtml(inv.store || 'Магазин')}</div>
                        <div class="text-[11px] text-slate-400 mt-0.5">${date} • ${inv.items?.length || 0} поз.</div>
                    </div>
                    <div class="font-extrabold text-emerald-600 text-sm whitespace-nowrap">${fmt(inv.total || 0)}</div>
                </div>
            </div>`;
        }).join('');
    }

    // ========== GLOBAL PRODUCT ACTIONS ==========
    window.B2B_EditProduct = function(id) {
        const product = state.products.find(p => p.id === id);
        if (!product) return;
        
        if ($('#productId')) $('#productId').value = product.id;
        if ($('#prodName')) $('#prodName').value = product.name;
        if ($('#prodPrice')) $('#prodPrice').value = product.price;
        if ($('#prodStock')) $('#prodStock').value = product.stock;
        if ($('#prodImageUrl')) $('#prodImageUrl').value = product.image || '';
        
        if ($('#formTitle')) $('#formTitle').textContent = 'Редактирование товара';
        if ($('#saveProdBtn')) $('#saveProdBtn').textContent = 'Сохранить изменения';
        if ($('#resetFormBtn')) $('#resetFormBtn').classList.remove('hidden');
        
        window.scrollTo({ top: $('#addProductForm').offsetTop - 100, behavior: 'smooth' });
    };

    window.B2B_DeleteProduct = async function(id) {
        if (!confirm('Вы действительно хотите удалить этот товар?')) return;
        try {
            await deleteProductFromDb(id);
            renderAdminProducts();
            renderCatalog();
            renderCarousel();
            renderAdminStats();
            toast('Товар успешно удален', 'success');
        } catch (e) {
            toast('Ошибка при удалении товара', 'error');
        }
    };

    function resetProductForm() {
        if ($('#addProductForm')) $('#addProductForm').reset();
        if ($('#productId')) $('#productId').value = '';
        if ($('#formTitle')) $('#formTitle').textContent = 'Добавление товара';
        if ($('#saveProdBtn')) $('#saveProdBtn').textContent = 'Сохранить товар в базе';
        if ($('#resetFormBtn')) $('#resetFormBtn').classList.add('hidden');
    }

    // ========== IMPORT FEATURE ==========
    function downloadSampleCSV() {
        const csvContent = "data:text/csv;charset=utf-8," 
            + "Название,Цена,Количество,Ссылка на фото\n"
            + "Чай KARAK Tea,1500,50,https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500\n"
            + "Кофе Арабика 250г,3200,30,https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=500";
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "sample_products.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function handleFileImport(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            let importedProducts = [];

            try {
                if (file.name.endsWith('.json')) {
                    importedProducts = JSON.parse(text);
                } else {
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    // Пропуск заголовка
                    const dataLines = lines.slice(1);
                    importedProducts = dataLines.map(line => {
                        const parts = line.split(/[,;]/);
                        return {
                            name: parts[0]?.trim() || 'Без названия',
                            price: Number(parts[1]) || 0,
                            stock: Number(parts[2]) || 0,
                            image: parts[3]?.trim() || ''
                        };
                    });
                }

                if (!importedProducts.length) {
                    toast('Файл пуст или содержит неверные данные', 'warn');
                    return;
                }

                for (const prod of importedProducts) {
                    await saveProduct(prod);
                }

                await loadProducts();
                renderCatalog();
                renderAdminProducts();
                renderCarousel();
                renderAdminStats();
                toast(`Успешно импортировано товаров: ${importedProducts.length}`, 'success');
            } catch (err) {
                console.error(err);
                toast('Ошибка разбора файла импорта', 'error');
            }
        };
        reader.readAsText(file);
    }

    // ========== TABS ==========
    function switchTab(tabId) {
        $$('.tab-btn').forEach(btn => {
            btn.classList.remove('active', 'bg-gradient-to-r', 'from-pink-500', 'to-violet-500', 'text-white', 'shadow-md');
            btn.classList.add('bg-white', 'text-slate-500');
        });
        $$('.tab-content').forEach(v => v.classList.add('hidden'));
        
        const btn = $(`#tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
        const view = $(`#view${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
        
        if (btn) {
            btn.classList.add('active', 'bg-gradient-to-r', 'from-pink-500', 'to-violet-500', 'text-white', 'shadow-md');
            btn.classList.remove('bg-white', 'text-slate-500');
        }
        if (view) view.classList.remove('hidden');
        
        if (tabId === 'invoice') renderInvoice();
        if (tabId === 'admin') {
            renderAdminProducts();
            loadInvoices().then(renderAdminStats);
        }
        if (window.lucide) lucide.createIcons();
    }

    // ========== HELPERS ==========
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ========== INIT DATA ==========
    async function initAppData() {
        await loadProducts();
        await loadInvoices();
        renderCatalog();
        renderCarousel();
        updateCartUI();
        renderAdminProducts();
        renderAdminStats();
        
        setInterval(() => {
            if ($('#appScreen')?.classList.contains('hidden')) return;
            state.carouselIndex++;
            updateCarousel();
        }, 5000);
    }

    // ========== EVENT BINDINGS ==========
    function bindEvents() {
        // Tabs
        $('#tabCatalog')?.addEventListener('click', () => switchTab('catalog'));
        $('#tabInvoice')?.addEventListener('click', () => switchTab('invoice'));
        $('#tabAdmin')?.addEventListener('click', () => switchTab('admin'));
        
        // Logout
        $('#logoutBtn')?.addEventListener('click', logout);
        
        // Reset form
        $('#resetFormBtn')?.addEventListener('click', resetProductForm);
        
        // Import & Export Sample
        $('#downloadSampleBtn')?.addEventListener('click', downloadSampleCSV);
        $('#importFileInput')?.addEventListener('change', (e) => {
            if (e.target.files?.[0]) handleFileImport(e.target.files[0]);
        });

        // Period filter buttons
        $$('.report-period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.report-period-btn').forEach(b => {
                    b.classList.remove('active', 'bg-pink-100', 'text-pink-700', 'border', 'border-pink-200');
                    b.classList.add('bg-slate-100', 'text-slate-600');
                });
                btn.classList.add('active', 'bg-pink-100', 'text-pink-700', 'border', 'border-pink-200');
                btn.classList.remove('bg-slate-100', 'text-slate-600');
                
                state.reportPeriod = btn.dataset.period;
                renderAdminStats();
            });
        });

        $('#reportDateFrom')?.addEventListener('change', (e) => {
            state.reportDateFrom = e.target.value;
            state.reportPeriod = 'custom';
            renderAdminStats();
        });
        $('#reportDateTo')?.addEventListener('change', (e) => {
            state.reportDateTo = e.target.value;
            state.reportPeriod = 'custom';
            renderAdminStats();
        });

        // ─── Google Sign-In ───
        $('#googleAuthBtn')?.addEventListener('click', async () => {
            if (window.B2B && window.B2B.USE_DEMO) {
                demoLogin(!!window.event?.shiftKey);
                return;
            }
            if (!window.B2B || !window.B2B.auth) {
                toast('Firebase не инициализирован', 'error');
                return;
            }
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                const result = await window.B2B.auth.signInWithPopup(provider);
                await handleAuthSuccess(result.user);
            } catch (err) {
                toast(err.message || 'Ошибка входа Google', 'error');
            }
        });
        
        // ─── Phone OTP ───
        $('#sendOtpBtn')?.addEventListener('click', async () => {
            let phone = $('#phoneNumber').value.trim().replace(/[\s\-()]/g, '');
            if (/^[78]\d{10}$/.test(phone)) {
                phone = '+' + (phone.startsWith('8') ? '7' + phone.slice(1) : phone);
            }
            if (!phone.startsWith('+')) phone = '+7' + phone.replace(/^0+/, '');
            
            if (!/^\+[1-9]\d{10,14}$/.test(phone)) {
                toast('Введите номер в формате +77001234567', 'warn');
                return;
            }
            
            if (window.B2B && window.B2B.USE_DEMO) {
                $('#phoneAuthContainer')?.classList.add('hidden');
                $('#otpContainer')?.classList.remove('hidden');
                toast('Код отправлен (демо: 123456)', 'info');
                return;
            }
        });

        $('#verifyOtpBtn')?.addEventListener('click', () => {
            const code = $('#otpCode')?.value.trim();
            if (window.B2B && window.B2B.USE_DEMO) {
                if (code === '123456') demoLogin(false);
                else toast('Неверный код. Демо-код: 123456', 'error');
            }
        });
        
        // Search & Sort
        $('#searchInput')?.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            renderCatalog();
        });
        $('#sortSelect')?.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            renderCatalog();
        });
        
        // Store select
        $('#selectStore')?.addEventListener('change', updateCartUI);
        
        // Submit Invoice
        $('#submitInvoiceBtn')?.addEventListener('click', async () => {
            const store = $('#selectStore').value;
            if (!store) {
                toast('Выберите торговую точку', 'warn');
                return;
            }
            if (getCartCount() === 0) {
                toast('Корзина пуста', 'warn');
                return;
            }
            
            const items = Object.entries(state.cart).map(([productId, qty]) => {
                const p = state.products.find(x => x.id === productId);
                return { productId, name: p?.name, price: p?.price, qty };
            });
            
            const invoice = {
                store,
                items,
                total: getCartTotal(),
                userId: state.user?.uid || 'demo',
                userName: state.user?.displayName || 'Продавец'
            };
            
            try {
                await saveInvoice(invoice);
                state.cart = {};
                updateCartUI();
                renderInvoice();
                renderCatalog();
                toast('Накладная проведена успешно!', 'success');
                switchTab('catalog');
            } catch (e) {
                toast('Ошибка сохранения накладной', 'error');
            }
        });
        
        // Save / Edit Product Form
        $('#addProductForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = $('#productId').value;
            const name = $('#prodName').value.trim();
            const price = +$('#prodPrice').value;
            const stock = +$('#prodStock').value;
            const imageUrlInput = $('#prodImageUrl')?.value.trim();
            const fileInput = $('#prodImage');
            
            if (!name || price < 0 || stock < 0) {
                toast('Заполните все поля корректно', 'warn');
                return;
            }
            
            let image = imageUrlInput || null;
            if (fileInput?.files?.[0]) {
                image = URL.createObjectURL(fileInput.files[0]);
            }
            
            const product = {
                ...(id ? { id } : {}),
                name,
                price,
                stock,
                image
            };
            
            try {
                await saveProduct(product);
                resetProductForm();
                await loadProducts();
                renderCatalog();
                renderCarousel();
                renderAdminProducts();
                renderAdminStats();
                toast(id ? 'Товар обновлен' : 'Товар добавлен', 'success');
            } catch (err) {
                toast('Ошибка сохранения товара', 'error');
            }
        });
        
        // Carousel controls
        $('#carouselPrev')?.addEventListener('click', () => {
            state.carouselIndex--;
            updateCarousel();
        });
        $('#carouselNext')?.addEventListener('click', () => {
            state.carouselIndex++;
            updateCarousel();
        });
    }

    // ========== BOOT ==========
    document.addEventListener('DOMContentLoaded', () => {
        if (window.lucide) lucide.createIcons();
        bindEvents();
        
        if (window.B2B && window.B2B.USE_DEMO) {
            $('#demoNotice')?.classList.remove('hidden');
            const saved = window.B2B.DemoStore.get('user');
            if (saved) showApp(saved, saved.role || 'seller');
        } else if (window.B2B && window.B2B.auth) {
            window.B2B.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    if (!state.user || state.user.uid !== user.uid) {
                        const role = await window.B2B.resolveUserRole(user);
                        await window.B2B.ensureUserProfile(user, role);
                        await showApp(user, role);
                    }
                }
            });
        }
    });
})();
