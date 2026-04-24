import type { Metadata } from "next";
import "./globals.css";

import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { AppShell } from "@/components/layout/app-shell";
import { AuthBoot } from "@/components/auth/auth-boot";

// Шрифты подключаем напрямую через <link>, а не next/font/google —
// Turbopack в dev на некоторых сетях падает с «Module not found:
// @vercel/turbopack-next/internal/font/google/font», если не может достучаться
// до fonts.gstatic.com на этапе сборки css-модуля шрифта. Обычный <link>
// резолвится уже в браузере пользователя и ведёт себя стабильно.

export const metadata: Metadata = {
  title: {
    default: "ЕГЭ-Speaking — подготовка к устной части ЕГЭ по английскому",
    template: "%s · ЕГЭ-Speaking",
  },
  description:
    "Тренажёр устной части ЕГЭ по английскому: 4 задания из реальных вариантов, запись ответа, AI-разбор по официальным критериям ФИПИ.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400;600&display=swap"
        />
      </head>
      <body className="min-h-screen flex flex-col antialiased" suppressHydrationWarning>
        <AuthBoot />
        <AppShell header={<SiteHeader />} footer={<SiteFooter />}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
