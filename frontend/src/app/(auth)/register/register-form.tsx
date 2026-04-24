"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/store";

const schema = z.object({
  full_name: z.string().min(2, "Минимум 2 символа").max(80, "Слишком длинно").optional().or(z.literal("")),
  email: z.string().email("Некорректный email"),
  password: z
    .string()
    .min(8, "Минимум 8 символов")
    .regex(/[A-Za-z]/, "Должна быть хотя бы одна буква")
    .regex(/[0-9]/, "Должна быть хотя бы одна цифра"),
});
type FormValues = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const registerAction = useAuth((s) => s.register);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await registerAction({
        email: values.email,
        password: values.password,
        full_name: values.full_name || null,
      });
      router.push("/dashboard");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Не удалось создать аккаунт");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Имя (по желанию)</Label>
        <Input id="full_name" autoComplete="name" {...register("full_name")} />
        {errors.full_name && (
          <p className="text-xs text-[var(--color-danger)]">{errors.full_name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && (
          <p className="text-xs text-[var(--color-danger)]">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Пароль</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-xs text-[var(--color-danger)]">{errors.password.message}</p>
        ) : (
          <p className="text-xs text-[var(--color-fg-subtle)]">
            Минимум 8 символов, буквы и цифры.
          </p>
        )}
      </div>

      {serverError && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {serverError}
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Создаём…" : "Создать аккаунт"}
      </Button>

      <p className="text-xs text-[var(--color-fg-subtle)]">
        Регистрируясь, вы соглашаетесь с{" "}
        <a href="/terms" className="underline">Условиями</a> и{" "}
        <a href="/privacy" className="underline">Политикой конфиденциальности</a>.
      </p>
    </form>
  );
}
