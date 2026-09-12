import type { CsvField, CsvMapping, CsvPreview } from "../../../packages/domain/src/csv-import.ts";
import { useLocale } from "./ui.tsx";

const fields: readonly { field: CsvField; ko: string; en: string }[] = [
  { field: "keyword", ko: "키워드 (필수)", en: "Keyword (required)" },
  { field: "reviews", ko: "리뷰 수", en: "Review count" },
  { field: "review_700_count", ko: "리뷰 700개 이상 상품 수", en: "Products with at least 700 reviews" },
  { field: "review_2000_count", ko: "리뷰 2,000개 이상 상품 수", en: "Products with at least 2,000 reviews" },
  { field: "top_price", ko: "1위 상품 가격 (USD)", en: "Top product price (USD)" },
  { field: "monthly_revenue_competitors", ko: "월매출 기준 충족 경쟁 상품 수", en: "Competitors meeting the monthly revenue threshold" },
  { field: "marketplace", ko: "판매 시장 (US)", en: "Marketplace (US)" },
];

export function CsvMappingFields({ preview, mapping, busy, reviewed, onChange }: {
  preview: CsvPreview; mapping: CsvMapping; busy: boolean; reviewed: boolean;
  onChange: (mapping: CsvMapping) => void;
}) {
  const { t } = useLocale();
  return <>
    <h3>{t("2. 열의 의미 확인", "2. Match the columns")}</h3>
    <p className="muted">{t("평균 가격은 1위 가격과 다릅니다. 평균 리뷰는 상품 수와 다릅니다. 의미가 맞는 열만 선택하고, 없는 정보는 미확인으로 남겨 주세요.", "Average price is not the top product price. Average reviews are not a product count. Match only columns with the same meaning; leave missing information unknown.")}</p>
    <div className="form-grid">
      {fields.map(({ field, ko, en }) => <div className="field" key={field}>
        <label htmlFor={`csv-${field}`}>{t(ko, en)}</label>
        <select id={`csv-${field}`} disabled={busy} value={mapping[field] ?? ""} onChange={event => {
          const next = { ...mapping };
          if (event.target.value) next[field] = event.target.value;
          else delete next[field];
          onChange(next);
        }}>
          <option value="">{field === "keyword" ? t("열 선택", "Choose a column") : t("선택 안 함 · 미확인", "Not selected · unknown")}</option>
          {preview.headers.map((header, index) => <option key={index} value={header} disabled={Object.entries(mapping).some(([key, value]) => key !== field && value === header)}>{header}</option>)}
        </select>
      </div>)}
    </div>
    <h3>{t("3. 원본 미리보기", "3. Review the source")}</h3>
    <p className="muted">{t(`전체 ${preview.totalRows}행 중 처음 ${preview.samples.length}행입니다. 빈 값과 범위로 적힌 숫자는 미확인으로 남습니다.`, `First ${preview.samples.length} of ${preview.totalRows} rows. Blank values and numeric ranges stay unknown.`)}</p>
    <div className="csv-preview" role="region" aria-label={t("CSV 원본 미리보기", "Original CSV preview")} tabIndex={0}>
      <table>
        <thead><tr><th scope="col">{t("행", "Row")}</th>{preview.headers.map((header, index) => <th scope="col" key={index}>{header}</th>)}</tr></thead>
        <tbody>{preview.samples.map(sample => <tr key={sample.rowNumber}><th scope="row">{sample.rowNumber}</th>{preview.headers.map((header, index) => <td key={index}>{Object.hasOwn(sample.raw, header) && sample.raw[header] !== "" ? sample.raw[header] : t("미확인", "Unknown")}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {!reviewed && <p role="status">{t("열을 선택한 뒤 미리보기로 확인해 주세요. 아직 가져오지 않았습니다.", "Preview your column selection before importing. Nothing has been imported yet.")}</p>}
    {preview.headerError === "duplicate columns" && <p className="banner" role="alert">{t("같은 이름의 열이 있습니다. 원본 파일에서 열 이름을 구분해 주세요.", "Column names are duplicated. Give them unique names in the source file.")}</p>}
    {preview.totalRows === 0 && <p className="banner" role="alert">{t("가져올 데이터 행이 없습니다. 데이터가 있는 CSV를 선택해 주세요.", "There are no data rows to import. Choose a CSV containing data.")}</p>}
    {preview.issues.length > 0 && !preview.headerError && <ul>{preview.issues.map(issue => <li key={issue.rowNumber}>{t(`${issue.rowNumber}행: 키워드 중복·빈 값 또는 US 시장 여부를 확인해 주세요.`, `Row ${issue.rowNumber}: check for an empty or duplicate keyword, or a non-US marketplace.`)}</li>)}</ul>}
  </>;
}
