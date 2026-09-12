import { useState } from "react";
import type { CsvMapping, CsvPreview } from "../../../packages/domain/src/csv-import.ts";
import { CsvMappingFields } from "./CsvMappingFields.tsx";
import { useLocale } from "./ui.tsx";

type Review = { mapping: CsvMapping; expectedSha256: string };
type Props = {
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onImport: (file: File, review: Review) => Promise<boolean>;
};

export function CsvImportPanel({ busy, onBusy, onImport }: Props) {
  const { t } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function inspect(selected: File, selectedMapping?: CsvMapping) {
    onBusy(true);
    setError(null);
    setReviewed(false);
    try {
      const body = new FormData();
      if (selectedMapping) body.append("mapping", JSON.stringify(selectedMapping));
      body.append("file", selected);
      const response = await fetch("/api/imports/preview", { method: "POST", credentials: "include", body });
      if (!response.ok) {
        setError(t("파일을 읽지 못했어요. CSV 형식과 크기(최대 10MB)를 확인해 주세요.", "Could not read this file. Check its CSV format and size (up to 10MB)."));
        return;
      }
      const result: CsvPreview = await response.json();
      setPreview(result);
      setMapping(result.mapping);
      setReviewed(result.headerError === null && result.validCount > 0 && result.validCount === result.totalRows);
    } catch {
      setError(t("미리보기를 불러오지 못했어요. 다시 시도해 주세요.", "Could not load the preview. Try again."));
    } finally {
      onBusy(false);
    }
  }

  return <>
    <div className="field">
      <label htmlFor="csv">{t("1. CSV 파일 선택", "1. Choose a CSV file")}</label>
      <input id="csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => {
        const selected = event.target.files?.[0];
        event.target.value = "";
        if (!selected) return;
        setFile(selected); setPreview(null); setMapping({});
        void inspect(selected);
      }} />
      <p className="muted">{t("파일을 선택해도 후보는 아직 생성되지 않습니다.", "Selecting a file does not create candidates yet.")}</p>
    </div>
    {file && <p>{file.name}</p>}
    {preview && <CsvMappingFields preview={preview} mapping={mapping} busy={busy} reviewed={reviewed} onChange={next => {
      setMapping(next); setReviewed(false); setError(null);
    }} />}
    {error && <p className="banner" role="alert">{error}</p>}
    {file && !reviewed && <button className="btn btn-primary" disabled={busy || (preview !== null && !mapping.keyword)} onClick={() => void inspect(file, preview ? mapping : undefined)}>
      {t("선택한 열로 미리보기", "Preview selected columns")}
    </button>}
    {file && preview && reviewed && <button className="btn btn-primary" disabled={busy} onClick={async () => {
      const imported = await onImport(file, { mapping, expectedSha256: preview.sha256 });
      if (imported) { setFile(null); setPreview(null); setReviewed(false); }
    }}>
      {t(`확인한 후보 ${preview.validCount}개 가져오기`, `Import ${preview.validCount} reviewed candidates`)}
    </button>}
  </>;
}
