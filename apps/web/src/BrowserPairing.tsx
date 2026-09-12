import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BridgePairing } from "../../../packages/domain/src/browser-device.ts";
import { createBrowserPairing, getBrowserPairingStatus } from "./bridge-api.ts";
import { useLocale } from "./ui.tsx";

export function BrowserPairing({ disabled }: { readonly disabled: boolean }) {
  const { t, language } = useLocale(), qc = useQueryClient(), inputId = useId();
  const [pairing, setPairing] = useState<BridgePairing | null>(null);
  const [busy, setBusy] = useState(false), [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const status = useQuery({ queryKey: ["browser-pairing-status", pairing?.id],
    queryFn: () => getBrowserPairingStatus(pairing?.id ?? ""), enabled: Boolean(pairing), retry: false, refetchInterval: pairing ? 5000 : false,
  });
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => { setPairing(null); setRevealed(false); setNotice(t("연결 코드가 만료됐어요. 새 코드를 만들어 주세요.", "This connection code expired. Create a new code.")); }, Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing, language]);
  useEffect(() => {
    const state = status.data?.state;
    if (!pairing || !state || state === "pending") return;
    setPairing(null); setRevealed(false);
    setNotice(state === "consumed" ? t("기기를 등록했어요.", "Device registered.") : t("이 코드는 더 이상 사용할 수 없어요. 새 코드를 만들어 주세요.", "This code is no longer valid. Create a new code."));
    void qc.invalidateQueries({ queryKey: ["browser-devices"] });
  }, [pairing, status.data?.state, qc, language]);
  async function issue() {
    if (busy || disabled) return;
    setBusy(true); setError(null); setNotice(null); setRevealed(false);
    try { setPairing(await createBrowserPairing()); }
    catch { setError(t("연결 코드를 만들지 못했어요. 다시 시도해 주세요.", "Could not create a connection code. Try again.")); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!pairing) return;
    try { await navigator.clipboard.writeText(pairing.pairingCode); setNotice(t("복사했어요. 이 PC의 연결 프로그램에 붙여넣으세요.", "Copied. Paste it into this PC’s connection program.")); }
    catch { setError(t("복사하지 못했어요. 코드 보기를 눌러 직접 복사해 주세요.", "Could not copy. Show the code and copy it manually.")); }
  }
  return <div className="stack">
    <button type="button" className="btn btn-primary" disabled={disabled || busy} onClick={() => void issue()}>
      {busy ? t("코드 만드는 중", "Creating code") : pairing ? t("새 연결 코드 만들기", "Create a new connection code") : t("ASIDE 연결 코드 만들기", "Create ASIDE connection code")}
    </button>
    {pairing && <div className="stack">
      <p>{t("이 PC의 연결 프로그램에 코드를 붙여넣으세요. 한 번만 사용할 수 있습니다.", "Paste this code into this PC’s connection program. It can be used once.")}</p>
      <p className="muted">{t("코드 만료", "Code expires")}: {new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { timeStyle: "short" }).format(new Date(pairing.expiresAt))}</p>
      <div className="field"><label htmlFor={inputId}>{t("ASIDE 연결 코드", "ASIDE connection code")}</label>
        <input id={inputId} type={revealed ? "text" : "password"} value={pairing.pairingCode} readOnly autoComplete="off" spellCheck={false} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>{t("연결 코드 복사", "Copy connection code")}</button>
        <button type="button" className="text-btn" aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>{revealed ? t("코드 숨기기", "Hide code") : t("코드 보기", "Show code")}</button>
      </div>
      {status.isError && <p className="banner" role="alert">{t("등록 결과를 확인하지 못했어요. 연결 상태를 다시 확인해 주세요.", "Could not confirm registration. Refresh the connection status.")}</p>}
    </div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="banner" role="alert">{error}</p>}
  </div>;
}
