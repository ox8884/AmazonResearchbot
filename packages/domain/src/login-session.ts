export type LoginSession = {
  readonly id: string;
  readonly current: boolean;
  readonly device: string | null;
  readonly address: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
};

export type TrustedDevice = {
  readonly id: string;
  readonly device: string | null;
  readonly createdAt: string | null;
  readonly expiresAt: string;
};
