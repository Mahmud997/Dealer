/**
 * B2B Trade — Mini-1C
 * Main application logic
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
        sortBy: 'name'
    };

    // ========== DOM REFS ==========
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ========== TOAST ==========
    function toast(message, type = 'info') {
        const container = $('#toastContainer');
        const el = document.createElement('div');
        const colors = {
            info: 'bg-slate-800 border-slate-600 text-slate-100',
            success: 'bg-emerald-900/90 border-emerald-600 text-emerald-100',
            error: 'bg-red-900/90 border-red-600 text-red-100',
            warn: 'bg-amber-900/90 border-amber-600 text-amber-100'
        };
        el.className = `pointer-events-auto px-4 py-3 rounded-xl border shadow-xl text-sm font-medium toast-enter ${colors[type] || colors.info}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.remove('toast-enter');
            el.classList.add('toast-exit');
            setTimeout(() => el.remove(), 250);
        }, 2800);
    }

    // ========== FORMAT ==========
    const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₸';

    // ========== DATA LAYER ==========
    async function loadProducts() {
        if (window.B2B.USE_DEMO) {
            state.products = window.B2B.DemoStore.get('products', []);
            return;
        }
        // Real Firestore
        try {
            const snap = await window.B2B.db.collection('products').get();
            state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.error(e);
            toast('Ошибка загрузки товаров', 'error');
        }
    }

    async function saveProduct(product) {
        if (window.B2B.USE_DEMO) {
            const list = window.B2B.DemoStore.get('products', []);
            if (product.id) {
                const idx = list.findIndex(p => p.id === product.id);
                if (idx >= 0) list[idx] = product;
                else list.push(product);
            } else {
                product.id = 'p' + Date.now();
                list.push(product);
            }
            window.B2B.DemoStore.set('products', list);
            state.products = list;
            return product;
        }
        // Real
        if (product.id) {
            await window.B2B.db.collection('products').doc(product.id).set(product, { merge: true });
        } else {
            const ref = await window.B2B.db.collection('products').add(product);
            product.id = ref.id;
        }
        return product;
    }

    async function loadInvoices() {
        if (window.B2B.USE_DEMO) {
            state.invoices = window.B2B.DemoStore.get('invoices', []);
            return;
        }
        try {
            const snap = await window.B2B.db.collection('invoices').orderBy('createdAt', 'desc').limit(50).get();
            state.invoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.error(e);
        }
    }

    async function saveInvoice(invoice) {
        if (window.B2B.USE_DEMO) {
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
        // Real Firestore + stock update would go here
        const ref = await window.B2B.db.collection('invoices').add({
            ...invoice,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        invoice.id = ref.id;
        return invoice;
    }

    // ========== AUTH ==========
    async function showApp(user, role = 'seller') {
        state.user = user;
        state.role = role;
        $('#authScreen').classList.add('hidden');
        $('#appScreen').classList.remove('hidden');
        $('#userInfo').classList.remove('hidden');
        
        const badge = $('#userRoleBadge');
        if (role === 'admin') {
            badge.textContent = 'Админ';
            badge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
            $('#tabAdmin').classList.remove('hidden');
        } else {
            badge.textContent = 'Продавец';
            badge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
            $('#tabAdmin').classList.add('hidden');
        }
        
        lucide.createIcons();
        await initAppData();
    }

    function logout() {
        state.user = null;
        state.cart = {};
        state.products = [];
        state.invoices = [];
        
        if (window.B2B.USE_DEMO) {
            window.B2B.DemoStore.set('user', null);
        } else if (window.B2B.auth) {
            window.B2B.auth.signOut().catch(console.error);
        }
        
        // Reset phone UI
        $('#phoneAuthContainer')?.classList.remove('hidden');
        $('#otpContainer')?.classList.add('hidden');
        $('#otpCode').value = '';
        $('#phoneNumber').value = '';
        
        $('#appScreen').classList.add('hidden');
        $('#authScreen').classList.remove('hidden');
        $('#userInfo').classList.add('hidden');
        updateCartUI();
        toast('Вы вышли из системы');
    }

    // Demo login (только при USE_DEMO = true)
    function demoLogin(asAdmin = false) {
        const user = { uid: 'demo', displayName: asAdmin ? 'Админ' : 'Продавец', email: 'demo@b2b.local' };
        window.B2B.DemoStore.set('user', { ...user, role: asAdmin ? 'admin' : 'seller' });
        showApp(user, asAdmin ? 'admin' : 'seller');
        toast(asAdmin ? 'Вход как Админ (демо)' : 'Вход выполнен (демо)', 'success');
    }

    /**
     * Обработка успешного входа (Google / Phone)
     */
    async function handleAuthSuccess(user) {
        try {
            const role = await window.B2B.resolveUserRole(user);
            await window.B2B.ensureUserProfile(user, role);
            await showApp(user, role);
            toast('Добро пожаловать!', 'success');
        } catch (e) {
            console.error(e);
            toast('Ошибка при входе: ' + e.message, 'error');
        }
    }

    /**
     * Инициализация invisible reCAPTCHA для Phone Auth
     */
    function setupRecaptcha() {
        if (window.B2B.USE_DEMO || !window.B2B.auth) return null;
        
        // Уже создан
        if (window.B2B.getRecaptchaVerifier()) {
            return window.B2B.getRecaptchaVerifier();
        }
        
        try {
            const verifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                size: 'invisible',
                callback: () => {
                    // reCAPTCHA solved
                },
                'expired-callback': () => {
                    toast('reCAPTCHA истекла, попробуйте снова', 'warn');
                    window.B2B.setRecaptchaVerifier(null);
                }
            });
            window.B2B.setRecaptchaVerifier(verifier);
            return verifier;
        } catch (e) {
            console.error('reCAPTCHA error:', e);
            toast('Ошибка reCAPTCHA: ' + e.message, 'error');
            return null;
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
            toast(`На складе только ${product.stock} шт.`, 'warn');
            return;
        } else {
            state.cart[productId] = next;
        }
        updateCartUI();
        renderInvoice();
        // Re-render product cards to update qty buttons
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
        $('#cartCount').textContent = count;
        $('#cartCount').classList.toggle('hidden', count === 0);
        const total = getCartTotal();
        $('#invoiceTotal').textContent = fmt(total);
        $('#submitInvoiceBtn').disabled = count === 0 || !$('#selectStore').value;
    }

    // ========== RENDER ==========
    function renderCatalog() {
        const list = $('#productList');
        const empty = $('#emptyCatalog');
        
        let items = [...state.products];
        
        // Search
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            items = items.filter(p => p.name.toLowerCase().includes(q));
        }
        
        // Sort
        switch (state.sortBy) {
            case 'price-asc': items.sort((a, b) => a.price - b.price); break;
            case 'price-desc': items.sort((a, b) => b.price - a.price); break;
            case 'stock': items.sort((a, b) => b.stock - a.stock); break;
            default: items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        }
        
        if (items.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        
        list.innerHTML = items.map(p => {
            const qty = state.cart[p.id] || 0;
            const img = p.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=1e293b&color=a5b4fc&size=128`;
            return `
            <div class="product-card bg-slate-800/70 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
                <div class="aspect-square bg-slate-900 relative overflow-hidden">
                    <img src="${img}" alt="${p.name}" class="w-full h-full object-cover" loading="lazy"
                         onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=1e293b&color=a5b4fc&size=128'">
                    ${p.stock < 20 ? '<span class="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 bg-red-500/90 rounded font-semibold">Мало</span>' : ''}
                </div>
                <div class="p-3 flex flex-col flex-1">
                    <h4 class="font-semibold text-sm leading-tight line-clamp-2 mb-1">${escapeHtml(p.name)}</h4>
                    <div class="text-indigo-400 font-bold text-sm mb-1">${fmt(p.price)}</div>
                    <div class="text-xs text-slate-500 mb-3">Остаток: ${p.stock} шт.</div>
                    <div class="mt-auto flex items-center justify-between gap-2">
                        ${qty > 0 ? `
                            <div class="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5">
                                <button class="qty-btn w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-700 text-lg" data-action="dec" data-id="${p.id}">−</button>
                                <span class="w-6 text-center text-sm font-semibold">${qty}</span>
                                <button class="qty-btn w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-700 text-lg" data-action="inc" data-id="${p.id}">+</button>
                            </div>
                        ` : `
                            <button class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-xl transition-all active:scale-95" data-action="add" data-id="${p.id}">
                                В накладную
                            </button>
                        `}
                    </div>
                </div>
            </div>`;
        }).join('');
        
        // Bind buttons
        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                if (action === 'add' || action === 'inc') addToCart(id, 1);
                if (action === 'dec') addToCart(id, -1);
            });
        });
        
        lucide.createIcons();
    }

    function renderInvoice() {
        const container = $('#invoiceItems');
        const empty = $('#emptyCart');
        const entries = Object.entries(state.cart);
        
        if (entries.length === 0) {
            container.innerHTML = '';
            empty.classList.remove('hidden');
            updateCartUI();
            return;
        }
        empty.classList.add('hidden');
        
        container.innerHTML = entries.map(([id, qty]) => {
            const p = state.products.find(x => x.id === id);
            if (!p) return '';
            return `
            <div class="flex items-center justify-between py-3 gap-3">
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(p.name)}</div>
                    <div class="text-xs text-slate-400">${fmt(p.price)} × ${qty}</div>
                </div>
                <div class="font-semibold text-indigo-300 whitespace-nowrap">${fmt(p.price * qty)}</div>
                <div class="flex items-center gap-1">
                    <button class="qty-btn w-7 h-7 flex items-center justify-center rounded-md bg-slate-900 hover:bg-slate-700" data-action="dec" data-id="${id}">−</button>
                    <span class="w-5 text-center text-sm">${qty}</span>
                    <button class="qty-btn w-7 h-7 flex items-center justify-center rounded-md bg-slate-900 hover:bg-slate-700" data-action="inc" data-id="${id}">+</button>
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

    function renderCarousel() {
        const featured = state.products.filter(p => p.featured).slice(0, 5);
        if (featured.length === 0) {
            featured.push(...state.products.slice(0, 3));
        }
        
        const container = $('#carouselContainer');
        const dots = $('#carouselDots');
        
        if (featured.length === 0) {
            container.innerHTML = `<div class="carousel-slide flex items-center justify-center text-slate-500">Нет новинок</div>`;
            dots.innerHTML = '';
            return;
        }
        
        container.innerHTML = featured.map((p, i) => {
            const img = p.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=312e81&color=c7d2fe&size=400`;
            return `
            <div class="carousel-slide" style="background-image:url('${img}')">
                <div class="relative z-10 text-center px-6">
                    <div class="text-xs uppercase tracking-widest text-indigo-300 mb-1">Хит продаж</div>
                    <h3 class="text-xl md:text-2xl font-bold mb-1">${escapeHtml(p.name)}</h3>
                    <div class="text-2xl font-bold text-amber-300">${fmt(p.price)}</div>
                </div>
            </div>`;
        }).join('');
        
        dots.innerHTML = featured.map((_, i) => 
            `<button class="w-2 h-2 rounded-full transition-all ${i === 0 ? 'bg-white w-4' : 'bg-white/40'}" data-idx="${i}"></button>`
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
        const slides = container.children.length;
        if (slides === 0) return;
        state.carouselIndex = (state.carouselIndex + slides) % slides;
        container.style.transform = `translateX(-${state.carouselIndex * 100}%)`;
        
        $$('#carouselDots button').forEach((btn, i) => {
            btn.className = `w-2 h-2 rounded-full transition-all ${i === state.carouselIndex ? 'bg-white w-4' : 'bg-white/40'}`;
        });
    }

    function renderAdminStats() {
        const revenue = state.invoices.reduce((s, inv) => s + (inv.total || 0), 0);
        $('#statRevenue').textContent = fmt(revenue);
        $('#statCount').textContent = state.invoices.length;
        $('#statProducts').textContent = state.products.length;
        
        const list = $('#invoicesHistoryList');
        if (state.invoices.length === 0) {
            list.innerHTML = `<p class="text-sm text-slate-500 text-center py-4">Накладных пока нет</p>`;
            return;
        }
        
        list.innerHTML = state.invoices.slice(0, 20).map(inv => {
            const date = inv.createdAt ? new Date(inv.createdAt).toLocaleString('ru-RU') : '—';
            return `
            <div class="p-3 bg-slate-900/60 rounded-xl border border-slate-700/50 text-sm">
                <div class="flex justify-between items-start gap-2">
                    <div>
                        <div class="font-medium">${escapeHtml(inv.store || 'Магазин')}</div>
                        <div class="text-xs text-slate-500">${date} • ${inv.items?.length || 0} поз.</div>
                    </div>
                    <div class="font-semibold text-emerald-400 whitespace-nowrap">${fmt(inv.total || 0)}</div>
                </div>
            </div>`;
        }).join('');
    }

    // ========== TABS ==========
    function switchTab(tabId) {
        $$('.tab-btn').forEach(btn => {
            btn.classList.remove('active', 'bg-indigo-600', 'text-white');
            btn.classList.add('bg-slate-800', 'text-slate-400');
        });
        $$('.tab-content').forEach(v => v.classList.add('hidden'));
        
        const btn = $(`#tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
        const view = $(`#view${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
        
        if (btn) {
            btn.classList.add('active', 'bg-indigo-600', 'text-white');
            btn.classList.remove('bg-slate-800', 'text-slate-400');
        }
        if (view) view.classList.remove('hidden');
        
        if (tabId === 'invoice') renderInvoice();
        if (tabId === 'admin') {
            loadInvoices().then(renderAdminStats);
        }
        lucide.createIcons();
    }

    // ========== HELPERS ==========
    function escapeHtml(str) {
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
        renderAdminStats();
        
        // Auto-rotate carousel
        setInterval(() => {
            if ($('#appScreen').classList.contains('hidden')) return;
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
        
        // ─── Google Sign-In ───
        $('#googleAuthBtn')?.addEventListener('click', async () => {
            if (window.B2B.USE_DEMO) {
                demoLogin(!!window.event?.shiftKey);
                return;
            }
            
            if (!window.B2B.auth) {
                toast('Firebase не инициализирован. Проверьте js/firebase.js', 'error');
                return;
            }
            
            const btn = $('#googleAuthBtn');
            btn.disabled = true;
            btn.classList.add('opacity-70');
            
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                const result = await window.B2B.auth.signInWithPopup(provider);
                await handleAuthSuccess(result.user);
            } catch (err) {
                console.error(err);
                if (err.code === 'auth/popup-closed-by-user') {
                    toast('Окно входа закрыто', 'warn');
                } else if (err.code === 'auth/unauthorized-domain') {
                    toast('Домен не авторизован в Firebase Console → Authentication → Settings', 'error');
                } else {
                    toast(err.message || 'Ошибка входа через Google', 'error');
                }
            } finally {
                btn.disabled = false;
                btn.classList.remove('opacity-70');
            }
        });
        
        // ─── Phone / SMS OTP ───
        $('#sendOtpBtn')?.addEventListener('click', async () => {
            let phone = $('#phoneNumber').value.trim().replace(/[\s\-()]/g, '');
            
            // Автодобавление +7 если номер начинается с 7 или 8
            if (/^[78]\d{10}$/.test(phone)) {
                phone = '+' + (phone.startsWith('8') ? '7' + phone.slice(1) : phone);
            }
            if (!phone.startsWith('+')) {
                phone = '+7' + phone.replace(/^0+/, '');
            }
            
            if (!/^\+[1-9]\d{10,14}$/.test(phone)) {
                toast('Введите номер в формате +77001234567', 'warn');
                return;
            }
            
            if (window.B2B.USE_DEMO) {
                $('#phoneAuthContainer').classList.add('hidden');
                $('#otpContainer').classList.remove('hidden');
                toast('Код отправлен (демо: 123456)', 'info');
                return;
            }
            
            if (!window.B2B.auth) {
                toast('Firebase не инициализирован', 'error');
                return;
            }
            
            const btn = $('#sendOtpBtn');
            btn.disabled = true;
            btn.textContent = 'Отправка...';
            
            try {
                const verifier = setupRecaptcha();
                if (!verifier) {
                    throw new Error('Не удалось создать reCAPTCHA');
                }
                
                const confirmation = await window.B2B.auth.signInWithPhoneNumber(phone, verifier);
                window.B2B.setConfirmationResult(confirmation);
                
                $('#phoneAuthContainer').classList.add('hidden');
                $('#otpContainer').classList.remove('hidden');
                toast('SMS с кодом отправлено', 'success');
            } catch (err) {
                console.error(err);
                // Сбросить reCAPTCHA при ошибке
                window.B2B.setRecaptchaVerifier(null);
                const container = $('#recaptcha-container');
                if (container) container.innerHTML = '';
                
                if (err.code === 'auth/invalid-phone-number') {
                    toast('Неверный формат номера телефона', 'error');
                } else if (err.code === 'auth/too-many-requests') {
                    toast('Слишком много попыток. Подождите', 'error');
                } else if (err.code === 'auth/quota-exceeded') {
                    toast('Квота SMS исчерпана. Проверьте Firebase Billing', 'error');
                } else {
                    toast(err.message || 'Ошибка отправки SMS', 'error');
                }
            } finally {
                btn.disabled = false;
                btn.textContent = 'Получить SMS код';
            }
        });
        
        $('#verifyOtpBtn')?.addEventListener('click', async () => {
            const code = $('#otpCode').value.trim();
            
            if (!code || code.length < 4) {
                toast('Введите код из SMS', 'warn');
                return;
            }
            
            if (window.B2B.USE_DEMO) {
                if (code === '123456') {
                    demoLogin(false);
                } else {
                    toast('Неверный код. Демо-код: 123456', 'error');
                }
                return;
            }
            
            const confirmation = window.B2B.getConfirmationResult();
            if (!confirmation) {
                toast('Сначала запросите SMS код', 'warn');
                return;
            }
            
            const btn = $('#verifyOtpBtn');
            btn.disabled = true;
            btn.textContent = 'Проверка...';
            
            try {
                const result = await confirmation.confirm(code);
                await handleAuthSuccess(result.user);
            } catch (err) {
                console.error(err);
                if (err.code === 'auth/invalid-verification-code') {
                    toast('Неверный код', 'error');
                } else if (err.code === 'auth/code-expired') {
                    toast('Код истёк. Запросите новый', 'error');
                    $('#otpContainer').classList.add('hidden');
                    $('#phoneAuthContainer').classList.remove('hidden');
                } else {
                    toast(err.message || 'Ошибка подтверждения', 'error');
                }
            } finally {
                btn.disabled = false;
                btn.textContent = 'Подтвердить';
            }
        });
        
        $('#backToPhoneBtn')?.addEventListener('click', () => {
            $('#otpContainer').classList.add('hidden');
            $('#phoneAuthContainer').classList.remove('hidden');
            $('#otpCode').value = '';
            window.B2B.setConfirmationResult(null);
        });
        
        // Search & sort
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
        
        // Submit invoice
        $('#submitInvoiceBtn')?.addEventListener('click', async () => {
            const store = $('#selectStore').value;
            if (!store) {
                toast('Выберите магазин', 'warn');
                return;
            }
            if (getCartCount() === 0) {
                toast('Корзина пуста', 'warn');
                return;
            }
            
            const items = Object.entries(state.cart).map(([productId, qty]) => {
                const p = state.products.find(x => x.id === productId);
                return {
                    productId,
                    name: p?.name,
                    price: p?.price,
                    qty
                };
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
                console.error(e);
                toast('Ошибка сохранения накладной', 'error');
            }
        });
        
        // Add product form
        $('#addProductForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = $('#prodName').value.trim();
            const price = +$('#prodPrice').value;
            const stock = +$('#prodStock').value;
            const fileInput = $('#prodImage');
            
            if (!name || price < 0 || stock < 0) {
                toast('Заполните все поля корректно', 'warn');
                return;
            }
            
            let image = null;
            if (fileInput.files?.[0]) {
                // In demo we just use object URL; in real app upload to Storage
                image = URL.createObjectURL(fileInput.files[0]);
            }
            
            const product = {
                name,
                price,
                stock,
                image,
                featured: false
            };
            
            try {
                await saveProduct(product);
                $('#addProductForm').reset();
                $('#fileLabel').textContent = 'Загрузить фото';
                $('#fileLabel').classList.remove('has-file');
                renderCatalog();
                renderCarousel();
                renderAdminStats();
                toast('Товар добавлен', 'success');
            } catch (err) {
                toast('Ошибка сохранения', 'error');
            }
        });
        
        $('#prodImage')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                $('#fileLabel').textContent = file.name.slice(0, 20) + (file.name.length > 20 ? '…' : '');
                $('#fileLabel').classList.add('has-file');
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
        lucide.createIcons();
        bindEvents();
        
        // Показать демо-подсказку только в демо-режиме
        if (window.B2B.USE_DEMO) {
            $('#demoNotice')?.classList.remove('hidden');
        }
        
        if (window.B2B.USE_DEMO) {
            // Восстановить демо-сессию
            const saved = window.B2B.DemoStore.get('user');
            if (saved) {
                showApp(saved, saved.role || 'seller');
            }
        } else if (window.B2B.auth) {
            // Реальный Firebase Auth state listener
            window.B2B.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    // Уже залогинен (refresh / предыдущая сессия)
                    if (!state.user || state.user.uid !== user.uid) {
                        const role = await window.B2B.resolveUserRole(user);
                        await window.B2B.ensureUserProfile(user, role);
                        await showApp(user, role);
                    }
                } else {
                    // Вышел
                    if (state.user) {
                        // already handled by logout()
                    }
                }
            });
        } else {
            console.warn('[B2B] Firebase Auth недоступен. Проверьте конфиг.');
        }
    });
})();
