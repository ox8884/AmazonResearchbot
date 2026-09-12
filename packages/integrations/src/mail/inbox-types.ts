export type InboxCursor = {
  readonly uidValidity: string;
  readonly lastUid: number;
};

export type InboxAttachment = {
  readonly part: string;
  readonly filename: string | null;
  readonly mediaType: string;
  readonly size: number | null;
  readonly state: "text" | "unsupported" | "too_large" | "unreadable";
  readonly bytes: Uint8Array | null;
  readonly text: string | null;
};

export type InboxMessage = {
  readonly uid: number;
  readonly messageId: string | null;
  readonly inReplyTo: readonly string[];
  readonly references: readonly string[];
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly subject: string | null;
  readonly receivedAt: string | null;
  readonly rawSource: Uint8Array | null;
  readonly bodyText: string | null;
  readonly contentState:
    "text" | "unsupported" | "too_large" | "unreadable" | "missing";
  readonly attachments: readonly InboxAttachment[];
};

export type InboxBatch = {
  readonly mailboxKey: string;
  readonly uidValidity: string;
  readonly lastUid: number;
  readonly observedAt: string;
  readonly hasMore: boolean;
  readonly messages: readonly InboxMessage[];
};

export type InboxReadResult =
  | { readonly kind: "batch"; readonly batch: InboxBatch }
  | { readonly kind: "blocked"; readonly reason: string };

export type InboxTransport = {
  readonly mailboxKey: string;
  readonly read: (cursor: InboxCursor | null) => Promise<InboxReadResult>;
};
