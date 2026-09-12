import type { MailProfileSafeView } from './mail-profile.ts';

export type InboxClassification = 'linked' | 'unclassified' | 'duplicate' | 'conflict';
export type InboxMessageSummary = {
  readonly id: string;
  readonly subject: string | null;
  readonly from: readonly string[];
  readonly receivedAt: string | null;
  readonly collectedAt: string;
  readonly classification: InboxClassification;
  readonly reason: string;
  readonly candidate: { readonly id: string; readonly keyword: string } | null;
  readonly rfqId: string | null;
  readonly specId: string | null;
  readonly attachmentCount: number;
};
export type InboxWorkspace = {
  readonly profileStatus: MailProfileSafeView['status'];
  readonly collectionEnabled: boolean;
  readonly lastCheckedAt: string | null;
  readonly lastError: { readonly code: string; readonly at: string } | null;
  readonly messages: readonly InboxMessageSummary[];
  readonly nextCursor: string | null;
};
export type InboxAttachmentView = {
  readonly id: string;
  readonly filename: string | null;
  readonly mediaType: string;
  readonly byteSize: number | null;
  readonly state: 'text' | 'unsupported' | 'too_large' | 'unreadable';
  readonly text: string | null;
};
export type InboxLinkOption = {
  readonly rfqId: string;
  readonly candidateId: string;
  readonly keyword: string;
  readonly recipient: string;
  readonly subject: string;
  readonly specId: string;
  readonly quantity: number;
};
export type InboxMessageDetail = {
  readonly message: InboxMessageSummary & {
    readonly body: string | null;
    readonly bodyState: 'text' | 'unsupported' | 'too_large' | 'unreadable' | 'missing';
    readonly originalAvailable: boolean;
  };
  readonly attachments: readonly InboxAttachmentView[];
  readonly linkOptions: readonly InboxLinkOption[];
};

export type InboxSourceCoordinates = {
  readonly profileId: string;
  readonly mailboxKey: string;
  readonly uidValidity: string;
  readonly uid: number | string;
};
export function inboxCaptureOwner(source: InboxSourceCoordinates, field: string): string {
  return `mail_inbox:${source.profileId}:${source.mailboxKey}:${source.uidValidity}:${source.uid}:${field}`;
}
