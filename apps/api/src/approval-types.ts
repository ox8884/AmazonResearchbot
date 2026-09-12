import { z } from "zod";
import {
  settingsBaselineSchema,
  settingsSnapshotSchema,
} from "./settings-schema.ts";
export type ApprovalRow = {
  id: string;
  kind: string;
  candidate_id: string | null;
  status: string;
  payload_hash: string;
  payload: unknown;
  created_at: Date;
};
export type DecisionResult =
  | { ok: true; id: string; status: string; reused?: boolean }
  | { ok: false; code: string };
export const settingsApprovalSchema = z
  .object({
    payloadVersion: z.literal(1),
    proposalId: z.uuid(),
    settingsVersion: z.number().int().positive(),
    before: settingsBaselineSchema,
    after: settingsSnapshotSchema,
  })
  .strict();
