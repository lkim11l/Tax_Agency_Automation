const DEFAULT_TIMEZONE = "Europe/Moscow";

export function getProjectTimezone(
  environment: Record<string, string | undefined> = process.env,
) {
  return environment.PROJECT_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
}

export function getProjectDateIso(
  time: Date = new Date(),
  environment: Record<string, string | undefined> = process.env,
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getProjectTimezone(environment),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
