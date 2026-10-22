import type {
RfqInput,
RfqRecord,
RfqReplyInput,
RfqReplyRecord,
RfqWorkspace,
SupplierInput,
SupplierRecord,
} from "../../../packages/domain/src/rfq.ts";
import { requestJson } from "./api.ts";

export type ApprovalDecision = {
  readonly id: string;
  readonly status: string;
};

export type RfqApproval = {
  readonly approvalId: string;
  readonly rfq: RfqRecord;
  readonly reused?: boolean;
};

export type SupplierReply = RfqReplyRecord;
export type ReplyInput = RfqReplyInput;

export class ContactRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const request = <T>(
  path: string,
  options?: { readonly method?: "POST"; readonly body?: unknown },
) => requestJson<T>(path, ContactRequestError, options);

export const getContactWorkspace = (candidateId: string) =>
  request<RfqWorkspace>(
    `/api/candidates/${encodeURIComponent(candidateId)}/contact`,
  );

export const createSupplier = (candidateId: string, input: SupplierInput) =>
  request<SupplierRecord>(
    `/api/candidates/${encodeURIComponent(candidateId)}/suppliers`,
    { method: "POST", body: input },
  );

export const createRfq = (candidateId: string, input: RfqInput) =>
  request<RfqRecord>(
    `/api/candidates/${encodeURIComponent(candidateId)}/rfqs`,
    { method: "POST", body: input },
  );

export const requestRfqApproval = (rfqId: string) =>
  request<RfqApproval>(`/api/rfqs/${encodeURIComponent(rfqId)}/approval`, {
    method: "POST",
  });

export const decideRfqApproval = (
  approvalId: string,
  decision: "approve" | "reject",
) =>
  request<ApprovalDecision>(
    `/api/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    { method: "POST" },
  );

export const getRfqReplies = (rfqId: string) =>
  request<{ readonly replies: readonly SupplierReply[] }>(
    `/api/rfqs/${encodeURIComponent(rfqId)}/replies`,
  );

export const recordRfqReply = (rfqId: string, input: ReplyInput) =>
  request<{ readonly id: string | null; readonly reused: boolean }>(
    `/api/rfqs/${encodeURIComponent(rfqId)}/replies`,
    { method: "POST", body: input },
  );

export type RfqAiSuggestion={aiTaskId:string;subject:string;body:string};
export const getRfqAiSuggestion=(candidateId:string,specId:string,quantity:number)=>
  request<{suggestion:RfqAiSuggestion|null}>(`/api/candidates/${encodeURIComponent(candidateId)}/rfq-ai?specId=${encodeURIComponent(specId)}&quantity=${quantity}`);
