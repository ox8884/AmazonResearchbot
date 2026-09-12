import { AiProfileCard } from "./AiProfileCard.tsx";
import { CustomAiForm } from "./CustomAiForm.tsx";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router";
import { getCustomAi, type CustomAiProfile } from "./custom-ai-api.ts";
import { PageHeader, LoadError, Loading, useLocale } from "./ui.tsx";
export function CustomAi() {
  const { t } = useLocale(),
    qc = useQueryClient();
  const q = useQuery({ queryKey: ["custom-ai"], queryFn: getCustomAi });
  const [selected, setSelected] = useState<CustomAiProfile | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <NavLink className="text-btn" to="/settings">
        {t("설정으로", "Back to settings")}
      </NavLink>
      <PageHeader
        title={t("커스텀 AI", "Custom AI")}
        description={t(
          "내가 선택한 AI의 연결 정보를 준비합니다.",
          "Prepare connection settings for the AI you choose.",
        )}
      />
      <p className="banner">
        {t(
          "설정 저장은 호출을 시작하지 않습니다. 연결 테스트는 전송할 내용과 비용을 검토한 뒤 별도로 승인하고 실행합니다.",
          "Saving settings does not start a call. Review the test prompt and cost, then approve and run the connection test separately.",
        )}
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <LoadError retry={() => void q.refetch()} />
      ) : (
        <>
          {q.isError && <LoadError retry={() => void q.refetch()} />}
          <section className="detail-section">
            <h2>{t("저장한 AI 연결", "Saved AI connections")}</h2>
            {q.data?.profiles.length === 0 && (
              <p className="muted">
                {t(
                  "아직 저장한 연결이 없어요. 아래에서 추가할 수 있습니다.",
                  "No connections saved yet. Add one below.",
                )}
              </p>
            )}
            {q.data?.profiles.map((p) => (
              <AiProfileCard
                key={p.id + ":" + p.version + ":" + p.status}
                profile={p}
                onEdit={() => {
                  setSelected(p);
                  setSaved(false);
                }}
                onRefresh={async () => {
                  setSaved(false);
                  await q.refetch();
                }}
              />
            ))}
          </section>
          {saved && (
            <p className="save-notice" role="status">
              {t(
                "연결 설정을 저장했습니다. 아직 사용하지 않습니다.",
                "Connection settings saved. Not active yet.",
              )}
            </p>
          )}
          <CustomAiForm
            key={selected ? selected.id + ":" + selected.version : "new"}
            profile={selected}
            onSaved={(p) => {
              qc.setQueryData<{ profiles: CustomAiProfile[] }>(
                ["custom-ai"],
                (old) => ({
                  profiles: [
                    ...(old?.profiles ?? []).filter((x) => x.id !== p.id),
                    p,
                  ],
                }),
              );
              setSelected(p);
              setSaved(true);
            }}
            onNew={() => {
              setSelected(null);
              setSaved(false);
            }}
          />
        </>
      )}
    </>
  );
}
