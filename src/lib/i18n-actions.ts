"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LOCALE_COOKIE, supportedLocales } from "./i18n";

export async function setLocaleAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/applications");
  if (!supportedLocales.includes(locale as "ru" | "en")) {
    redirect("/applications");
  }
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/applications");
}
