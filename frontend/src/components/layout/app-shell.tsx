"use client";

import { usePathname } from "next/navigation";

/**
 * Клиентский слой, решающий, показывать ли сайтовую шапку/подвал.
 *
 * На страницах прохождения теста (/tasks/*) сайтовый хром прячется —
 * там своя, «экзаменационная» панель сверху: минимум отвлечений,
 * как в официальном компьютерном формате ЕГЭ.
 *
 * header/footer приходят уже отрендеренными (это RSC), AppShell только решает
 * рисовать их или нет. Родительский layout при этом остаётся серверным.
 */
export function AppShell({
  header,
  footer,
  children,
}: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  // Всё, что считается «режимом теста» — без сайтового хрома.
  // Сейчас это только прохождение варианта; если появятся другие экзамен-роуты,
  // добавим сюда их префиксы.
  const isExamMode = /^\/variants\/[^/]+\/exam(\/|$)/.test(pathname);

  return (
    <>
      {!isExamMode && header}
      <main className="flex-1 flex flex-col">{children}</main>
      {!isExamMode && footer}
    </>
  );
}
