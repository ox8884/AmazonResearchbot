import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BridgeConnectionState } from "../../../packages/domain/src/browser-device.ts";
import { getBrowserDevices, getBrowserSigningIdentity, revokeBrowserDevice } from "./bridge-api.ts";
import { BrowserPairing } from "./BrowserPairing.tsx";
import { Icon, LoadError, Loading, useLocale } from "./ui.tsx";

const labels: Record<BridgeConnectionState, readonly [string, string]> = {
  unreported: ["연결 확인 전", "Not checked yet"], ready: ["연결됨", "Connected"], offline: ["ASIDE 연결 끊김", "ASIDE disconnected"],
  stale: ["최근 연결 미확인", "Connection not recently verified"], unsupported: ["읽기 작업 준비 필요", "Read tasks not ready"],
  key_mismatch: ["다시 연결 필요", "Reconnect required"], revoked: ["연결 해제됨", "Disconnected by owner"],
};
export function BrowserConnection() {
  const { t, language } = useLocale();
  const devices = useQuery({ queryKey: ["browser-devices"], queryFn: getBrowserDevices, retry: false, refetchInterval: 15000 });
  const signing = useQuery({ queryKey: ["browser-signing-identity"], queryFn: getBrowserSigningIdentity, retry: false });
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  async function revoke(id: string) {
    if (busy) return;
    setBusy(id); setNotice(null);
    try { await revokeBrowserDevice(id); await devices.refetch(); setNotice(t("이 기기의 ASIDE 연결을 해제했어요.", "This device’s ASIDE connection was removed.")); }
    catch { setNotice(t("해제 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.", "Could not confirm removal. Refresh the device list.")); }
    finally { setBusy(null); }
  }
  const refresh = () => { void devices.refetch(); void signing.refetch(); };
  const ready = Boolean(signing.data?.signingKey) && !signing.isError;
  return <section className="detail-section stack" aria-labelledby="aside-connection-heading">
    <div className="section-label"><h2 id="aside-connection-heading">{t("ASIDE 브라우저 연결", "ASIDE browser connection")}</h2>
      <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || devices.isFetching || signing.isFetching} onClick={refresh}>{t("연결 상태 새로 확인", "Refresh connection status")}</button>
    </div>
    <p className="muted">{t("이 PC의 ASIDE를 연결하면 기기가 지원하는 검색·상품·공급처 자료를 읽을 수 있어요. 사이트 로그인은 ASIDE에서 유지됩니다.", "Connect ASIDE on this PC to read supported search, product and supplier information. Site sign-ins stay in ASIDE.")}</p>
    {devices.isPending || signing.isPending ? <Loading /> : <>
      {(devices.isError || signing.isError) && <LoadError retry={refresh} />}
      {!signing.isError && !ready && <p className="banner">{t("브라우저 연결을 준비하고 있어요. 준비가 끝나면 연결 코드를 만들 수 있습니다.", "Browser connection setup is pending. You can create a connection code when it is ready.")}</p>}
      {!devices.isError && devices.data?.devices.length === 0 && <p>{t("아직 등록한 ASIDE 기기가 없어요.", "No ASIDE devices are registered yet.")}</p>}
      {devices.data?.devices.map(device => {
        const state = devices.isError ? "stale" : device.connectionState;
        const label = labels[state];
        return <div className="connection-row" key={device.id}>
          <div><h3>{device.name}</h3>
            <span className={"chip " + (state === "ready" ? "chip-ok" : "chip-unknown")}><Icon name={state === "ready" ? "check" : "unknown"} />{t(label[0], label[1])}</span>
            <p className="muted">{t("마지막 확인", "Last checked")}: {device.checkedAt ? new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(device.checkedAt)) : t("미확인", "Unknown")}</p>
            {state === "ready" && device.capabilities.includes("supplier_search") && <p>{t("공급처 검색 결과 읽기 가능", "Supplier search results can be read")}</p>}
            {state === "ready" && device.capabilities.includes("supplier_detail") && <p>{t("공급처 상세 정보 읽기 가능", "Supplier product details can be read")}</p>}
            {state === "ready" && device.capabilities.includes("amazon_package") && <p>{t("대표 상품 포장 정보 읽기 가능", "Representative product packaging can be read")}</p>}
            {state === "ready" && device.capabilities.includes("saved_search_export") && <p>{t("저장검색 CSV 자동 수집 가능", "Saved-search CSV collection available")}</p>}
            {state === "ready" && device.capabilities.includes("amazon_search") && <p>{t("Amazon 첫 페이지 근거 수집 가능", "Amazon first-page observations available")}</p>}
            {state === "unreported" && <p className="muted">{t("기기는 등록됐어요. 이 PC의 연결 프로그램을 실행해 주세요.", "Device registered. Start the connection program on this PC.")}</p>}
          </div>
          {device.connectionState !== "revoked" && <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => void revoke(device.id)} aria-label={t(device.name + " 연결 해제", "Disconnect " + device.name)}>{busy === device.id ? t("해제 중", "Disconnecting") : t("연결 해제", "Disconnect")}</button>}
        </div>;
      })}
      <BrowserPairing disabled={!ready || devices.isError || Boolean(busy)} />
    </>}
    {notice && <p role="status">{notice}</p>}
    <p className="muted">
      {t("기기가 지원하는 리서치 읽기 작업만 실행합니다.", "Only research read tasks supported by the device are run.")}<br />
      {t("저장검색 수집은 지원 기기와 Jungle Scout 로그인이 필요합니다.", "Saved-search collection requires a supported device and Jungle Scout sign-in.")}<br />
      {t("업체 연락은 보내지 않습니다.", "Supplier messages are not sent.")}
    </p>
  </section>;
}
