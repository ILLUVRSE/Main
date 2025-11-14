"use client";

import Cookies from "js-cookie";
import { AppRouterInstance } from "next/navigation";

export function ensureAdminSession(router: AppRouterInstance) {
  const token = Cookies.get("controlpanel_token");
  const role = Cookies.get("controlpanel_role");
  if (!token || role !== "SuperAdmin") {
    router.push("/login");
  }
}

export function getAdminRole(): string | undefined {
  return Cookies.get("controlpanel_role");
}
