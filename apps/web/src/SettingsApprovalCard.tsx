import { NavLink } from "react-router";
import type { PendingSettings } from "./settings-api.ts";
import { draftFromSnapshot } from "./settings-fields.tsx";
import { SettingsDiff } from "./SettingsControls.tsx";
import { Icon, Stage, useLocale } from "./ui.tsx";
export function SettingsApprovalCard({ request }: { request: PendingSettings }) {
  const { t } = useLocale();
  if (!request.payload) return null;
  return (
                  <article className="card">
                    <Stage>
                      {t(
                        "기준 변경 승인 대기",
                        "Criteria change awaiting approval",
                      )}
                    </Stage>
                    <h3>
                      {t(
                        "판매·실행 기준 변경",
                        "Selling and execution criteria",
                      )}
                    </h3>
                    <p className="muted">
                      {t(
                        "승인 전에는 현재 기준이 유지됩니다.",
                        "Current criteria remain in effect until approved.",
                      )}
                    </p>
                    <SettingsDiff
                      before={draftFromSnapshot(request.payload.before)}
                      after={draftFromSnapshot(request.payload.after)}
                    />
                    <NavLink
                      className="btn btn-primary"
                      to={
                        "/settings?approval=" + encodeURIComponent(request.id)
                      }
                    >
                      {t("변경 내용 검토", "Review changes")}
                      <Icon name="arrow" />
                    </NavLink>
                  </article>
  );
}
