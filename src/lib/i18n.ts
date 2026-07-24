import { cookies } from "next/headers";

export const supportedLocales = ["ru", "en"] as const;
export type Locale = (typeof supportedLocales)[number];
export const LOCALE_COOKIE = "taa_locale";

export async function getLocale(): Promise<Locale> {
  return (await cookies()).get(LOCALE_COOKIE)?.value === "en" ? "en" : "ru";
}

const statusRu: Record<string, string> = {
  new: "Новая",
  processing: "В обработке",
  needs_data_review: "Требует проверки данных",
  waiting_for_client: "Ожидает клиента",
  data_complete: "Данные готовы",
  generating_contract: "Формируется договор",
  contract_ready: "Договор готов",
  under_review: "На проверке",
  needs_revision: "Требует доработки",
  contract_revision_required: "Требует новой версии",
  approved: "Одобрено",
  awaiting_approval: "Ожидает утверждения",
  pending_customer_approval: "Ожидает утверждения заказчиком",
  rejected: "Отклонено",
  inactive: "Неактивен",
  archived: "В архиве",
  draft: "Черновик",
  sending: "Отправляется",
  sent: "Отправлен",
  contract_sent: "Договор отправлен",
  completed: "Завершено",
  processing_error: "Ошибка обработки",
  cancelled: "Отменено",
  delivered: "Доставлен",
  failed: "Ошибка",
  completed_with_errors: "Завершено с ошибками",
  running: "Выполняется",
  healthy: "Работает",
  degraded: "Ограниченно",
  unavailable: "Недоступно",
  unknown: "Не проверено",
  ready: "Готово",
};

const priorityRu: Record<string, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

const templateTypeRu: Record<string, string> = {
  services: "Оказание услуг",
  consulting: "Консультационные услуги",
  supply: "Поставка",
};

export function localizeStatus(value: string, locale: Locale) {
  return locale === "ru" ? (statusRu[value] ?? value) : value;
}

export function localizePriority(value: string, locale: Locale) {
  return locale === "ru" ? (priorityRu[value] ?? value) : value;
}

export function localizeTemplateType(value: string, locale: Locale) {
  return locale === "ru" ? (templateTypeRu[value] ?? value) : value;
}

export function formatDate(value: string | Date | null, locale: Locale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null, locale: Locale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatAmount(
  amount: number | null,
  currency: string | null,
  locale: Locale,
) {
  if (amount === null) return "—";
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    style: currency ? "currency" : "decimal",
    currency: currency ?? undefined,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function messages(locale: Locale) {
  const ru = locale === "ru";
  return {
    locale,
    appName: ru ? "Автоматизация договорной работы" : "Contract Workflow Automation",
    nav: {
      dashboard: ru ? "Обзор" : "Dashboard",
      applications: ru ? "Заявки" : "Applications",
      counterparties: ru ? "Контрагенты" : "Counterparties",
      templates: ru ? "Шаблоны" : "Templates",
      email: ru ? "Почта" : "Email",
      registry: ru ? "Реестр договоров" : "Contract registry",
      reports: ru ? "Отчёты" : "Reports",
      settings: ru ? "Состояние системы" : "System status",
      signOut: ru ? "Выйти" : "Sign out",
    },
    common: {
      apply: ru ? "Применить" : "Apply",
      reset: ru ? "Сбросить" : "Reset",
      all: ru ? "Все" : "All",
      never: ru ? "Никогда" : "Never",
      none: "—",
      previous: ru ? "Назад" : "Previous",
      next: ru ? "Вперёд" : "Next",
      save: ru ? "Сохранить" : "Save",
      create: ru ? "Создать" : "Create",
    },
    login: {
      title: ru ? "Вход во внутреннюю систему" : "Internal sign in",
      hint: ru
        ? "Используйте учётную запись, созданную администратором."
        : "Use an account provisioned by an administrator.",
      email: ru ? "Электронная почта" : "Email",
      password: ru ? "Пароль" : "Password",
      submit: ru ? "Войти" : "Sign in",
      noSignup: ru
        ? "Самостоятельная регистрация отключена. Обратитесь к администратору."
        : "Self-service registration is disabled. Contact an administrator.",
      inactive: ru
        ? "Учётная запись отключена. Обратитесь к администратору."
        : "This account is inactive. Contact an administrator.",
      failed: ru
        ? "Не удалось войти. Проверьте почту и пароль."
        : "Sign-in failed. Check your email and password.",
      config: ru
        ? "Supabase не настроен. Добавьте обязательные переменные окружения."
        : "Supabase is not configured. Add the required environment variables.",
    },
  };
}
