export type SettingsSnapshot = {
  marketplace: "us";
  currency: "USD";
  launchBudgetUsd: string;
  marginBeforeAdsPct: string;
  marginAfterAdsPct: string;
  roiPct: string;
  timezone: "Asia/Seoul";
  summaryLocalTime: string;
  review700Max: number;
  review2000HardFailCount: number;
  topPriceMinUsd: string;
  topPriceMaxUsd: string;
  monthlyRevenueMinUsd: string;
  monthlyRevenueCompetitorCount: number;
  passRulesRequired: number;
  jsDailyWireCap: number;
  productDatabaseMaxPages: number;
};

export const INITIAL_SETTINGS: SettingsSnapshot = {
  marketplace: "us",
  currency: "USD",
  launchBudgetUsd: "3000.00",
  marginBeforeAdsPct: "35",
  marginAfterAdsPct: "35",
  roiPct: "150",
  timezone: "Asia/Seoul",
  summaryLocalTime: "08:00",
  review700Max: 3,
  review2000HardFailCount: 2,
  topPriceMinUsd: "17",
  topPriceMaxUsd: "80",
  monthlyRevenueMinUsd: "8000",
  monthlyRevenueCompetitorCount: 5,
  passRulesRequired: 4,
  jsDailyWireCap: 0,
  productDatabaseMaxPages: 3,
};
