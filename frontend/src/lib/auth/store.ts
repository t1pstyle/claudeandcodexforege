"use client";

/**
 * Клиентское состояние аутентификации.
 *
 * Работает так:
 * - При логине вызываем login(email, password) → токен идёт в localStorage.
 * - После успешного логина вызываем bootstrap() → дёргает /users/me.
 * - Результат (user) кладём в стор, чтобы хедер/дашборд не фетчили повторно.
 * - При logout() — чистим стор и токен.
 *
 * Почему Zustand, а не Context: zustand не вызывает re-render у компонентов,
 * которые не подписаны на конкретный срез (selector), это важно, когда
 * в сторе будут чаще меняющиеся поля (баланс проверок).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  getCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type UserRead,
  type UserCreate,
} from "@/lib/api/endpoints";
import { getStoredToken } from "@/lib/api/client";

interface AuthState {
  user: UserRead | null;
  status: "idle" | "loading" | "authed" | "guest";
  error: string | null;

  /** Подгрузить текущего пользователя по токену из localStorage. */
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: UserCreate) => Promise<void>;
  logout: () => void;
  /** Уменьшить баланс после успешной AI-заявки — оптимистический апдейт. */
  decrementPaidChecks: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      status: "idle",
      error: null,

      async bootstrap() {
        if (get().status === "loading") return;
        const token = getStoredToken();
        if (!token) {
          set({ status: "guest", user: null });
          return;
        }
        set({ status: "loading", error: null });
        try {
          const user = await getCurrentUser();
          set({ user, status: "authed" });
        } catch {
          // Токен невалиден — чистим.
          apiLogout();
          set({ user: null, status: "guest", error: null });
        }
      },

      async login(email, password) {
        set({ status: "loading", error: null });
        try {
          await apiLogin(email, password);
          const user = await getCurrentUser();
          set({ user, status: "authed" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Ошибка входа";
          set({ status: "guest", error: msg });
          throw err;
        }
      },

      async register(payload) {
        set({ status: "loading", error: null });
        try {
          await apiRegister(payload);
          // После регистрации сразу логинимся, чтобы не заставлять
          // пользователя снова вводить пароль.
          await apiLogin(payload.email, payload.password);
          const user = await getCurrentUser();
          set({ user, status: "authed" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Не удалось создать аккаунт";
          set({ status: "guest", error: msg });
          throw err;
        }
      },

      logout() {
        apiLogout();
        set({ user: null, status: "guest", error: null });
      },

      decrementPaidChecks() {
        const user = get().user;
        if (!user) return;
        set({ user: { ...user, paid_checks_available: Math.max(0, user.paid_checks_available - 1) } });
      },
    }),
    {
      name: "speaking.auth", // persist только user, статус пересчитываем после hydrate
      partialize: (s) => ({ user: s.user }),
    }
  )
);
