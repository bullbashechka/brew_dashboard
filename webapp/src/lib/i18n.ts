import type { ApiErrorCode, Profile } from "@brew-dashboard/contracts";

export type AppLocale = "en" | "ru";

const en = {
  appName: "Brew Dashboard",
  public: {
    signIn: "Sign in",
    firstRun: "First run",
    skipToContent: "Skip to content",
  },
  auth: {
    alias: "Login alias",
    password: "Password",
    submit: "Sign in",
    pending: "Signing in…",
    invalidCredentials: "Invalid login or password.",
  },
  language: {
    title: "Choose your language",
    description: "You can change this later in Settings.",
    english: "English",
    russian: "Русский",
    submit: "Continue",
    pending: "Saving language…",
  },
  onboarding: {
    title: "Set up your coffee network",
    description: "Add the essentials and we will generate your first dashboard.",
    networkName: "Network name",
    ownerName: "Owner name",
    locationCount: "Number of locations",
    locationName: "Location {number} name",
    country: "Country code",
    currency: "Currency",
    timeZone: "Timezone",
    countryHint: "Two-letter ISO code, for example KZ.",
    validation: {
      required: "This field is required.",
      nameMin: "Use at least 2 characters.",
      nameMax: "Use no more than 80 characters.",
      nameCharacters: "Remove unsupported control characters.",
      duplicateLocation: "Location names must be unique.",
      countryCode: "Enter a valid two-letter ISO country code.",
      currencyCode: "Enter a valid three-letter ISO currency code.",
      timeZone: "Enter a valid IANA timezone.",
      generic: "Please check this value.",
    },
    submit: "Create my dashboard",
    pending: "Generating your dashboard…",
  },
  tour: {
    title: "A quick tour",
    progress: "Step {current} of {total}",
    back: "Back",
    next: "Next",
    skip: "Skip tour",
    finish: "Finish tour",
    overviewTitle: "See the signal first",
    overviewDescription: "Overview puts your key metrics and global filters in one place.",
    locationsTitle: "Compare the places that matter",
    locationsDescription: "Use Locations and Products to spot where your network is strongest.",
    inventoryTitle: "Stay ahead of stock issues",
    inventoryDescription: "Inventory alerts and Feedback are always close when you need them.",
    restart: "Start tour",
    restartDescription: "Revisit the three-step guided tour at any time.",
    restartPending: "Starting tour…",
  },
  navigation: {
    overview: "Overview",
    locations: "Locations",
    sales: "Sales",
    products: "Products",
    inventory: "Inventory",
    settings: "Settings",
  },
  actions: {
    retry: "Try again",
    cancel: "Cancel",
    logout: "Log out",
    feedback: "Feedback",
    close: "Close",
    openNavigation: "Open navigation",
  },
  filters: {
    location: "Location",
    allLocations: "All locations",
    period: "Period",
    today: "Today",
    sevenDays: "7 days",
    thirtyDays: "30 days",
    sixMonths: "6 months",
  },
  alerts: {
    label: "Active alerts",
    none: "No active alerts",
    showing: "Showing {shown} of {total}",
    lowStock: "Low stock",
    outOfStock: "Out of stock",
    salesDrop: "Sales drop",
  },
  metrics: {
    revenue: "Revenue",
    grossProfit: "Gross profit",
    orders: "Orders",
    averageCheck: "Average check",
    grossMargin: "Gross margin",
    activeAlerts: "Active alerts",
  },
  comparison: {
    versusPrevious: "vs previous period",
    notAvailable: "N/A",
    increase: "Increase of {value}",
    decrease: "Decrease of {value}",
    unchanged: "No change",
  },
  overview: {
    title: "Overview",
    description: "The clearest view of your performance for the selected period.",
    trend: "Revenue and gross profit trend",
    currentPeriod: "Current period",
    previousPeriod: "Previous period",
    monthlyGoal: "Monthly revenue goal",
    networkWide: "Network-wide",
    goalNotSet: "Goal not set",
    locationComparison: "Location comparison",
    topProducts: "Top products",
    bottomProducts: "Products to watch",
    stockSummary: "Stock summary",
    inStock: "In stock",
    lowStock: "Low stock",
    outOfStock: "Out of stock",
    recentAlerts: "Recent active alerts",
    updatedAt: "Data as of {value}",
  },
  locations: {
    title: "Locations",
    description: "See how every location performs in the selected period.",
    sortBy: "Sort by",
    direction: "Direction",
    ascending: "Ascending",
    descending: "Descending",
    best: "Best performing location",
    weak: "Needs attention",
    standard: "Standard performance",
    locationName: "Location",
  },
  reset: {
    staleTitle: "Today’s demo data is out of date",
    staleDescription: "Reset to refresh Today and Yesterday with a new deterministic demo set.",
    open: "Reset demo data",
    title: "Reset demo data?",
    description: "This replaces the generated business data for your network.",
    resetItems:
      "Will reset: products, orders, inventory balances, movements, and the monthly goal.",
    keepItems: "Will keep: your account, network, locations, language, tour state, and feedback.",
    confirm: "Reset demo data",
    pending: "Resetting demo data…",
    complete: "Demo data has been reset.",
  },
  states: {
    loading: "Loading…",
    unavailable: "This section is temporarily unavailable.",
    empty: "Nothing to show yet.",
    foundation: "This workspace is ready for its product screen.",
    feedbackLater: "Feedback collection will be available here soon.",
    signIn: "Sign in is available with your issued credentials.",
    language: "Choose your language to continue.",
    onboarding: "Finish setting up your coffee network to continue.",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    unauthenticated: "Your session has ended. Please sign in again.",
    forbidden: "You do not have access to this action.",
    validation: "Please check the highlighted values.",
    conflict: "This information changed. Please refresh and try again.",
    rateLimited: "Too many requests. Please wait and try again.",
    notFound: "The requested item was not found.",
    requestId: "Support ID: {requestId}",
    submit: "We could not save your changes. Please try again.",
  },
  routes: {
    notFound: "Page not found",
    notFoundDescription: "The page you requested does not exist.",
    returnHome: "Return to Brew Dashboard",
  },
};

const ru: typeof en = {
  appName: "Brew Dashboard",
  public: {
    signIn: "Вход",
    firstRun: "Первый запуск",
    skipToContent: "Перейти к содержимому",
  },
  auth: {
    alias: "Логин",
    password: "Пароль",
    submit: "Войти",
    pending: "Выполняется вход…",
    invalidCredentials: "Неверный логин или пароль.",
  },
  language: {
    title: "Выберите язык",
    description: "Позднее язык можно изменить в Настройках.",
    english: "English",
    russian: "Русский",
    submit: "Продолжить",
    pending: "Сохраняем язык…",
  },
  onboarding: {
    title: "Настройте сеть кофеен",
    description: "Добавьте основные данные — мы подготовим первый dashboard.",
    networkName: "Название сети",
    ownerName: "Имя владельца",
    locationCount: "Количество точек",
    locationName: "Название точки {number}",
    country: "Код страны",
    currency: "Валюта",
    timeZone: "Часовой пояс",
    countryHint: "Двухбуквенный ISO-код, например KZ.",
    validation: {
      required: "Заполните это поле.",
      nameMin: "Введите не меньше 2 символов.",
      nameMax: "Введите не больше 80 символов.",
      nameCharacters: "Удалите неподдерживаемые управляющие символы.",
      duplicateLocation: "Названия точек должны быть уникальными.",
      countryCode: "Введите корректный двухбуквенный ISO-код страны.",
      currencyCode: "Введите корректный трёхбуквенный ISO-код валюты.",
      timeZone: "Введите корректный часовой пояс IANA.",
      generic: "Проверьте это значение.",
    },
    submit: "Создать dashboard",
    pending: "Готовим dashboard…",
  },
  tour: {
    title: "Короткий тур",
    progress: "Шаг {current} из {total}",
    back: "Назад",
    next: "Далее",
    skip: "Пропустить тур",
    finish: "Завершить тур",
    overviewTitle: "Сначала — главное",
    overviewDescription: "В Overview собраны ключевые показатели и глобальные фильтры.",
    locationsTitle: "Сравнивайте важные точки",
    locationsDescription: "Locations и Products помогают увидеть, где сеть работает лучше всего.",
    inventoryTitle: "Предотвращайте проблемы с остатками",
    inventoryDescription: "Inventory alerts и Feedback всегда рядом, когда они нужны.",
    restart: "Запустить тур",
    restartDescription: "В любой момент можно повторить трёхшаговый guided tour.",
    restartPending: "Запускаем тур…",
  },
  navigation: {
    overview: "Обзор",
    locations: "Точки",
    sales: "Продажи",
    products: "Товары",
    inventory: "Остатки",
    settings: "Настройки",
  },
  actions: {
    retry: "Повторить",
    cancel: "Отмена",
    logout: "Выйти",
    feedback: "Обратная связь",
    close: "Закрыть",
    openNavigation: "Открыть навигацию",
  },
  filters: {
    location: "Точка",
    allLocations: "Все точки",
    period: "Период",
    today: "Сегодня",
    sevenDays: "7 дней",
    thirtyDays: "30 дней",
    sixMonths: "6 месяцев",
  },
  alerts: {
    label: "Активные предупреждения",
    none: "Активных предупреждений нет",
    showing: "Показано {shown} из {total}",
    lowStock: "Низкий остаток",
    outOfStock: "Нет в наличии",
    salesDrop: "Падение продаж",
  },
  metrics: {
    revenue: "Выручка",
    grossProfit: "Валовая прибыль",
    orders: "Заказы",
    averageCheck: "Средний чек",
    grossMargin: "Валовая маржа",
    activeAlerts: "Активные предупреждения",
  },
  comparison: {
    versusPrevious: "к предыдущему периоду",
    notAvailable: "Н/Д",
    increase: "Рост на {value}",
    decrease: "Снижение на {value}",
    unchanged: "Без изменений",
  },
  overview: {
    title: "Обзор",
    description: "Главные показатели за выбранный период.",
    trend: "Динамика выручки и валовой прибыли",
    currentPeriod: "Текущий период",
    previousPeriod: "Предыдущий период",
    monthlyGoal: "Месячная цель по выручке",
    networkWide: "По всей сети",
    goalNotSet: "Цель не задана",
    locationComparison: "Сравнение точек",
    topProducts: "Лидеры продаж",
    bottomProducts: "Товары для внимания",
    stockSummary: "Состояние остатков",
    inStock: "В наличии",
    lowStock: "Низкий остаток",
    outOfStock: "Нет в наличии",
    recentAlerts: "Последние активные предупреждения",
    updatedAt: "Данные на {value}",
  },
  locations: {
    title: "Точки",
    description: "Смотрите результаты каждой точки за выбранный период.",
    sortBy: "Сортировка",
    direction: "Направление",
    ascending: "По возрастанию",
    descending: "По убыванию",
    best: "Лучшая точка",
    weak: "Требует внимания",
    standard: "Обычный результат",
    locationName: "Точка",
  },
  reset: {
    staleTitle: "Демо-данные за сегодня устарели",
    staleDescription:
      "Выполните Reset, чтобы обновить данные Today и Yesterday новым детерминированным набором.",
    open: "Сбросить демо-данные",
    title: "Сбросить демо-данные?",
    description: "Будут заменены сгенерированные бизнес-данные сети.",
    resetItems: "Будут сброшены: товары, заказы, остатки, движения и месячная цель.",
    keepItems: "Сохранятся: аккаунт, сеть, точки, язык, состояние тура и обратная связь.",
    confirm: "Сбросить демо-данные",
    pending: "Сбрасываем демо-данные…",
    complete: "Демо-данные сброшены.",
  },
  states: {
    loading: "Загрузка…",
    unavailable: "Этот раздел временно недоступен.",
    empty: "Пока нечего показать.",
    foundation: "Основа экрана готова для продуктового раздела.",
    feedbackLater: "Сбор обратной связи появится здесь позже.",
    signIn: "Войдите с выданными вам учётными данными.",
    language: "Выберите язык, чтобы продолжить.",
    onboarding: "Завершите настройку сети кофеен, чтобы продолжить.",
  },
  errors: {
    generic: "Что-то пошло не так. Попробуйте ещё раз.",
    unauthenticated: "Сессия завершилась. Войдите снова.",
    forbidden: "У вас нет доступа к этому действию.",
    validation: "Проверьте выделенные значения.",
    conflict: "Данные изменились. Обновите страницу и повторите попытку.",
    rateLimited: "Слишком много запросов. Подождите и повторите попытку.",
    notFound: "Запрошенный объект не найден.",
    requestId: "Идентификатор для поддержки: {requestId}",
    submit: "Не удалось сохранить изменения. Попробуйте ещё раз.",
  },
  routes: {
    notFound: "Страница не найдена",
    notFoundDescription: "Запрошенной страницы не существует.",
    returnHome: "Вернуться в Brew Dashboard",
  },
};

export const dictionaries = { en, ru } as const;

type LeafTranslationKey<T, Prefix extends string = ""> = {
  [Key in keyof T & string]: T[Key] extends string
    ? `${Prefix}${Key}`
    : T[Key] extends Record<string, unknown>
      ? LeafTranslationKey<T[Key], `${Prefix}${Key}.`>
      : never;
}[keyof T & string];

export type TranslationKey = LeafTranslationKey<typeof en>;

type TranslationValue = string | Record<string, unknown>;

const lookup = (dictionary: Record<string, unknown>, path: TranslationKey) =>
  path.split(".").reduce<TranslationValue | undefined>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, TranslationValue>)[segment];
  }, dictionary);

export function assertDictionaryParity(reference: unknown, candidate: unknown, path = "") {
  if (typeof reference === "string") {
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw new Error(`Missing translation key: ${path}`);
    }
    return;
  }
  if (!reference || typeof reference !== "object" || !candidate || typeof candidate !== "object") {
    throw new Error(`Invalid translation dictionary: ${path || "root"}`);
  }
  for (const [key, value] of Object.entries(reference)) {
    assertDictionaryParity(
      value,
      (candidate as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    );
  }
}

assertDictionaryParity(en, ru);

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  values: Record<string, string | number> = {},
) {
  const value = lookup(dictionaries[locale], key) ?? lookup(en, key);
  if (typeof value !== "string") return key;
  return value.replace(/\{(\w+)\}/gu, (_, name: string) => String(values[name] ?? ""));
}

export const localeFromProfile = (profile?: Profile | null): AppLocale =>
  profile?.effectiveLanguage === "ru" ? "ru" : "en";

const localeTag = (locale: AppLocale) => (locale === "ru" ? "ru-RU" : "en-US");

export const formatCurrency = (value: string | number, profile?: Profile | null) =>
  new Intl.NumberFormat(localeTag(localeFromProfile(profile)), {
    style: "currency",
    currency: profile?.currency ?? "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));

export const formatNumber = (value: string | number, profile?: Profile | null) =>
  new Intl.NumberFormat(localeTag(localeFromProfile(profile))).format(Number(value));

export const formatPercent = (value: string | number | null, profile?: Profile | null) =>
  value === null
    ? translate(localeFromProfile(profile), "comparison.notAvailable")
    : new Intl.NumberFormat(localeTag(localeFromProfile(profile)), {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(Number(value) / 100);

export const formatDate = (value: string | Date, profile?: Profile | null) =>
  new Intl.DateTimeFormat(localeTag(localeFromProfile(profile)), {
    dateStyle: "medium",
    timeZone: profile?.timeZone ?? "UTC",
  }).format(new Date(value));

export const errorTranslationKey = (code?: ApiErrorCode): TranslationKey => {
  const mapping: Record<ApiErrorCode, TranslationKey> = {
    VALIDATION_ERROR: "errors.validation",
    UNAUTHENTICATED: "errors.unauthenticated",
    FORBIDDEN: "errors.forbidden",
    NOT_FOUND: "errors.notFound",
    CONFLICT: "errors.conflict",
    RATE_LIMITED: "errors.rateLimited",
    INTERNAL_ERROR: "errors.generic",
  };
  return code ? mapping[code] : "errors.generic";
};
