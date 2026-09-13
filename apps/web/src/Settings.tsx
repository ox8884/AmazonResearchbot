import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ApprovalError, approve, getSettings, proposeSettings } from "./api.ts";
import { pendingSettings, rejectSettings } from "./settings-api.ts";
import {
  changedSettings,
  draftFromSnapshot,
  patchFromDraft,
  validateSettingsDraft,
  type SettingsDraft,
} from "./settings-fields.tsx";
import { SettingsDiff } from "./SettingsControls.tsx";
import { SettingsDetails } from "./SettingsDetails.tsx";
import { LoadError, Loading, PageHeader, useLocale } from "./ui.tsx";

type Proposal = {
  id: string;
  before: SettingsDraft;
  after: SettingsDraft;
};

type ProposalRequest = Omit<Proposal, "id"> & {
  patch: Record<string, string | number | boolean | null>;
};

export function Settings() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const pending = useQuery({
    queryKey: ["settings-pending"],
    queryFn: pendingSettings,
  });
  const selected =
    pending.data?.find(
      (item) => item.payload !== null && item.id === params.get("approval"),
    ) ?? pending.data?.find((item) => item.payload !== null);
  const proposal: (Proposal & { version: number }) | null = selected?.payload
    ? {
        id: selected.id,
        before: draftFromSnapshot(selected.payload.before),
        after: draftFromSnapshot(selected.payload.after),
        version: selected.payload.settingsVersion,
      }
    : null;
  const [approved, setApproved] = useState(false);
  const snapshot = q.data?.snapshot;
  const version = q.data?.version;

  useEffect(() => {
    if (!snapshot || version == null || proposal || draftVersion === version)
      return;
    setDraft(draftFromSnapshot(snapshot));
    setDraftVersion(version);
  }, [draftVersion, proposal, snapshot, version]);

  const current = snapshot ? draftFromSnapshot(snapshot) : null;
  const validationDraft = proposal?.after ?? draft;
  const errors = validationDraft ? validateSettingsDraft(validationDraft, current ?? undefined) : {};
  const changed = draft && current ? changedSettings(draft, current) : [];
  const patch = draft && current ? patchFromDraft(draft, current) : {};
  const valid = changed.length > 0 && Object.keys(errors).length === 0;
  const propose = useMutation({
    mutationFn: (request: ProposalRequest) => proposeSettings(request.patch),
    onSuccess: async () => {
      await pending.refetch();
      setApproved(false);
    },
  });
  const decision = useMutation({
    mutationFn: (id: string) => approve(id),
    onError: async () => {
      await Promise.all([q.refetch(), pending.refetch()]);
    },
    onSuccess: async () => {
      setDraft(null);
      setDraftVersion(null);
      setApproved(true);
      await Promise.all([q.refetch(), pending.refetch()]);
    },
  });
  const rejection = useMutation({
    mutationFn: rejectSettings,
    onSuccess: async () => {
      setDraft(null);
      setDraftVersion(null);
      await Promise.all([q.refetch(), pending.refetch()]);
    },
  });
  if (q.isPending || pending.isPending) return <Loading />;
  if (q.isError || pending.isError)
    return (
      <LoadError
        retry={() => {
          void q.refetch();
          void pending.refetch();
        }}
      />
    );
  const displayDraft = proposal?.after ?? draft;
  if (!snapshot || !current || !displayDraft || version == null)
    return <Loading />;
  const locked =
    Boolean(proposal) ||
    propose.isPending ||
    decision.isPending ||
    rejection.isPending;
  return (
    <>
      <PageHeader
        title={t("설정", "Settings")}
        description={t(
          "변경할 내용을 검토하고 승인한 뒤 적용합니다.",
          "Review and approve changes before they take effect.",
        )}
      >
        <span className="chip chip-quote">
          {t("지금 적용 중", "Currently applied")} · v{q.data.version}
        </span>
      </PageHeader>
      {proposal && (
        <p className="banner">
          {t(
            "저장된 변경 요청을 검토 중입니다. 아래 입력값은 승인 전까지 적용되지 않습니다.",
            "Reviewing a saved change request. The values below are not applied until approved.",
          )}
        </p>
      )}
      <div className="settings-groups">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || locked || !draft) return;
            propose.mutate({ before: current, after: draft, patch });
          }}
        >
          <SettingsDetails
            snapshot={snapshot}
            draft={displayDraft}
            errors={errors}
            disabled={locked}
            onChange={(key, value) => {
              setDraft((previous) =>
                previous ? { ...previous, [key]: value } : previous,
              );
              setApproved(false);
            }}
          />
          {!proposal && draft && changed.length > 0 && (
            <SettingsDiff before={current} after={draft} />
          )}
          {!proposal && Object.keys(errors).length > 0 && (
            <p className="banner" role="alert">
              {t(
                "표시된 입력 오류를 확인한 뒤 승인을 요청해 주세요.",
                "Check the highlighted fields before requesting approval.",
              )}
            </p>
          )}
          {!proposal && (
            <button className="btn btn-primary" disabled={!valid || locked}>
              {propose.isPending
                ? t("요청 중", "Requesting")
                : t("변경 승인 요청", "Request approval to change")}
            </button>
          )}
          {!proposal && !locked && changed.length === 0 && (
            <p className="muted">
              {t(
                "현재 적용 중인 값과 다른 항목이 있을 때 승인 요청할 수 있어요.",
                "Change a value before requesting approval.",
              )}
            </p>
          )}
        </form>
        {proposal && (
          <div className="proposal-review" role="status">
            <strong>
              {t(
                "승인 대기 · 아직 적용되지 않았어요",
                "Pending approval · not applied",
              )}
            </strong>
            {proposal.version !== version && (
              <p className="banner">
                {t(
                  "이 요청은 예전 기준(v" + String(proposal.version) + ")으로 만들어졌고, 지금은 v" + String(version) + "이 적용 중입니다. 승인이 빠진 게 아니라 옛 요청이 현재 설정을 덮지 못하게 막은 것입니다. 거절하면 지금 적용 중인 값이 유지됩니다.",
                  "This request used older criteria (v" + String(proposal.version) + "). v" + String(version) + " is already live. Approval is hidden so the old request cannot overwrite current settings. Reject it to keep what is applied now.",
                )}
              </p>
            )}
            <SettingsDiff before={proposal.before} after={proposal.after} />
            {proposal.version === version && (
              <button
                className="btn btn-primary"
                disabled={decision.isPending || rejection.isPending}
                onClick={() => decision.mutate(proposal.id)}
              >
                {decision.isPending
                  ? t("승인 중", "Approving")
                  : t("이 변경 승인", "Approve this change")}
              </button>
            )}
            <button
              className="btn btn-secondary"
              type="button"
              disabled={decision.isPending || rejection.isPending}
              onClick={() => rejection.mutate(proposal.id)}
            >
              {proposal.version !== version
                ? t("옛 요청 거절 · 현재 설정 유지", "Reject old request · keep current settings")
                : t("이 변경 거절", "Reject this change")}
            </button>
          </div>
        )}
        {(propose.isError || decision.isError || rejection.isError) && (
          <p className="banner" role="alert">
            {decision.error instanceof ApprovalError && decision.error.code === "LAUNCH_BUDGET_RESERVED"
              ? t("이미 예약된 출시 현금보다 한도가 낮습니다. 예약을 검토한 뒤 다시 승인해 주세요.", "This limit is below reserved launch cash. Review reservations before approving again.")
              : t("처리 결과를 확인하지 못했어요. 현재 적용 버전을 확인해 주세요.", "Couldn’t confirm the result. Check the current version.")}
          </p>
        )}
        {approved && (
          <p role="status">{t("변경을 승인했습니다.", "Change approved.")}</p>
        )}
      </div>
    </>
  );
}
