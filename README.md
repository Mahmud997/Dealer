# B2B Trade — Мини-1С

Лёгкая веб-система оптовой торговли (B2B) с каталогом, накладными и админ-панелью.

![License](https://img.shields.io/badge/license-MIT-blue)
![Stack](https://img.shields.io/badge/stack-HTML%20%7C%20Tailwind%20%7C%20Firebase-indigo)

## Возможности

- **Авторизация**
  - Google Sign-In
  - Вход по телефону (SMS OTP)
  - Демо-режим без Firebase
- **Каталог товаров**
  - Поиск и сортировка
  - Остатки на складе
  - Быстрое добавление в накладную
- **Накладные**
  - Выбор магазина-получателя
  - Корзина с изменением количества
  - Проведение накладной (списание со склада)
- **Панель администратора**
  - Добавление товаров (с фото)
  - Статистика оборота
  - История накладных
- **Витрина новинок** (карусель)

## Быстрый старт (демо)

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/YOUR_USERNAME/b2b-trade.git
   cd b2b-trade
   ```

2. Откройте `index.html` в браузере **или** поднимите локальный сервер:
   ```bash
   # Python
   python -m http.server 8080
   
   # Node
   npx serve .
   ```

3. Войдите:
   - Нажмите **«Войти через Google»** (демо)
   - Или введите любой номер телефона и код **`123456`**
   - Удерживайте **Shift** + клик по Google → вход как **Админ**

Данные хранятся в `localStorage` браузера.

## Подключение Firebase (продакшен)

**Полная пошаговая инструкция → [FIREBASE_SETUP.md](./FIREBASE_SETUP.md)**

Кратко:
1. Создайте проект на [console.firebase.google.com](https://console.firebase.google.com)
2. Включите Authentication → **Google** + **Phone**
3. Вставьте конфиг в `js/firebase.js` и поставьте `USE_DEMO = false`
4. Добавьте домен в Authorized domains
5. Создайте Firestore + Storage, настройте правила
6. Укажите email админов в массиве `ADMIN_EMAILS`

### Коллекции Firestore

```
users/{uid}       — профиль и роль (admin / seller)
products/{id}     — товары
invoices/{id}     — накладные
```

## Структура проекта

```
b2b-trade/
├── index.html            # Главная страница
├── css/styles.css        # Стили
├── js/
│   ├── firebase.js       # Конфиг Firebase + роли
│   └── app.js            # Логика приложения
├── FIREBASE_SETUP.md     # Инструкция по настройке Auth
├── LICENSE
├── .gitignore
└── README.md
```

## Технологии

- HTML5 + Tailwind CSS (CDN)
- Lucide Icons
- Firebase Auth / Firestore / Storage (опционально)
- Vanilla JS (без фреймворков)

## Роли

| Роль     | Возможности                          |
|----------|--------------------------------------|
| Продавец | Каталог, накладные                   |
| Админ    | + Панель управления, добавление товаров, отчёты |

В демо-режиме: **Shift + «Войти через Google»** = Админ.

## Roadmap (идеи)

- [ ] Экспорт накладной в PDF / Excel
- [ ] Мульти-склад
- [ ] Штрих-коды / сканер
- [ ] PWA (офлайн)
- [ ] Уведомления Telegram
- [ ] Права доступа по ролям через Custom Claims

## Лицензия

MIT © 2026

---

Сделано для GitHub. Форкните, дорабатывайте, используйте в своих B2B-проектах.
