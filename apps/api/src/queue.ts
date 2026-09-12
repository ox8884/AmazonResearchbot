import { PgBoss } from "pg-boss";

export const JOB_ADVANCE = "candidate.advance";

export type AdvanceJob = {
  candidateId: string;
  stage: string;
  inputVersion: number;
};

export async function createProducer(connectionString: string, appEnv: "development" | "production"): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    supervise: false,
    schedule: false,
    migrate: false,
  });
  try {
    await boss.start();
    if(appEnv === "development")await boss.createQueue(JOB_ADVANCE);
    else if(!await boss.getQueue(JOB_ADVANCE))throw new Error("Queue migration is required before startup");
    return boss;
  } catch(error) {
    await boss.stop({graceful:false,timeout:2000});
    throw error;
  }
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
