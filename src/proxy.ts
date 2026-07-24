import { type NextRequest, NextResponse } from "next/server";

import { isProtectedPath } from "@/lib/auth/paths";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);

  if (!isProtectedPath(request.nextUrl.pathname)) {
    return response;
  }

  const config = getSupabasePublicConfig();
  if (!config) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("reason", "configuration");
    return NextResponse.redirect(loginUrl);
  }

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  const applicationDetailMatch = request.nextUrl.pathname.match(
    /^\/applications\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );

  if (applicationDetailMatch && supabase) {
    const { data, error } = await supabase
      .from("applications")
      .select("id")
      .eq("id", applicationDetailMatch[1])
      .maybeSingle();

    if (!error && !data) {
      return new NextResponse("Заявка не найдена", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
