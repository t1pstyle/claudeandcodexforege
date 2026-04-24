import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-[var(--font-serif)] text-2xl">С возвращением</CardTitle>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Войдите, чтобы продолжить тренировку.
        </p>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<div className="h-48" />}>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-center text-sm text-[var(--color-fg-muted)]">
          Нет аккаунта?{" "}
          <Link href="/register" className="text-[var(--color-accent)] hover:underline">
            Создать
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
