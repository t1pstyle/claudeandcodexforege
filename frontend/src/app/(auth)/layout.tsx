import { Container } from "@/components/ui/container";

/**
 * Узкий layout для login/register: центрированная колонка 440px.
 * Хедер/футер наследуются из root layout.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container className="flex min-h-[calc(100vh-16rem)] items-center justify-center py-12">
      <div className="w-full max-w-[440px]">{children}</div>
    </Container>
  );
}
