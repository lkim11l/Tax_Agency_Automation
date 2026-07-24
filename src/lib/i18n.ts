import { cookies } from "next/headers";

export const supportedLocales = ["ru", "en"] as const;
export type Locale = (typeof supportedLocales)[number];
export const LOCALE_COOKIE = "taa_locale";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return value === "en" ? "en" : "ru";
}

const statusRu: Record<string, string> = {
  new: "Новая",
  processing: "Обработка",
  needs_data_review: "Нужна проверка данных",
  waiting_for_client: "Ожидает клиента",
  data_complete: "Данные готовы",
  generating_contract: "Формирование договора",
  contract_ready: "Договор готов",
  under_review: "На проверке",
  contract_revision_required: "Требуется новая версия",
  approved: "Одобрено",
  sending: "Отправка",
  contract_sent: "Договор отправлен",
  completed: "Завершено",
  processing_error: "Ошибка обработки",
  cancelled: "Отменено",
  delivered: "Доставлено",
  failed: "Ошибка",
  completed_with_errors: "Завершено с ошибками",
  running: "Выполняется",
  healthy: "Работает",
  degraded: "Ограниченно",
  unavailable: "Недоступно",
  unknown: "Не проверено",
};

export function localizeStatus(value: string, locale: Locale) {
  return locale === "ru" ? (statusRu[value] ?? value) : value;
}

export function messages(locale: Locale) {
  const ru = locale === "ru";
  return {
    locale,
    appName: "Tax Agency Automation",
    nav: {
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
