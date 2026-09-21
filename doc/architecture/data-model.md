# Модель данных

Деньги — целые **копейки**. Время в БД — UTC, UI — Europe/Moscow.

## Таблицы (local SQLite)

### settings
- `key` TEXT PK
- `value` TEXT

Ключи (фрагмент): `master_code_hash`, `terminal_config`, `site_name` (касса), `pwa_site_name` (PWA, по умолчанию «Автомойка у ЖД»), `cloud_sync_url`, `cloud_sync_token`, настройки записи (`booking_*`).

### washers
- `id` TEXT PK (UUID)
- `name` TEXT
- `pin_hash` TEXT
- `active` INTEGER
- `created_at` TEXT

### catalog_tabs
Вкладки кассы (Услуги, Товары, …). Админ может добавлять новые.
- `id` TEXT PK
- `slug` TEXT UNIQUE (`services`, `products`, …)
- `name` TEXT
- `sort_order` INTEGER
- `active` INTEGER

### services
Позиции каталога (и услуги мойки, и товары) — привязаны к вкладке.
- `id` TEXT PK
- `name` TEXT
- `price_kopecks` INTEGER
- `active` INTEGER
- `sort_order` INTEGER
- `tab_id` TEXT → `catalog_tabs.id`

### discounts
- `id` TEXT PK
- `name` TEXT
- `type` TEXT (`percent` | `fixed`)
- `value` INTEGER (проценты или копейки)
- `active` INTEGER

### posts
- `id` INTEGER PK (1, 2)
- `name` TEXT

### orders
- `id` TEXT PK (UUID)
- `number` INTEGER (суточный)
- `post_id` INTEGER
- `washer_id` TEXT
- `client_id` TEXT NULL
- `discount_id` TEXT NULL
- `status` TEXT
- `payment_method` TEXT NULL (`cash` | `card` | `sbp`)
- `subtotal_kopecks` INTEGER
- `discount_kopecks` INTEGER
- `total_kopecks` INTEGER
- `created_at` TEXT
- `paid_at` TEXT NULL
- `updated_at` TEXT
- `shift_id` TEXT NULL → `shifts.id`

### shifts
Кассовая смена (открытие/закрытие на POS).
- `id` TEXT PK
- `status` TEXT (`open` | `closed`)
- `opened_at` TEXT
- `closed_at` TEXT NULL
- `opened_by_washer_id` TEXT NULL
- `closed_by_washer_id` TEXT NULL
- `note` TEXT NULL

### order_items
- `id` TEXT PK
- `order_id` TEXT
- `service_id` TEXT NULL (NULL = ручная позиция)
- `name_snapshot` TEXT
- `price_kopecks` INTEGER — итог строки после коэффициента и % скидки
- `qty` INTEGER
- `is_manual` INTEGER DEFAULT 0
- `base_price_kopecks` INTEGER — база для clamp коэффициента
- `coefficient_extra_kopecks` INTEGER DEFAULT 0
- `discount_percent` INTEGER DEFAULT 0 — скидка на строку 0…100 (Услуги/Доп.);  
  `price = round((base + extra) × (100 − pct) / 100)`

### clients
- `id` TEXT PK
- `name` TEXT NULL
- `phone` TEXT NULL
- `plate_number` TEXT NULL — **default**-госномер (совместимость / ANPR shortcut)
- `notes` TEXT NULL
- `created_at` / `updated_at` TEXT

Поиск: телефон / имя / **любой** plate из `client_vehicles`.

### client_vehicles
Гараж на кассе (зеркало cloud `vehicles` через `customer.upsert`).
- `id` TEXT PK
- `client_id` TEXT → `clients.id`
- `plate_number` TEXT (нормализованный)
- `class_id` TEXT NULL
- `nickname` TEXT NULL
- `is_default` INTEGER — ровно одно `1` на клиента; пишется в `clients.plate_number`
- UNIQUE (`client_id`, `plate_number`)

Миграция: старый одиночный `clients.plate_number` → одна строка `client_vehicles` с `is_default=1`.

### tariffs / tariff_prices / client_tariffs
Именованные спец.цены (класс × услуга/доп.), период, M:N с клиентами. См. [../pos/tariffs.md](../pos/tariffs.md).

### loyalty_accounts
Задел под лояльность (баллы, tier, `personal_discount_percent`). UI лояльности — этап 5.

### site_schedule (settings key)
JSON режима работы по дням недели (MSK): `closed` / `open` / `close`.  
В snapshot каталога: `site.schedule` + человекочитаемый `hoursText`.  
Слоты записи (шаг 30 мин) используют дневное окно. См. [../pwa/customer-app.md](../pwa/customer-app.md).

### bookings (local зеркало)
Записи PWA/кассы; календарь дня, arrive → черновик заказа. Детали в [../pwa/customer-app.md](../pwa/customer-app.md).

### outbox
- `id` TEXT PK
- `type` TEXT
- `payload` TEXT (JSON)
- `created_at` TEXT
- `synced_at` TEXT NULL

### plate_events (фича ANPR)
- `id` TEXT PK
- `plate_raw` TEXT
- `plate_normalized` TEXT
- `confidence` REAL
- `snapshot_url` TEXT
- `source` TEXT
- `created_at` TEXT

См. [../pos/anpr.md](../pos/anpr.md).

## Cloud (SQLite на VPS)

Каталог (`catalog_snapshot`), клиенты/записи PWA, зеркало заказов для отчётов, `owners` (password hash).
