# Brew Dashboard — дизайн-система

**Статус:** нормативная спецификация для будущего внедрения

**Визуальное направление:** _Warm operational finance dashboard for coffee-shop owners_

**Тема:** только светлая
**Продуктовые языки:** English и Русский

## 1. Назначение и источник истины

Этот документ фиксирует единую визуальную и интерактивную систему Brew Dashboard. Он нужен как точная спецификация для последующей миграции интерфейса на общие токены, примитивы и композиционные рецепты без изменения бизнес-логики, информационной архитектуры, пользовательских сценариев или состава экранов.

При конфликте решений действует следующий порядок:

1. `PRD.md` — продуктовый смысл, метрики, сценарии, ограничения и доступность.
2. `TASKS.md` — этапы реализации и проверяемые критерии.
3. Фактические экраны, контракты, тесты и runtime-поведение — реализованные ограничения.
4. Этот документ — визуальная, responsive-, content- и interaction-спецификация.
5. Внешние референсы — источники паттернов, но не продуктовых функций.

`DESIGN.md` не разрешает добавлять функции, отсутствующие в PRD. В частности, система не предполагает export, настраиваемый dashboard, отдельные Location detail pages, order CRUD, persistent Alerts, прогнозирование или AI-рекомендации.

## 2. Продукт и аудитория

Brew Dashboard — закрытый адаптивный аналитический кабинет владельца небольшой сети из 1–5 кофеен. За несколько минут пользователь должен понять финансовое состояние сети, сравнить точки, увидеть драйверы продаж и прибыли, найти проблемы с остатками, попробовать ограниченные безопасные изменения и оставить обратную связь.

Основная аудитория — занятый владелец, а не профессиональный аналитик. Поэтому интерфейс должен:

- давать ответ до изучения деталей;
- показывать финансовые значения и период сравнения явно;
- использовать ресторанную терминологию без бухгалтерского перегруза;
- быть достаточно плотным для регулярного контроля, но понятным без обучения;
- одинаково надёжно работать на desktop и телефоне;
- сохранять смысл в RU и EN, включая длинные русские подписи.

## 3. Основные принципы

### 3.1. Сначала вывод, затем объяснение

На каждом аналитическом экране есть один главный визуальный акцент: основной trend, comparison chart или menu matrix. KPI дают быстрый итог; связанные breakdown и таблицы объясняют его ниже.

### 3.2. Финансовая точность важнее декора

Числа выровнены, форматированы по locale и сопровождаются единицами, периодом и сравнением. Нулевое значение, отсутствие данных, `N/A` и неполный период визуально и семантически различаются.

### 3.3. Тепло через материал, не через украшения

Кофейный характер создают молочный canvas, кремовые поверхности, тёмный тёплый текст и один терракотовый акцент. Иллюстративные кофейные паттерны, псевдофактуры, градиенты и декоративные цвета не нужны.

### 3.4. Плотность с ясной иерархией

Плотность достигается компактной типографикой, стабильной сеткой и аккуратными разделителями. Карточки не должны превращать каждую строку данных в отдельный визуальный контейнер.

### 3.5. Семантика не зависит от цвета

Рост и падение имеют стрелку и текст; статусы — label и при необходимости icon; comparison series — различимый штрих; ошибки — сообщение рядом с полем. Цвет всегда является усилителем, а не единственным носителем смысла.

### 3.6. Состояние — часть компонента

Loading, empty, error, success, disabled, stale и conflict состояния проектируются вместе с основным состоянием и сохраняют размер контейнера, контекст и введённые данные.

### 3.7. Один паттерн на одну задачу

Одинаковые фильтры, KPI, таблицы, пагинация, формы и dialogs выглядят и ведут себя одинаково во всех разделах. Локальные варианты допустимы только при отличающейся продуктовой семантике.

## 4. Визуальное направление и эмоциональный тон

Направление — профессиональный финансово-операционный инструмент с тёплой идентичностью небольшой кофейной сети.

- **Точный:** значения, периоды, сравнения и статусы не требуют догадок.
- **Спокойный:** нейтральные поверхности, тонкие границы, минимум теней.
- **Тёплый:** терракотовый accent и молочно-кремовая база вместо холодного корпоративного белого.
- **Практичный:** интерфейс поддерживает быстрый контроль сети и конкретные безопасные действия.
- **Доверительный:** никакой стилизации под игровую панель, биржевой терминал или шаблонный «AI dashboard».

На экране одновременно допускается один доминирующий data visualization и не более одного primary action в одной локальной области.

## 5. Источники и роль референсов

| Источник | Использовать | Не переносить |
| --- | --- | --- |
| [shadcn/ui Blocks](https://ui.shadcn.com/blocks) | application shell, sidebar/drawer, формы, dialogs, таблицы, доступные composable primitives | внешний вид блока целиком, лишние nav-уровни, функции вне PRD |
| [Tremor Blocks](https://blocks.tremor.so/blocks) | KPI composition, filter bar, chart framing/tooltips, table pagination, loading/empty layouts | зависимость от Tremor и механическое копирование его палитры |
| [Stripe Dashboard](https://docs.stripe.com/dashboard/basics) и [Payments analytics](https://docs.stripe.com/payments/analytics) | финансовая иерархия, period comparison, compact detail progression, advanced-filter clarity | Stripe branding, сложные account/reporting функции |
| [Toast Reporting](https://pos.toasttab.com/products/reporting) | ресторанные продажи, multi-location и почасовой операционный контекст | POS, real-time обещания и функции, которых нет в Demo MVP |
| [Lightspeed Location Summary](https://k-series-support.lightspeedhq.com/hc/en-us/articles/31159186978331-Understanding-the-Location-Summary) | location comparison, period filter, sortable breakdown и comparison delta | export, custom date/hour filters и report builder |
| [MarketMan](https://www.marketman.com/platform/restaurant-inventory-management-software) | inventory status, thresholds, receipts/write-offs, связь stock и operational attention | purchase orders, vendors, forecasting, invoices |
| [MarginEdge](https://www.marginedge.com/) | COGS, profitability/popularity и понятная menu engineering логика | invoice processing, accounting и AI-функции |
| [Plausible Dashboard](https://plausible.io/docs/guided-tour) | один главный график, простота Overview, ясное обозначение неполного периода | web-analytics терминология и сверхминимализм, скрывающий ресторанный контекст |

Актуальная документация Tailwind CSS v4, shadcn/ui и Recharts 3 подтверждает реализуемость токенов через CSS variables/`@theme`, responsive containers, custom tooltip/legend, Radix-based keyboard behavior и обязательные dialog titles.

### 5.1. Ограничение визуального аудита

Приложенный screenshot показывает Docker Desktop, а не Brew Dashboard. Локальный app preview требует настроенной `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, поэтому текущий аудит основан на React/Tailwind-коде, UI-тестах и PRD/TASKS. Неподтверждённые детали референсов не считаются требованиями.

## 6. Аудит существующих паттернов

### Сохранить

- тёплый `#F7F3EE` canvas, кремовый shell и тёмный stone/coffee текст;
- desktop sidebar шириной 256 px и mobile/tablet drawer;
- sticky header с глобальными location/period filters;
- content container до 1280 px;
- page title `30/36`, section title `20/28`, крупные KPI;
- card fallback для таблиц на узких экранах;
- comparison series с одинаковым hue и разным штрихом;
- `Intl`-форматирование по locale, ISO currency и timezone сети;
- видимый skip link, focus-visible, semantic dialogs, reduced-motion и WCAG AA E2E-проверки;
- сохранение введённых значений при ошибках и conflict flows.

### Стандартизировать

- все цвета и состояния как именованные tokens вместо локальных `stone/amber` значений;
- единые card padding, border, radius и shadow;
- одинаковые page header, filter bar, KPI grid и table/card breakpoint;
- единые Button, Form field, Badge, Alert, Dialog, Toast и Pagination variants;
- единый chart tooltip, legend, axes, grid и empty state;
- direction-aware positive/negative delta: рост COGS или alerts не должен выглядеть успехом;
- минимум 44×44 px для всех touch targets, включая compact actions.

### Заменить при будущем внедрении

- raw native controls и повторяющиеся dialog markup — на общие shadcn/Radix-based primitives;
- разрозненные hex/Tailwind colors — на semantic CSS variables;
- локальные `rounded-xl border bg-white p-* shadow-sm` — на Card recipes;
- разные mobile/table switch points (`md`, `xl`) — на единый responsive contract;
- browser-default Recharts tooltip/legend — на локализованные branded components;
- универсальное «положительный процент = зелёный» — на effect-aware metric semantics;
- spinner как полный loading state для аналитики — на skeleton, повторяющий конечную геометрию.

### Не использовать

- dark mode в Demo MVP;
- glassmorphism, glow, neon, сильные blur и тяжёлые gradients;
- decorative photography внутри аналитических экранов;
- более двух brand accents или случайный цвет на каждой карточке;
- donut/gauge для простого процента, если progress bar или число читается точнее;
- icon-only обозначение неизвестного действия без tooltip/accessible name;
- горизонтальный scroll страницы; локальный scroll внутри широкой data table допустим только на tablet;
- цвет как единственное различие series, status или delta;
- функции референсов, которых нет в PRD.

## 7. Design tokens

Имена ниже являются нормативными semantic tokens. При внедрении они должны быть доступны как CSS variables и связаны с Tailwind v4 theme values; компоненты не должны выбирать palette color напрямую.

### 7.1. Цвета

#### Canvas и surfaces

| Token | Значение | Назначение |
| --- | --- | --- |
| `--color-canvas` | `#F7F3EE` | фон приложения |
| `--color-surface` | `#FFFAF2` | sidebar, header, first-run panels |
| `--color-surface-raised` | `#FFFFFF` | cards, dialogs, popovers, tables |
| `--color-surface-subtle` | `#F3EEE8` | table header, grouped rows, secondary blocks |
| `--color-surface-inset` | `#ECE4DB` | progress track, selected neutral area |
| `--color-overlay` | `rgba(44, 33, 27, 0.40)` | modal/drawer overlay |

#### Text

| Token | Значение | Назначение |
| --- | --- | --- |
| `--color-text` | `#2C211B` | основной текст и финансовые значения |
| `--color-text-secondary` | `#5F534B` | descriptions, labels, table metadata |
| `--color-text-muted` | `#756961` | timestamps, secondary hints |
| `--color-text-disabled` | `#9B9189` | только disabled content |
| `--color-text-inverse` | `#FFFFFF` | текст на тёмном accent |

#### Borders

| Token | Значение | Назначение |
| --- | --- | --- |
| `--color-border-subtle` | `#EAE3DC` | внутренние разделители |
| `--color-border` | `#DDD4CB` | стандартная граница |
| `--color-border-strong` | `#B9ADA3` | control hover, emphasized boundary |

#### Brand accent — единственный основной акцент

| Token | Значение | Назначение |
| --- | --- | --- |
| `--color-accent` | `#9A3412` | primary action, active nav, primary chart |
| `--color-accent-hover` | `#7C2D12` | hover |
| `--color-accent-active` | `#6C2710` | pressed/active |
| `--color-accent-subtle` | `#FFF0E8` | selected nav, warm highlight |
| `--color-accent-border` | `#FDBA8C` | граница subtle accent |
| `--color-focus` | `#C2410C` | focus ring |

Дополнительный brand accent не вводится. Тёмно-коричневый — цвет текста, а не второй accent.

#### Semantic colors

| Семантика | Foreground | Background | Border |
| --- | --- | --- | --- |
| Success | `#166534` | `#ECFDF3` | `#86E0A3` |
| Warning | `#854D0E` | `#FFFBEB` | `#F5C451` |
| Danger | `#B42318` | `#FEF2F2` | `#FCA5A5` |
| Info | `#1E40AF` | `#EFF6FF` | `#93C5FD` |

Success означает подтверждённый хороший результат, warning — условие, требующее внимания, danger — destructive/critical/error, info — нейтральное системное сообщение. Brand accent не заменяет semantic colors.

#### Chart palette

| Token | Значение | Базовое назначение |
| --- | --- | --- |
| `--color-chart-1` | `#9A3412` | Revenue / основная серия |
| `--color-chart-2` | `#0F766E` | Gross Profit / вторая серия |
| `--color-chart-3` | `#4F46E5` | Orders / третья серия |
| `--color-chart-4` | `#A21CAF` | Average Check / четвёртая серия |
| `--color-chart-5` | `#0369A1` | дополнительная breakdown series |
| `--color-chart-neutral` | `#78716C` | reference/median/neutral series |
| `--color-chart-grid` | `#E7E0D9` | grid lines |

На одном chart одновременно используются максимум четыре chromatic series. Current и previous period одной метрики используют один hue: current `100%` opacity и solid `2.5 px`, previous `55%` opacity и dash `6 4`. Semantic status colors не назначаются категориям данных. Heatmap использует пять фиксированных шагов: `#F3EEE8`, `#FCE1D2`, `#F8B894`, `#D96B3B`, `#9A3412`.

### 7.2. Typography

| Token | Значение |
| --- | --- |
| `--font-sans` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` |
| `--font-weight-regular` | `400` |
| `--font-weight-medium` | `500` |
| `--font-weight-semibold` | `600` |
| `--font-weight-bold` | `700` — только редкий critical emphasis |

| Стиль | Size / line-height | Weight | Использование |
| --- | --- | --- | --- |
| `display` | `36 / 40 px` | 600 | first-run hero; не в плотной аналитике |
| `page-title` | `30 / 36 px` | 600 | h1 desktop/tablet |
| `page-title-mobile` | `26 / 32 px` | 600 | h1 mobile |
| `section-title` | `20 / 28 px` | 600 | h2 |
| `card-title` | `18 / 26 px` | 600 | h3, chart title |
| `body` | `16 / 24 px` | 400 | основной текст |
| `body-sm` | `14 / 20 px` | 400 | tables, metadata, controls |
| `label` | `14 / 20 px` | 500 | form/table labels |
| `caption` | `12 / 16 px` | 500 | chart axes, hints, badge |
| `kpi` | `28 / 34 px` mobile, `32 / 38 px` desktop | 600 | основное KPI value |

### 7.3. Spacing scale

Используется ограниченная 4 px-сетка с двумя точными исключениями для compact details.

| Token | px | Типичное применение |
| --- | ---: | --- |
| `space-0` | 0 | reset |
| `space-0.5` | 2 | icon optical adjustment |
| `space-1` | 4 | tight inline gap |
| `space-1.5` | 6 | icon-label gap |
| `space-2` | 8 | compact gap |
| `space-3` | 12 | control groups, compact padding |
| `space-4` | 16 | mobile card padding, grid gap |
| `space-5` | 20 | standard card padding |
| `space-6` | 24 | page section gap, tablet padding |
| `space-8` | 32 | desktop content padding, major separation |
| `space-10` | 40 | onboarding separation |
| `space-12` | 48 | first-run section separation |
| `space-16` | 64 | shell/header dimension |

Не добавлять промежуточные `10`, `14`, `18`, `22`, `28` px без documented component geometry.

### 7.4. Widths, breakpoints и fixed geometry

| Token | Значение |
| --- | --- |
| `--container-app` | `1280px` |
| `--container-reading` | `720px` |
| `--container-form` | `560px` |
| `--dialog-sm` | `480px` |
| `--dialog-md` | `544px` |
| `--drawer-width` | `min(320px, calc(100vw - 32px))` |
| `--sidebar-width` | `256px` |
| `--header-height` | `64px` |
| `--control-height` | `44px` |

Breakpoints:

- `xs: 480px` — второй KPI column, если label/value помещаются;
- `sm: 640px` — стандартный Tailwind small layout;
- `md: 768px` — tablet, dialog/table transitions;
- `lg: 1024px` — wider chart composition;
- `xl: 1280px` — desktop sidebar и full data tables;
- `2xl: 1536px` — только дополнительное внешнее пространство; app container не растёт.

Product ranges остаются нормативными: mobile `320–767`, tablet `768–1279`, desktop `1280+`.

### 7.5. Radii, borders и shadows

| Token | Значение | Использование |
| --- | --- | --- |
| `radius-sm` | `4px` | chart swatches, heatmap cells |
| `radius-md` | `8px` | controls, inner rows, badges |
| `radius-lg` | `12px` | cards, tables, alerts, dialogs |
| `radius-xl` | `16px` | first-run/tour panel только |
| `radius-full` | `9999px` | status badges, progress |
| `border-default` | `1px solid var(--color-border)` | стандарт |
| `border-strong` | `1px solid var(--color-border-strong)` | hover/emphasis |
| `focus-ring` | `2px solid var(--color-focus)`, offset `2px` | keyboard focus |
| `shadow-card` | `0 1px 2px rgba(44,33,27,.06)` | raised analytics card |
| `shadow-popover` | `0 8px 24px rgba(44,33,27,.12)` | select, tooltip, popover |
| `shadow-dialog` | `0 20px 48px rgba(44,33,27,.18)` | dialog/drawer/tour |

Не сочетать сильную shadow с заметной coloured border. Default cards могут обходиться без shadow, если граница достаточна.

### 7.6. Opacity, z-index и motion

| Token | Значение |
| --- | --- |
| `opacity-disabled` | `0.48` для decorative layer; текст использует disabled token |
| `opacity-comparison` | `0.55` |
| `opacity-overlay` | `0.40` |
| `z-base` | `0` |
| `z-sticky` | `20` |
| `z-popover` | `30` |
| `z-overlay` | `40` |
| `z-modal` | `50` |
| `z-tour` | `60` |
| `z-toast` | `70` |
| `z-skip-link` | `100` |
| `duration-instant` | `80ms` |
| `duration-fast` | `120ms` |
| `duration-standard` | `180ms` |
| `duration-overlay` | `240ms` |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` |

Анимируются только `color`, `background-color`, `border-color`, `opacity` и небольшие overlay transforms. Не анимировать финансовые значения, chart draw-in или layout reflow. При `prefers-reduced-motion: reduce` все необязательные переходы становятся `0.01ms`, spinner сохраняет доступный текстовый status.

## 8. Правила типографики и текста

### 8.1. Финансовые значения и цифры

- KPI, table numeric columns, percentages, quantities и timestamps используют `font-variant-numeric: tabular-nums`.
- В таблицах числа выравниваются по правому краю; labels и names — по левому.
- Currency symbol/code не отрывается от значения. Используется `Intl.NumberFormat` с ISO currency из profile.
- Текущий контракт показывает деньги с двумя знаками после десятичного разделителя во всех поддерживаемых валютах.
- Percent change показывает один знак после разделителя; `0.0%` не заменяется тире.
- Деление на ноль и невозможное comparison — `N/A`, а не `0%`.
- Не сокращать основное KPI до `1.2M`, если полное локализованное значение помещается. В charts axes допустимы локализованные compact labels при доступном полном tooltip.

### 8.2. RU/EN

- English — default и fallback; RU и EN dictionary keys должны оставаться паритетными.
- Пользовательские имена сети, точек и товаров не переводятся.
- Для русских строк резервируется примерно на 30% больше ширины, чем для English label.
- Не использовать uppercase для русских navigation labels и длинных section labels. Uppercase с tracking допустим только для короткого first-run eyebrow.
- Переносы строк происходят по словам; принудительный letter spacing в body/labels запрещён.
- Английские product identifiers, API routes и технический request ID не локализуются.

### 8.3. Длинный текст

- Page title и alert title переносятся, но не truncate.
- User-provided name в table cell: одна строка с ellipsis и полное значение в accessible tooltip/title; в mobile card допускаются две строки.
- Form label и validation error всегда переносятся полностью.
- Numeric values не переносятся; при недостатке ширины grid меняет число колонок.
- Feedback и descriptions ограничиваются readable container, а не растягиваются на всю ширину app.

### 8.4. Chart и table text

- Chart title: `18/26`, 600; contextual subtitle: `14/20`, secondary.
- Axis ticks: `12/16`, 400; legends: `12/16`, 500; tooltip label: `12/16`, 600; tooltip value: `14/20`, 600 tabular.
- Table header: `12/16`, 600, normal case; body: `14/20`; primary row label: 500/600.
- Не использовать all-caps headers и letter-spaced financial labels.

## 9. Layout system

### 9.1. Application shell

Desktop (`>=1280`): fixed left sidebar `256px`; sticky header/filter region; content occupies remaining width and centers inside `1280px` max container. Sidebar не collapses to icons: в продукте только шесть разделов, а labels важнее выигрыша ширины.

Mobile/tablet (`<1280`): sticky `64px` header с menu, current section и alerts. Navigation открывается left drawer. Drawer содержит brand, все разделы, Feedback и Logout; закрывается после navigation.

Main content padding: `16px` mobile, `24px` tablet, `32px` desktop. Vertical page rhythm: `24px` между основными блоками, `32px` перед новым смысловым разделом.

### 9.2. Header и sidebar

- Brand row: Coffee icon `20px`, product name `18/26` semibold.
- Nav item: min-height `44px`, radius `8px`, padding `12px`, label `14/20` medium.
- Active nav: accent text + accent-subtle background + `aria-current="page"`; не только left color stripe.
- Header показывает current section, alerts control и на analytics screens — global filters.
- Header blur допустим только как средство сохранения читаемости sticky surface: surface background не ниже `95%` opacity.

### 9.3. Page header

Порядок: `h1` → one-sentence description → optional `as of`/data freshness. Action, если он действительно page-level, располагается справа на desktop и отдельной строкой на mobile. Page header не оборачивается в card.

### 9.4. Filter bar

- Global filters: Location, Period. Inventory status и Locations sorting остаются локальными.
- Filter bar — одна raised surface, `12px` radius, `16px` padding, `12px` gap.
- Desktop/tablet: controls inline, labels над ними; mobile `320–479`: одна колонка и full width controls; `480–767`: две колонки при достаточной ширине.
- Filters обновляют URL и данные без отдельного Apply, поэтому изменение подтверждается loading/stale behavior, а не toast.
- Filter bar остаётся видимым в sticky header только если не закрывает более 40% высоты mobile viewport; на 320 px он прокручивается вместе с content под sticky top row.

### 9.5. KPI grid

- `320–479`: 1 column.
- `480–1279`: 2 columns.
- `>=1280`: 3 columns для шести KPI.
- Equal-height cards внутри ряда; минимум `136px`; gap `16px`.
- Порядок соответствует задаче пользователя: Revenue, Gross Profit, Orders, Average Check, Gross Margin, Active Alerts. COGS добавляется только на Sales, как требует PRD.
- Карточки не получают индивидуальный decorative color. Accent допустим как небольшая top rule или icon только у одного primary KPI, если не конкурирует с main chart.

### 9.6. Chart grid

- Главный chart занимает полную доступную ширину либо минимум две трети desktop row.
- Secondary chart/card может занимать оставшуюся треть; на `<1024` все charts идут одной колонкой.
- Высота main chart: `320px` desktop/tablet, `264px` mobile; menu matrix: `384px` desktop, card quadrants mobile.
- Chart container всегда `min-width: 0`; page-level horizontal scroll запрещён.

### 9.7. Tables и lists

- Desktop `>=1280`: полная таблица; sticky header только для длинного локально прокручиваемого списка.
- Tablet `768–1279`: таблица с column priority и локальным horizontal scroll, если без него теряется критичная связь; first column остаётся sticky только при достаточном contrast boundary.
- Mobile `<768`: semantic cards, а не squeezed table. Сохраняются primary name/status, 2–4 ключевых values и relevant action; остальные данные раскрываются структурированной grid внутри card, без отдельной detail page.
- Row height `48–56px`; header `40px`; table cell horizontal padding `12–16px`.
- Sorting control находится в header button с label, arrow и `aria-sort`; touch target `44px`.

## 10. Общий interaction contract

Все интерактивные компоненты выполняют эту таблицу, если ниже не указано более строгое правило.

| State | Обязательное поведение |
| --- | --- |
| Default | Ясная affordance, контраст AA, min touch target `44×44px` |
| Hover | Только для pointer-capable устройств; изменение background/border, без layout shift |
| Active | Более тёмный/плотный фон или `translateY(1px)` максимум; не уменьшать hit area |
| Focus-visible | `2px` focus ring, offset `2px`; никогда не скрывать outline без замены |
| Disabled | Нативный `disabled`/`aria-disabled`; нет pointer/keyboard activation; причина видна из контекста |
| Loading | `aria-busy`; повторный submit заблокирован; размер компонента стабилен; понятный pending label |
| Error | Не только red border: icon/text и связанное `aria-describedby`/`role=alert` |
| Success | Подтверждение рядом или toast; не оставлять permanent green state без смысла |
| Keyboard | Нативная семантика; Enter/Space активируют button/checkbox, Escape закрывает overlays, arrows следуют primitive contract |
| Touch | `touch-action: manipulation`; target `44×44px`; hover не является обязательным шагом |

## 11. Components

### 11.1. Button

Variants: `primary`, `secondary`, `ghost`, `destructive`; sizes используют высоту `44px`, icon button `44×44px`. Primary — accent background/inverse text; secondary — raised surface/border; ghost — transparent; destructive — danger foreground или danger fill только в подтверждающем dialog.

States: hover/active используют соответствующий более тёмный token; focus-visible — общий ring; disabled сохраняет readable label; loading показывает spinner `16px` и localized pending label, сохраняя ширину; error/success сообщаются вне Button. Enter/Space активируют. Icon-only Button требует accessible name и Tooltip для unfamiliar action.

### 11.2. Input

Высота `44px`, radius `8px`, surface-raised, border-default, horizontal padding `12px`, body-sm. Hover — border-strong; active/focus — focus ring и focus border; disabled — subtle surface + disabled text; loading — read-only/disabled с adjacent progress, не spinner внутри text field; error — danger border + message; success — optional success message, не обязательная зелёная рамка. Label всегда видим, placeholder не заменяет label. Enter submit только в ожидаемом form context; touch keyboard/input mode соответствует данным.

### 11.3. Select

Тот же trigger geometry, что Input. Open state считается active и показывает chevron orientation. Options живут в portal surface с shadow-popover; selected item имеет check + text. Arrow keys перемещают active option, Enter/Space выбирают, Escape закрывает, typeahead доступен. Error/success/loading следуют Form field; disabled option имеет семантический disabled. Native Select допустим до миграции, но итоговый shared primitive должен сохранять Radix keyboard behavior.

### 11.4. Textarea

Минимальная высота `112px` для comment и `96px` для shorter prompt, resize vertical, те же states, что Input. Character count размещается под полем справа и остаётся secondary; limit/error — danger text. `Cmd/Ctrl+Enter` не отправляет форму без явной подсказки.

### 11.5. Checkbox

Visual box `20×20px` внутри label hit area минимум `44px`; selected — accent fill + white check; indeterminate — white dash. Hover усиливает border; focus ring окружает control; disabled снижает emphasis всей label group; error сопровождается group message. Space toggles; label click/tap toggles. Loading блокирует fieldset, но не скрывает выбранное значение.

### 11.6. Card

Variants: `default`, `subtle`, `interactive`, `critical`. Default: raised surface, border, radius-lg, padding `16px` mobile/`20px` desktop, optional shadow-card. Interactive получает hover border/shadow и настоящий link/button target; не делать Card clickable через `div`. Loading сохраняет геометрию skeleton; empty/error/success рендерятся внутри card. Не использовать critical variant для обычного low-priority warning.

### 11.7. KPI card

Структура: label → value → comparison → optional context. Label body-sm medium/secondary; value KPI style/tabular; comparison caption с arrow, magnitude и «vs previous period». `N/A` содержит текстовое объяснение через accessible label. Loading — три skeleton lines; error — локальный message/retry только если KPI fetch независим; success color зависит от эффекта, а не математического знака. KPI card не является интерактивной без реального drill-down из PRD.

### 11.8. Badge

Variants: `neutral`, `accent`, `success`, `warning`, `danger`, `info`; height минимум `24px`, padding `6–10px`, radius-full, caption semibold. Badge всегда содержит слово/число, а для критичных различий — icon. Если Badge является filter/action, его внешний hit target `44px` и применяет общий interaction contract. Loading badge заменяется short skeleton, error не кодируется отдельным badge без сообщения.

### 11.9. Alert

Variants: info/success/warning/danger. Структура: semantic icon → title → description → optional action. Background/border/foreground берутся из одной semantic family. `role="alert"` только для появившейся срочной ошибки; статичные notices используют region/status по смыслу. Hover отсутствует без action; action — обычный Button/Link. Loading не отображается как Alert. Success notices исчезают только после достаточного времени чтения или пользовательского закрытия.

### 11.10. Tooltip

Только supplemental information; essential instruction остаётся видимой. Surface-raised, border, radius-md, shadow-popover, max-width `280px`, body-sm. Pointer hover и keyboard focus открывают после `400ms`; Escape закрывает; на touch tooltip не должен блокировать tap и заменяется доступным label/Popover при essential content. Loading не нужен; error/success tooltips не используются как единственная обратная связь.

### 11.11. Tabs

Используются только для sibling views внутри существующего экрана, не как скрытая новая IA. Active tab: accent text + bottom indicator или accent-subtle filled variant. Hover/focus не сдвигают layout. Disabled сохраняет label. Loading относится к tab panel с `aria-busy`, active tab остаётся видимым. Arrow Left/Right меняют focus для horizontal tabs; Home/End поддерживаются primitive; touch target `44px`, narrow set может scroll локально с видимым overflow cue.

### 11.12. Table

Header semantic `<th>`, row label `<th scope="row">` где применимо, numeric columns right-aligned/tabular. Hover выделяет строку surface-subtle только если помогает сканированию; active/focus применяются к реальному row action, а не `<tr>`. Sort buttons выполняют общий contract и обновляют `aria-sort`. Loading — skeleton rows той же высоты; empty — один spanning cell/Empty state; error — Error state над сохранёнными rows, если показывается cached snapshot; success mutation подсвечивает изменённую row subtle accent не более 2 секунд и дублируется toast. Mobile representation — cards с тем же reading order.

### 11.13. Pagination

Состав: localized count/context, current page, Previous/Next; First/Last только desktop и при достаточном числе страниц. Icon controls `44px`, имеют sr-only names. Unavailable direction disabled. Loading блокирует повторный переход, сохраняет текущие rows и показывает progress возле controls. Error сохраняет текущую page и даёт Retry. Keyboard order следует визуальному порядку; touch gap минимум `8px`.

### 11.14. Dialog

Для focused confirmations/forms. Width `480` или `544px`, max `calc(100vw - 32px)`, max-height `calc(100dvh - 32px)`, внутренний scroll. Всегда есть semantic Title; Description — когда контекст не очевиден. Overlay, initial focus, focus trap, return focus и Escape предоставляет Radix primitive. Loading блокирует dismiss только когда прерывание создаёт риск двойной mutation; иначе close остаётся доступен. Error сохраняет input. Success закрывает dialog после подтверждённого response и показывает toast. На mobile destructive actions остаются внизу и не меняют порядок.

### 11.15. Drawer

Для navigation на mobile/tablet; выходит слева, width drawer token, overlay semantic. Title обязателен, close `44px`, focus trap и return focus. Swipe-to-dismiss не является единственным способом закрытия. Loading nav item не нужен; auth/logout pending показывается на action. Error logout остаётся внутри drawer/shell. Escape закрывает. Drawer не заменяет аналитический filter bar.

### 11.16. Toast

Variants neutral/success/error; width до `384px`, bottom-right desktop, bottom-center mobile над safe area. Содержит краткий результат и optional action. Не использовать toast для validation. Default duration `5s`, error `8s` или manual close, critical/conflict сохраняется в form/dialog дополнительно. Hover/focus pause timeout; keyboard focus доступен без перехвата текущего focus. Loading toast допускается только для долгой фоновой операции; обычный submit использует pending Button.

### 11.17. Skeleton

Повторяет конечную структуру page title, KPI, chart и rows; neutral inset color, без gradient. Pulse duration `1.5s`; reduced motion — static. Skeleton `aria-hidden`; container имеет один localized `role="status"`. Не заменять локальный refresh skeleton всего экрана: сохранять stale data и показывать subtle progress.

### 11.18. Empty state

Структура: neutral icon `24px`, конкретный title, причина/контекст, optional valid action. Default padding `32px`, dashed border только для действительно пустой коллекции. Не говорить «No data» без указания выбранного периода/filter, если это объясняет пустоту. Empty state не является error и не использует danger.

### 11.19. Error state

Danger surface, icon, localized message, optional request ID вторичным mono text и Retry. Page error сохраняет page header; widget error остаётся внутри widget. Cached data остаются на экране с warning «показаны данные на…». Conflict message объясняет reload/overwrite choice и сохраняет input. Retry target `44px`; focus переводится на error summary после failed submit только если inline errors недостаточно заметны.

### 11.20. Chart container

Figure с Title/Description, optional legend и chart area. Border/card geometry общая. ResponsiveContainer получает явную высоту; chart component не задаёт конкурирующие fixed width/height. Loading — chart-shaped skeleton; empty/error — соответствующее состояние в той же высоте; success refresh не анимирует весь chart. Keyboard-accessible summary и data table доступны вне SVG.

### 11.21. Chart tooltip

Surface-raised, border, radius-md, shadow-popover, padding `12px`; label/date сверху, series rows с swatch + name + right-aligned formatted value. Current и previous явно подписаны, не различаются только dash/color. `filterNull` включён: отсутствующее значение не превращается в zero. Tooltip cursor тонкий neutral. Pointer и keyboard data focus должны давать одинаковую информацию; на touch первый tap показывает tooltip, второй не требуется для основной навигации.

### 11.22. Form field

Порядок: Label → optional hint → control → validation/error → optional character count. Required обозначается текстом/символом с sr-only explanation; control связан через `id`, `htmlFor`, `aria-describedby`, `aria-invalid`. Fieldset группирует related radio/checkbox controls. Submit loading блокирует повтор; server error не очищает values; success подтверждает mutation; focus переводится на первое invalid field после submit. Gap внутри field `6px`, между fields `20px`.

## 12. Data visualization

### 12.1. Выбор chart type

- Line/area — динамика во времени. Area fill допускается только для одной primary series с opacity `8%`; multi-series charts используют lines без заливки.
- Grouped bar — сравнение точек или категорий, когда важны абсолютные различия.
- Horizontal bar list — компактный top/bottom breakdown.
- Heatmap — weekday/hour intensity; всегда с numeric accessible label и legend scale.
- Scatter/quadrant — menu engineering matrix; mobile заменяется четырьмя group cards.
- Progress bar — monthly goal completion; bar не обрезает value >100%, label показывает фактический процент.
- Pie/donut не использовать в Demo MVP: доли точнее читаются как bar/list/table.

### 12.2. Series и comparison

- Primary series `2.5px`, secondary `2px`; dots скрыты по умолчанию и появляются как active dot `4px`.
- Previous period использует тот же hue, opacity `55%`, dash `6 4` и текст «Previous period».
- Легенда идёт над/below chart в reading order и может переноситься; interactive hiding series не добавляется без продуктовой необходимости.
- Не более четырёх chromatic series; при большем числе использовать sorted bar/table или small multiples.

### 12.3. Deltas

Arrow показывает арифметическое направление. Semantic color показывает эффект:

- Revenue, Gross Profit, Orders, Average Check, Gross Margin: рост success, падение danger.
- COGS: рост warning/danger, падение success, если revenue context не делает вывод неоднозначным.
- Active Alerts и stock issues: рост danger, падение success.
- Inventory balance сам по себе нейтрален; статус определяется threshold.
- Неоднозначный показатель остаётся neutral с arrow и числом.

Всегда показывать magnitude и comparison context. При previous = 0 отображать `N/A`, не бесконечность.

### 12.4. Zero, missing и incomplete period

- `0` — реальное измеренное нулевое значение.
- `N/A` — значение математически не определено.
- `—` — поле неприменимо или отсутствует как сущность; не использовать для measurable zero.
- Empty state — dataset не содержит rows для filters.
- Null point разрывает line; не интерполировать без продуктового правила.
- Неполный текущий period обозначается dotted terminal segment и текстом «Current period in progress»/локализованным аналогом. Tooltip помечает incomplete bucket.
- Stale demo data получает warning + explicit Reset action; данные не заменяются автоматически.

### 12.5. Axes, grid, tooltip и legend

- Только major horizontal grid lines, chart-grid `1px`; vertical grid обычно скрыт.
- Не вращать labels на mobile: уменьшать tick count или менять bucket granularity.
- Y-axis начинается с zero для bars. Для lines non-zero domain допустим только с явно видимой axis и без преувеличения малых различий.
- Currency/number compact axis и полный localized tooltip.
- Legend swatch отражает line style, включая comparison dash.
- Цвет не является единственным носителем смысла: label, stroke pattern, icon/shape и accessible table обязательны по контексту.

## 13. Семантические рецепты экранов

### 13.1. Overview

Порядок: page header → stale warning при необходимости → 6 KPI → один главный Revenue/Gross Profit trend → goal + location comparison → top/bottom products → stock summary + active alerts.

Desktop: KPI `3×2`; trend full width; secondary widgets `2 columns`. Mobile: KPI 1 column до `480`, затем 2; trend `264px`; все widgets одной колонкой, alerts выше low-priority product lists. Global filters следуют общему responsive contract.

### 13.2. Locations

Порядок: page header → local sort controls → сравнение точек → sortable table/cards. Best/weak обозначаются icon + words + badge; для одной точки performance label отсутствует.

Desktop: comparison chart или ranked summary над full table. Tablet: priority columns `Location`, `Revenue`, `Gross Profit`, `Alerts`; остальные локально scroll. Mobile: one card/location, name/status сверху, six metrics `2 columns`, sort controls full width.

### 13.3. Sales

Порядок: page header → 6 KPI включая COGS → primary daily/comparison trend → heatmap + peak hours → breakdowns → recent orders pagination. Экран read-only: не показывать action menu, edit affordance или clickable rows без destination.

Desktop: KPI `3×2`; trend `2fr` + peak `1fr`; breakdown `3 columns`; table. Tablet: trend и heatmap full width; breakdown `2+1`. Mobile: KPI 1–2 columns; heatmap в локальном scroll container с sticky weekdays; orders cards; pagination сохраняет контекст.

### 13.4. Products

Порядок: page header → menu engineering matrix как главный акцент → category sections → products table/cards → price dialog по action.

Desktop: matrix `384px` и 4 summary groups; category tables. Tablet: matrix сохраняется при `>=768`, tables с priority columns. Mobile: matrix заменяется Stars/Workhorses/Puzzles/Dogs cards с count, products и rule-based recommendation; product card показывает price/cost/margin, sales values, balances и Edit price.

Groups не получают semantic success/danger meaning: названия, quadrant position и distinct chart markers несут смысл. Dogs не оформляется как system error.

### 13.5. Inventory

Порядок: page header → local status filter → balance table/cards → recent movements. Status и actions Receipt/Write off находятся рядом с текущим balance.

Desktop: full table; actions в последней колонке. Tablet/mobile: cards с item, location, unit, on hand, threshold, explicit status; Receipt и Write off wrap без overlap. Movement list показывает type icon/text, signed quantity, location и timestamp. Write off dialog отображает current/remaining balance и danger только при превышении.

### 13.6. Settings

Порядок: network read-only card → preferences (language, monthly goal) → tour/feedback → demo reset → account/logout. Destructive Reset отделён от обычных settings пространством и danger-neutral treatment; primary danger fill появляется только в confirmation dialog.

Desktop: readable column до `720px` либо two-column grid только для независимых cards. Mobile: одна колонка, full-width controls/actions, длинные RU descriptions без truncation.

### 13.7. Onboarding и login

Centered form container до `560px`, canvas background, cream panel radius `16px`, один clear primary action. Порядок first run не меняется: Login → Language → Onboarding → generation → Overview → optional tour.

Mobile: panel может терять border/shadow у края, padding `20px`; формы одна колонка. Tablet/desktop: padding `32px`; country/currency могут быть `2 columns`. Progress сохраняет введённые значения. Language cards — radio controls, не generic clickable div.

### 13.8. Guided tour

Три шага из PRD. Highlight использует focus-colored outline `3px` + offset `4px`, а не glow. Tour panel закреплён снизу, max-width `448px`, не перекрывает target по возможности; на mobile может перемещаться вверх. Есть step count, Skip, Back, Next/Finish. Focus trapped в panel, target описан текстом, а не доступен через фон.

### 13.9. Dialogs и forms

Price, goal, Receipt, Write off, Feedback и Reset используют общий Form field/Dialog contract. Primary action справа desktop и full-width last on mobile; Cancel перед ним в DOM/visual order. Conflict показывает две явные опции только там, где backend поддерживает их: refresh latest и overwrite/retry. Никакие ошибки не очищают input.

## 14. Accessibility

- Цель — WCAG 2.2 AA для contrast, keyboard, focus, names, roles и states; текущие E2E axe checks сохраняются и расширяются при миграции.
- Normal text contrast минимум `4.5:1`, large text `3:1`, component boundaries/focus `3:1` к соседнему цвету.
- Все interactive targets минимум `44×44px`, включая icon buttons, pagination и sort controls.
- Focus-visible всегда заметен и не скрывается sticky header; skip link остаётся первым keyboard target.
- DOM reading order совпадает с visual order. Responsive layout не переставляет смысловые блоки только через CSS `order`.
- Dialog/Drawer/Popover используют semantic primitives, Title, focus trap, Escape и return focus.
- Async status: `aria-live="polite"`; critical submit error: `role="alert"`; не создавать несколько конкурирующих live regions.
- Form errors связаны с controls, summary ведёт к первому invalid field, entered values сохраняются.
- Charts имеют concise text summary и доступную tabular representation; tooltip не является единственным способом получить точное значение.
- Table header/scope/`aria-sort` корректны; mobile cards сохраняют названия метрик рядом со значениями.
- Icon-only controls имеют accessible names; decorative icons `aria-hidden="true"`.
- Status не передаётся только цветом; arrows, patterns, labels и icons используются совместно.
- `prefers-reduced-motion` отключает pulse, chart draw, smooth scroll и transforms, не скрывая progress text.
- Touch не зависит от hover, поддерживает zoom и не использует horizontal gestures как единственный control.
- Locale switch не сбрасывает focus без причины и обновляет accessible names вместе с visible labels.

## 15. Content design

### 15.1. Форматы

| Данные | Правило | Пример EN | Пример RU |
| --- | --- | --- | --- |
| Money | `Intl.NumberFormat`, profile ISO currency, 2 decimals | `KZT 1,250,000.00` или locale output | `1 250 000,00 ₸` или locale output |
| Number | locale grouping, без лишних decimals | `1,248` | `1 248` |
| Percent | 1 decimal | `12.4%` | `12,4 %` |
| Quantity | до 3 decimals по unit; `pcs` только integer | `12.5 kg` | `12,5 кг` |
| Date | locale medium date, timezone сети | `Aug 28, 2026` | `28 авг. 2026 г.` |
| Time | timezone сети, locale convention | `2:30 PM` | `14:30` |
| Missing math | literal localized `N/A` | `N/A` | `Н/Д` при принятом словаре |

Формат задаётся `Intl`, поэтому примеры иллюстративны: не собирать currency/date строки вручную. Server timestamps остаются UTC; отображение использует IANA timezone сети. У каждого time-sensitive view должен быть понятен `as of`.

### 15.2. Названия метрик

Использовать стабильные названия из PRD: Revenue, COGS, Gross Profit, Gross Margin, Orders, Average Check, Goal Completion, Active Alerts. Не менять Gross Profit на Earnings или Revenue на Sales в соседних экранах. Tooltip/description объясняет формулу там, где это нужно; названия остаются короткими.

### 15.3. UI-тексты

- Button — глагол + объект: `Save goal`, `Edit price`, `Record receipt`; не `Submit`.
- Success — завершённое действие: `Price updated.`
- Error — что произошло + следующий шаг: `Couldn’t update the price. Check the value and try again.`
- Empty — контекст: `No orders for this location and period.`
- Loading — объект: `Loading sales…`, а не только `Please wait`.
- Disabled причина — в hint или рядом, не в tooltip-only.
- Warning не драматизирует синтетические demo data.
- RU использует короткие естественные фразы, не кальку с English; punctuation и non-breaking units форматирует локализатор.

## 16. Do / Don’t

| Do | Don’t |
| --- | --- |
| `Revenue 1 250 000,00 ₸` + `↑ 12,4% к прошлому периоду` | зелёное `+12%` без объяснения периода |
| Для COGS `↑ 8,0%` помечать warning, если рост нежелателен | считать любой рост success |
| Current solid и Previous dashed с прямыми labels | две почти одинаковые линии, различимые только оттенком |
| `N/A — previous period was zero` | `∞%`, пустая строка или `0%` |
| На mobile превратить product row в структурированную card | уменьшить desktop table до нечитаемых 10 px |
| `Out of stock` + icon + danger treatment | только красная точка без текста |
| Один accent для primary action и основной series | отдельный яркий цвет на каждой KPI card |
| Localized error рядом с field, input сохранён | очистить form и показать только transient toast |
| Один главный chart на Overview | сетка из множества равнозначных mini charts |
| `Reset demo data` в отдельной danger zone и confirm dialog | яркая destructive кнопка рядом с обычными preferences |
| Skeleton повторяет KPI/chart geometry | full-page spinner при каждом filter change |
| Warm neutral surfaces и тонкая border | glass panels, glow, сильные gradients, coffee-photo background |
| Menu groups через quadrant/label/recommendation | трактовать Dogs как system error красным alert |

## 17. Карта будущего внедрения

Внедрение выполняется отдельной подтверждённой задачей. Рекомендуемая последовательность:

1. **Tokens:** перенести color, type, spacing, radius, shadow, motion, breakpoint и z-index values в CSS variables/Tailwind v4 theme; добавить automated contrast checks.
2. **UI primitives:** Button, form controls, Form field, Checkbox, Card, Badge, Alert, Tooltip, Tabs, Dialog, Drawer, Toast, Skeleton и states.
3. **Shared analytics:** PageHeader, FilterBar, KpiCard, MetricDelta, ChartContainer, ChartTooltip, ChartLegend, DataTable, MobileDataCard и Pagination.
4. **Shell:** sidebar, header, alerts, navigation drawer и responsive content geometry.
5. **Low-risk pages:** first-run/login и Settings для проверки forms, dialogs, RU/EN и mobile behavior.
6. **Overview + Locations:** закрепить KPI, filters, charts, comparison и location table/card recipes.
7. **Sales + Products:** trend, heatmap, pagination, menu matrix и price dialog.
8. **Inventory:** status system, balance table/cards, movements и receipt/write-off dialogs.
9. **State pass:** loading, cached, empty, error, conflict, success, disabled, stale и reduced-motion на всех routes.
10. **Validation:** screenshots desktop/mobile, keyboard journeys, axe/WCAG AA, 320 px no-overflow, RU long labels, chart accessible tables и existing E2E acceptance.

Каждый шаг должен менять owner layer и shared primitives прежде, чем page-level consumers. Миграция не должна менять routes, API contracts, metrics, product events или permissions.

## 18. Open decisions

1. **Brand asset:** отдельный официальный logo/wordmark Brew Dashboard не предоставлен. До решения используется существующая пара Coffee icon + локализованное имя продукта без создания нового знака.

Других открытых визуальных решений нет: палитра, типографика, spacing, component states, responsive behavior и screen recipes зафиксированы выше.
