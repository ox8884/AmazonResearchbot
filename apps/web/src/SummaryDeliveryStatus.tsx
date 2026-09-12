import type { SummaryDeliveryView } from "../../../packages/domain/src/daily-summary.ts";
import { useLocale } from "./ui.tsx";
export function SummaryDeliveryStatus({
  delivery,
}: {
  delivery?: SummaryDeliveryView | null;
}) {
  const { t } = useLocale();
  if (!delivery)
    return (
      <p>
        {t(
          "앱에 저장된 요약입니다. 이메일 발송 기록은 없습니다.",
          "Stored in the app. No email delivery is recorded.",
        )}
      </p>
    );
  const labels = {
    pending: t(
      "발송 대기 · 메일 연결이 필요합니다",
      "Queued · mail connection required",
    ),
    dispatching: t("발송 결과 확인 중", "Confirming delivery"),
    sent: delivery.localCapture
      ? t(
          "로컬 테스트 수신함에 저장됨 · 외부 발송 아님",
          "Captured locally · no external email",
        )
      : t(
          "메일 서버가 발송을 수락했습니다",
          "The mail server accepted delivery",
        ),
    unknown: t(
      "발송 결과 미확인 · 자동 재발송하지 않습니다",
      "Delivery unknown · will not resend automatically",
    ),
    blocked: t("발송 연결 확인 대기", "Waiting for mail connection checks"),
    cancelled:
      delivery.reason === "MAIL_SMTP_RECIPIENT_REJECTED"
        ? t(
            "받는 주소가 거절되어 발송을 중지했습니다. 설정에서 주소를 확인하세요.",
            "The recipient was rejected. Check the address in settings.",
          )
        : t(
            "설정 또는 요약이 바뀌어 발송 취소됨",
            "Cancelled after settings or summary changed",
          ),
  };
  return (
    <div className="stack" role="status">
      <p>{labels[delivery.state]}</p>
      <p className="muted">
        {t("받는 주소", "Recipient")}: {delivery.recipient} ·{" "}
        {t("전송 시도", "Delivery attempts")}: {delivery.attemptCount}
      </p>
    </div>
  );
}
