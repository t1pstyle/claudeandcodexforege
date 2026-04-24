import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Регистрация" };

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-[var(--font-serif)] text-2xl">Создать аккаунт</CardTitle>
        <p className="text-sm text-[var(--color-fg-muted)]">
          30 секунд — и вы в каталоге вариантов. Карта не нужна.
        </p>
      </CardHeader>
      <CardContent>
        <RegisterForm />
        <p className="mt-6 text-center text-sm text-[var(--color-fg-muted)]">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="text-[var(--color-accent)] hover:underline">
            Войти
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
