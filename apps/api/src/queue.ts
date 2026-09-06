import { PgBoss } from "pg-boss";

export const JOB_ADVANCE = "candidate.advance";

export type AdvanceJob = {
  candidateId: string;
  stage: string;
  inputVersion: number;
};

export async function createProducer(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    supervise: false,
    schedule: false,
    migrate: false,
  });
  await boss.start();
  await boss.createQueue(JOB_ADVANCE);
  return boss;
}

export function txAdapter(client: {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}): { executeSql: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> } {
  return {
    executeSql(text: string, values?: unknown[]) {
      return client.query(text, values);
    },
  };
}
