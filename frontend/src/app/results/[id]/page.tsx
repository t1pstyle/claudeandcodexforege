import type { Metadata } from "next";
import { ResultsView } from "./results-view";

export const metadata: Metadata = { title: "Разбор ответа" };

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResultsView submissionId={id} />;
}
