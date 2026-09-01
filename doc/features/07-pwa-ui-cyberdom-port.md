# Фича 07: UI PWA — порт дизайн-системы Cyberdom mobile

**Статус:** spec-ready  
**Связано:** [06-customer-pwa.md](06-customer-pwa.md), [06-brand.md](../06-brand.md), `apps/pwa`  
**Источник референса:** `cyberdom.ecosystem/mobile` (Flutter), `cyberdom.ecosystem/identity/`

---

## Короткий ответ

| Вопрос | Ответ |
|--------|--------|
| Взять **дизайн** (токены, компоненты, паттерны навигации)? | **Да** |
| Скопировать **весь Flutter-фронтенд** как есть? | **Нет** — другой стек |
| «Натянуть» на `apps/pwa`? | **Да**, через React-компоненты и CSS, повторяя UX Cyberdom |

**Cyberdom mobile** — Flutter + Riverpod + go_router.  
**Автомойка PWA** — React + Vite + React Router + cloud-api.

Переносим **визуальный язык и поведение UI**, переписываем **экраны и интеграции** под домен автомойки.

---

## Что берём из Cyberdom, что оставляем своим

### Из Cyberdom mobile (референс)

| Слой | Путь в monorepo | Что взять |
|------|-----------------|-----------|
| Токены темы | `mobile/lib/core/theme/cyberdom_theme.dart` | Структура токенов, радиусы, высоты кнопок |
| Layout | `mobile/lib/core/widgets/cyberdom_scaffold.dart` | Оболочка экрана, safe-area, фон |
| Декор фона | `mobile/lib/core/widgets/cyberdom_frame_background.dart` | Паттерн/рамка (адаптировать под бренд АРТ) |
| Иконки | `mobile/assets/icons/*.svg`, `identity/icons/` | SVG-набор, pipeline копирования |
| Нижняя навигация | `mobile/lib/features/shell/expanding_bottom_nav.dart` | Expanding label у активного таба |
| Карточки списков | `event_list_tile.dart`, `resident_list_card.dart` | Паттерн карточки прайса / записи |
| Поля ввода / кнопки | overrides в `cyberdom_theme.dart` | min-height 52px, radius 14px |
| Онбординг | `onboarding_scaffold.dart` | Полноэкранный flow, отступы 24px |
| PWA web | `web/manifest.json`, `pwa_install_banner.dart` | Install banner, meta theme-color |

### Остаётся у «Автомойка у ЖД»

| Тема | Решение |
|------|---------|
| Бренд | «Гранат» + графит, **светлая** тема — [06-brand.md](../06-brand.md) |
| Шрифт | **Montserrat** (уже в спеке PWA), не TT Firs Neue |
| API | `cloud-api` customer endpoints — без изменений |
| Экраны | Прайс / Запись / Кабинет / онбординг — не посты/резиденты/мероприятия |
| Домен | `carwash-jd.ru` |

### Адаптация палитры (Cyberdom → АРТ)

Cyberdom — тёмная purple/lime. PWA АРТ — светлая «Гранат». **Не копируем hex Cyberdom**, переносим **роли токенов**:

| Роль в Cyberdom | Cyberdom (пример) | АРТ PWA (зафиксировано) |
|-----------------|-------------------|-------------------------|
| primary / CTA | `#9D00FF` | `#8E1D2C` |
| primary hover | `#7A00C7` | `#751824` |
| accent / secondary | `#C4F82A` | не используем lime; акцент = primary |
| background | `#0F0F12` | `#F2F2F3` (surface) |
| surface card | `#1C1C24` | `#FFFFFF` |
| text primary | `#F5F5F5` | `#303236` |
| text muted | `#A0A0B0` | `#5C6066` |
| border | `#2A2A35` | `#D4D6D9` |
| error | `#FF6B6B` | `#C43C3C` |
| splash / chrome | dark bg | `#303236` (графит) |

Сплэш и онбординг могут быть **тёмными** (как сейчас), контентные экраны — **светлыми** (как Cyberdom: тёмный shell + светлые карточки, но у нас инверсия: светлый фон + белые карточки).

---

## Архитектура `apps/pwa` после редизайна

```
apps/pwa/src/
  theme/
    tokens.css          # CSS variables (из 06-brand + spacing/radii Cyberdom)
    typography.css      # Montserrat scale (аналог TextTheme)
  components/
    layout/
      AppScaffold.tsx   # аналог CyberdomScaffold
      PageHeader.tsx
    nav/
      BottomNav.tsx     # аналог ExpandingBottomNav (3 таба)
    ui/
      Button.tsx
      Input.tsx
      Card.tsx
      Chip.tsx
      ListRow.tsx       # прайс-строка
      ClassTabs.tsx     # чипы классов авто
  pages/                # существующие, пересобрать на components/
  assets/
    icons/              # SVG из identity (отфильтрованные)
```

**Правило:** страницы не содержат «сырой» CSS — только компоненты + `theme/`.

---

## Маппинг экранов Cyberdom → PWA автомойки

| Cyberdom mobile | PWA «Автомойка у ЖД» | Компоненты для переиспользования |
|-----------------|----------------------|----------------------------------|
| `onboarding_welcome_screen` | `/welcome` | `OnboardingScaffold`, hero, bullet list |
| `login_screen` / `register_screen` | `/login`, `/register` | `Input`, `Button`, форма с ПДн |
| `MainShell` + bottom nav | `/app/*` | `AppScaffold` + `BottomNav` |
| `events` list + detail | **Прайс** `/app/price` | `ListRow`, `Card`, `ClassTabs` |
| `events` booking flow | **Запись** `/app/booking` (фаза C) | stepper, date chips, slot list |
| `profile_screen` | **Кабинет** `/app/cabinet` | avatar block, info rows, logout |
| `more_screen` | блок «О мойке» в прайсе | action buttons (звонок, маршрут) |
| `ExpandingBottomNav` | 3 таба: Прайс / Запись / Кабинет | expanding label на активном |

Экраны Cyberdom **не копируем**: посты, QR, каталог резидентов, business club, support — вне scope.

---

## Что **нельзя** перенести напрямую

| Cyberdom (Flutter) | В PWA (React) |
|--------------------|---------------|
| `Widget` tree | JSX + CSS modules / plain CSS |
| Riverpod providers | `auth.tsx` + React Query (опционально) для catalog |
| `go_router` redirects | React Router guards (уже есть) |
| `dio` + interceptors | `fetch` в `api.ts` |
| `cached_network_image` | `<img>` / lazy loading |
| `flutter_secure_storage` | `localStorage` (токен сессии) |
| `image_picker`, native plugins | Web File API (фаза B+) |
| Dart models | TypeScript types в `api.ts` |

---

## Фазы реализации UI

### UI-1 — Design tokens + базовые компоненты (1–2 дня)

- [x] `theme/tokens.css` — полный набор из [06-brand.md](../06-brand.md) + spacing/radii из Cyberdom
- [x] `Button`, `Input`, `Card`, `Chip`
- [x] Заменить inline-стили в `RegisterPage`, `LoginPage`
- [x] Критерий: формы выглядят «как продукт», не bootstrap

### UI-2 — Shell и навигация (1 день)

- [ ] `AppScaffold` + `BottomNav` с expanding label (референс: `expanding_bottom_nav.dart`)
- [ ] Активный таб: primary + подпись; неактивные: muted
- [ ] Safe-area, `nav-h: 64px`

### UI-3 — Прайс (1–2 дня)

- [ ] `ClassTabs` — горизонтальный скролл с иконками классов
- [ ] `ListRow` — название + цена, разделители как в `EventListTile`
- [ ] Карточка «О мойке» — CTA «Позвонить» / «Маршрут»
- [ ] Пустое состояние каталога

### UI-4 — Онбординг и сплэш (0.5–1 день)

- [ ] Сплэш: графит + лого «Автомойка у ЖД» (без frame Cyberdom или свой паттерн)
- [ ] Welcome: 3 тезиса в `Card`, крупная типографика
- [ ] Анимация появления 400ms `ease-in-out` (как Cyberdom)

### UI-5 — Кабинет и заглушки (0.5 дня)

- [ ] Профиль, logout, stub гаража в едином стиле
- [ ] `/owner` — минимальный dark/admin stub

### UI-6 — PWA polish (0.5 дня)

- [ ] Иконки `pwa-192/512` — бренд «у ЖД», не Cyberdom logo
- [ ] `navigateFallbackDenylist` для `/api/*` (уже в коде)
- [ ] iOS install hint (опционально, по образцу `PwaInstallBanner`)

### UI-7 — Деплой

- [ ] `pnpm deploy:vps` после UI-1+

Фазы B/C (гараж, запись) — те же компоненты, новые экраны.

---

## Ассеты и шрифты

### Шрифт

- **Montserrat** — оставляем (Google Fonts, кириллица, уже подключён).
- TT Firs Neue из Cyberdom **не переносим** (другой бренд + лицензия).

### Иконки

1. Источник: `cyberdom.ecosystem/identity/icons/` (полный набор).
2. Для PWA нужны: phone, map, calendar, user, car, chevron, close — **не** club-specific.
3. Скрипт копирования (будущий): `scripts/copy-pwa-icons.mjs` → `apps/pwa/src/assets/icons/`.
4. Компонент `Icon.tsx` — обёртка над SVG sprite или inline import.

### Фон / декор

- Cyberdom `frame_pattern.svg` — **не использовать** как есть (бренд клуба).
- Опционально: свой лёгкий паттерн (водяные капли / линии) в графите для сплэша.

---

## Референсные файлы (чеклист для разработчика)

```
# Cyberdom (читать, не импортировать)
cyberdom.ecosystem/mobile/lib/core/theme/cyberdom_theme.dart
cyberdom.ecosystem/mobile/lib/core/widgets/cyberdom_scaffold.dart
cyberdom.ecosystem/mobile/lib/features/shell/expanding_bottom_nav.dart
cyberdom.ecosystem/mobile/lib/features/shell/main_shell.dart
cyberdom.ecosystem/mobile/lib/features/onboarding/widgets/onboarding_scaffold.dart
cyberdom.ecosystem/mobile/lib/features/events/widgets/event_list_tile.dart
cyberdom.ecosystem/identity/

# Art PWA (менять)
apps/pwa/src/styles.css          → разбить на theme/
apps/pwa/src/components/AppShell.tsx
apps/pwa/src/pages/*.tsx
```

---

## Критерии готовности UI-1…UI-3

- [ ] На iPhone/Android PWA выглядит как нативное приложение, не «сайт-визитка»
- [ ] Единые отступы (16/24px), радиусы (14/16px), высота кнопок ≥ 52px
- [ ] Нижняя навигация с визуальным акцентом активного таба
- [ ] Прайс читаем: класс авто → вкладки → список с ценами
- [ ] Палитра соответствует [06-brand.md](../06-brand.md) (Гранат), не Cyberdom purple
- [ ] Lighthouse PWA + a11y: контраст кнопок, размер touch targets ≥ 44px

---

## Риски и ограничения

| Риск | Митигация |
|------|-----------|
| Смешение брендов Cyberdom и АРТ | Только паттерны + структура; цвета/лого — АРТ |
| Раздувание CSS | `theme/` + 8–10 компонентов, без UI-библиотеки на старте |
| Flutter ≠ React parity | Не гнаться за pixel-perfect; UX parity достаточно |
| Тёмный Cyberdom vs светлая спека | Тёмный только splash/onboarding; app — светлый |

---

## Следующий шаг в коде

После утверждения документа: **UI-1** — вынести `theme/tokens.css`, сделать `Button` + `Input`, перевести регистрацию/вход.

Статус фичи 06-customer-pwa в коде: **in progress** (фаза A частично); UI — эта ветка **07**.
