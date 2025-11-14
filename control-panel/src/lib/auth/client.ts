"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";

type Session = {
  sub: string;
  name?: string;
  email?: string;
  roles: string[];
};

const fetcher = (url: string) => fetch(url, { credentials: "include" }).then((r) => {
  if (!r.ok) {
    throw new Error("unauthenticated");
  }
  return r.json();
});

export function useSession(options?: { redirectTo?: string; requiredRoles?: string[] }) {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<{ session: Session }>("/api/session", fetcher);

  if (error && options?.redirectTo) {
    router.push(options.redirectTo);
  }

  if (data && options?.requiredRoles?.length) {
    const allowed = data.session.roles.some((role) => options.requiredRoles?.includes(role));
    if (!allowed && options.redirectTo) {
      router.push(options.redirectTo);
    }
  }

  return {
    session: data?.session,
    loading: isLoading,
    error,
    refresh: mutate,
  };
}

export async function logout() {
  await fetch("/api/session", { method: "DELETE" });
  window.location.href = "/login";
}
