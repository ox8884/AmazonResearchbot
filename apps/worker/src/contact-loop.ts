import type { Pool } from "@forge-ops/db";
import type { ContactTransport } from "@forge-ops/integrations/mail/transport";
import { drainContacts,recoverContactOutcomes } from "./contact-runner.ts";
export function createContactCycle(pool:Pool,transport:ContactTransport|null|(()=>Promise<ContactTransport|null>)):()=>Promise<void> {
  let recoveryNeeded=false;
  return async()=>{
    try {
      if(recoveryNeeded){await recoverContactOutcomes(pool);recoveryNeeded=false;}
      const activeTransport=typeof transport === "function" ? await transport() : transport;
      await drainContacts(pool,activeTransport);
    }catch(error){recoveryNeeded=true;throw error;}
  };
}
