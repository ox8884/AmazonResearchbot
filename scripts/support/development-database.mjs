export async function assertDevelopmentDatabase(db){
 const names=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
 if(names.includes('deployment_identity')){
  const identities=(await db.query('SELECT environment FROM public.deployment_identity')).rows;
  if(identities.length!==1||identities[0].environment!=='development')throw new Error('LOCAL_DEVELOPMENT_DATABASE_REQUIRED');
 }else if(names.length){
  const freshJournal=names.length===1&&names[0]==='schema_migrations'&&(await db.query('SELECT count(*)::int AS n FROM public.schema_migrations')).rows[0].n===0;
  if(!freshJournal)throw new Error('LOCAL_DEVELOPMENT_DATABASE_REQUIRED');
 }
}
