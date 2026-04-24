import { Metadata } from "next";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Кабинет" };

/**
 * Личный кабинет. Всё клиентское: auth — в localStorage,
 * submissions тянутся отдельно с токеном.
 */
export default function DashboardPage() {
  return <DashboardView />;
}
