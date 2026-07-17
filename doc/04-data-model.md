# Модель данных

Деньги — целые **копейки**. Время в БД — UTC, UI — Europe/Moscow.

## Таблицы (local SQLite)

### settings
- `key` TEXT PK
- `value` TEXT

Ключи: `master_code_hash`, `terminal_config`, `owner_sync_url`, `site_name`

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

### order_items
- `id` TEXT PK
- `order_id` TEXT
- `service_id` TEXT
- `name_snapshot` TEXT
- `price_kopecks` INTEGER
- `qty` INTEGER

### clients / loyalty_accounts
Задел под лояльность (телефон, госномер, баллы, персональная скидка).

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

См. [features/01-entry-camera-anpr.md](features/01-entry-camera-anpr.md).

## Cloud (PostgreSQL)

Зеркало заказов/позиций для отчётов + `owners` (password hash).
