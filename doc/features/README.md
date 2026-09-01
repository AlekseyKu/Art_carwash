# Фичи

Каталог продуктовых фич сверх базового MVP. Каждая фича — отдельный файл с целью, UX, API и статусом.

| Файл | Фича | Статус |
|------|------|--------|
| [01-entry-camera-anpr.md](01-entry-camera-anpr.md) | Камера на въезде + распознавание госномера → клиент на кассе | backlog (ждём камеру) |
| [02-windows-exe-packaging.md](02-windows-exe-packaging.md) | Сборка в .exe / kiosk для сенсорного Windows мини-ПК | test-ready |
| [03-backlog-ideas.md](03-backlog-ideas.md) | Бэклог идей: мойка / админ / касса (+ кофе, акции, подсказки) | backlog |
| [04-vehicle-classes-service-prices.md](04-vehicle-classes-service-prices.md) | Классификация авто + цены услуг по классу | implemented |
| [05-operators-staff-order-ux.md](05-operators-staff-order-ux.md) | Операторы/мойщики, коэффициент, UX заказа, аналитика, OSK | implemented |
| [06-customer-pwa.md](06-customer-pwa.md) | Клиентское PWA «Автомойка у ЖД»: онбординг, прайс, запись, кабинет, Docker на VPS | spec-ready |
| [06-privacy-policy.md](06-privacy-policy.md) | Политика ПДн для PWA (версия `2026-08-30`) | draft |
| [07-pwa-ui-cyberdom-port.md](07-pwa-ui-cyberdom-port.md) | UI PWA: порт дизайн-системы Cyberdom mobile → React | spec-ready |

## Как добавлять

1. Создать `doc/features/NN-slug.md`.
2. Добавить строку в таблицу выше.
3. Реализовать в коде; в файле фичи обновить статус и ссылки на модули.
