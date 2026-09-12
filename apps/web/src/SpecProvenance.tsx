import { Icon, useLocale } from "./ui.tsx";

export function SpecProvenance({ aiTaskId }: { readonly aiTaskId?: string | null }) {
  const { t } = useLocale();
  return aiTaskId ? <p className="banner" role="note"><Icon name="unknown" /> {t("AI 사양 제안 · 실측값 아님", "AI target · Not measured evidence")}</p> : null;
}
