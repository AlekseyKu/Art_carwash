# Дорожная карта

Единственный общий план. Идеи без спеки — в [backlog.md](backlog.md).

## Этап 1 — MVP на мойке · shipped

Локальный API, касса, админ, оплата наличными, эмуляторы карты/СБП, offline SQLite, 2 поста.

## Этап 2 — Sync и отчёты · shipped

Outbox → cloud-api, отчёты `/reports`, пароль собственника.

## Этап 3 — Терминал + СБП · in-progress

Адаптеры под модель терминала и провайдера СБП. Пока эмуляторы + HTTP / sdk_bridge. См. [../architecture/payments.md](../architecture/payments.md).

## Этап 4 — Клиентское PWA «Автомойка у ЖД» · shipped (полировка)

Онбординг, прайс, кабинет/гараж, запись, календарь на кассе, CRM/клиенты, Docker на VPS (`carwash-jd.ru`). Оплата на мойке.

Спека: [../pwa/customer-app.md](../pwa/customer-app.md) · ПДн: [../pwa/privacy.md](../pwa/privacy.md) · UI: [../pwa/ui-system.md](../pwa/ui-system.md).

Текущая полировка: контент «О мойке», UX записи/кабинета, видимость услуг в PWA.

## Этап 5 — Лояльность UI · backlog

Поиск по телефону/госномеру, начисление/списание, персональные скидки. В PWA — фаза D customer-app.

## Этап 6 — бэклог продукта

Смены (частично есть), премии мойщиков, смешанная оплата, возвраты, расходники, 2 линии записи, роли. Из PWA-бэклога: предоплата, Telegram, push, абонементы — см. [backlog.md](backlog.md) и хвост [../pwa/customer-app.md](../pwa/customer-app.md).
