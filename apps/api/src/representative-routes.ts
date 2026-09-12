import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { JOB_ADVANCE, txAdapter } from "./queue.ts";
import {readMarketSource} from './market-source-store.ts';

const paramsSchema = z.object({ id: z.uuid() });
const selectionSchema = z.object({
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  inputVersion: z.number().int().positive(),
}).strict();
type RepresentativeView = {
  readonly inputVersion: number;
  readonly selectedAsin: string | null;
  readonly availableAsins: readonly string[];
  readonly editable: boolean;
  readonly titles?: Readonly<Record<string,string>>;
};

async function readRepresentative(db: Pick<Pool, "query">, id: string,key:Buffer): Promise<RepresentativeView | undefined> {
  const view=(await db.query<RepresentativeView&{settingsVersion:number}>(`
    SELECT c.input_version AS "inputVersion",(SELECT max(version) FROM settings_versions) AS "settingsVersion",
      (SELECT detail->>'representativeAsin' FROM candidate_events
       WHERE candidate_id=c.id AND input_version<=c.input_version AND stage='api_validation'
         AND detail->>'representativeAsin' ~ '^[A-Z0-9]{10}$'
       ORDER BY input_version DESC, id DESC LIMIT 1) AS "selectedAsin",
      ARRAY(SELECT DISTINCT substring(e.field from ':([A-Z0-9]{10})$') FROM evidence e
        WHERE e.candidate_id=c.id AND e.input_version=c.input_version
          AND e.settings_version=(SELECT max(version) FROM settings_versions)
          AND e.field ~ '^api_catalog_(dimensions|weight):[A-Z0-9]{10}$'
          AND e.source_id LIKE 'api-validation-source:%' ORDER BY 1) AS "availableAsins",
      (c.stage IN ('api_validation','sourcing','rejected')
        AND NOT EXISTS(SELECT 1 FROM spec_revisions WHERE candidate_id=c.id)) AS editable
    FROM candidates c WHERE c.id=$1`, [id])).rows[0];
  if(!view)return undefined;
  const market=await readMarketSource(db,id,key);
  const observed=market.state==='captured'&&market.inputVersion===view.inputVersion&&market.settingsVersion===view.settingsVersion
    ?market.observation.slots.flatMap(slot=>slot.adStatus==='not_marked'&&slot.asin&&slot.title?[{asin:slot.asin,title:slot.title}]:[]):[];
  const names=new Map<string,Set<string>>();
  for(const row of observed){const values=names.get(row.asin)??new Set<string>();values.add(row.title);names.set(row.asin,values);}
  const titles=Object.fromEntries([...names].flatMap(([asin,values])=>values.size===1?[[asin,[...values][0]??'']]:[]));
  return {inputVersion:view.inputVersion,selectedAsin:view.selectedAsin,editable:view.editable,availableAsins:[...new Set([...view.availableAsins,...observed.map(row=>row.asin)])].sort(),titles};
}

export function registerRepresentativeRoutes(app: FastifyInstance, pool: Pool, boss: PgBoss,key:Buffer) {
  app.get('/api/candidates/:id/representative', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: 'INVALID_CANDIDATE' });
    const view = await readRepresentative(pool, params.data.id,key);
    return view ?? reply.status(404).send({ code: 'NOT_FOUND' });
  });
  app.post('/api/candidates/:id/representative', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = selectionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ code: 'INVALID_SELECTION' });
    const actor = 'userId' in request && typeof request.userId === 'string' ? request.userId : null;
    if (!actor) return reply.status(401).send({ code: 'UNAUTHENTICATED' });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
      await db.query('SELECT id FROM candidates WHERE id=$1 FOR UPDATE', [params.data.id]);
      const view = await readRepresentative(db, params.data.id,key);
      if (!view || view.inputVersion !== body.data.inputVersion) {
        await db.query('ROLLBACK');
        return reply.status(view ? 409 : 404).send({ code: view ? 'CANDIDATE_CHANGED' : 'NOT_FOUND' });
      }
      if (view.selectedAsin === body.data.asin) {
        await db.query('COMMIT');
        return view;
      }
      if (!view.editable || !view.availableAsins.includes(body.data.asin)) {
        await db.query('ROLLBACK');
        return reply.status(409).send({ code: view.editable ? 'ASIN_EVIDENCE_REQUIRED' : 'SOURCING_ALREADY_STARTED' });
      }
      const inputVersion = view.inputVersion + 1;
      await db.query("UPDATE candidates SET input_version=$2,stage='api_validation',blocked_reason=NULL,last_progress_at=now() WHERE id=$1", [params.data.id, inputVersion]);
      await db.query('UPDATE evaluations SET stale=true WHERE candidate_id=$1', [params.data.id]);
      const event = (await db.query<{ id: string }>(`
        INSERT INTO candidate_events(candidate_id,stage,input_version,detail)
        VALUES($1,'api_validation',$2,$3::jsonb) RETURNING id`,
        [params.data.id, inputVersion, JSON.stringify({ representativeAsin: body.data.asin, previousInputVersion: view.inputVersion, actor })])).rows[0];
      if (!event) throw new Error('Representative event could not be saved');
      await db.query(`INSERT INTO evidence(candidate_id,field,kind,reason,source_id)
        SELECT $1,field,'unknown','Representative product evidence needs confirmation',$2
        FROM unnest(ARRAY['standard_size','differentiation']) AS field`, [params.data.id, 'candidate-event:' + event.id]);
      await db.query("INSERT INTO audit_events(actor,action,target) VALUES($1,'representative_asin_selected',$2)", [actor, params.data.id]);
      const job = await boss.send(JOB_ADVANCE, { candidateId: params.data.id, stage: 'api_validation', inputVersion }, { db: txAdapter(db) });
      if (!job) throw new Error('Representative revalidation could not be queued');
      await db.query('COMMIT');
      return { inputVersion, selectedAsin: body.data.asin };
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  });
}
