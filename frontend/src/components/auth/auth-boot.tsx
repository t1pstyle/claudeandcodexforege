"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/store";

/**
 * Монтируется один раз в client-корне. При первом рендере дёргает /users/me
 * по токену из localStorage — чтобы при перезагрузке страницы не было
 * мигания "гость → вошёл".
 */
export function AuthBoot() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  return null;
}
