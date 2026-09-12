import type { FastifyInstance } from "fastify";
import type { Pool, QueryConnection } from "@forge-ops/db";
import { reservationView, type LaunchCashReservationRow, type OrderPacketRow } from "./order-store.ts";
import { cancelOrderPacketInput, orderParams } from "./order-schema.ts";
export type CancelOrderPacketResult =
  | { released: true; reused?: boolean; reservation: ReturnType<typeof reservationView> }
  | { released: false; code: string };

export async function cancelOrderPacket(
  db: QueryConnection,
  packetId: string,
  userId: string,
  note: string,
): Promise<CancelOrderPacketResult> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.launch_cash'))");
  const packets = await db.query<OrderPacketRow>(
    `SELECT p.*,a.status AS approval_status
     FROM order_packets p LEFT JOIN approvals a ON a.id=p.approval_id
     WHERE p.id=$1 FOR UPDATE OF p`,
    [packetId],
  );
  const packet = packets.rows[0];
  if (!packet) return { released: false, code: "NOT_FOUND" };
  const reservations = await db.query<LaunchCashReservationRow>(
    "SELECT * FROM launch_cash_reservations WHERE order_packet_id=$1 FOR UPDATE",
    [packet.id],
  );
  const reservation = reservations.rows[0];
  if (!reservation) return { released: false, code: "NO_ACTIVE_RESERVATION" };
  if (reservation.state === "released")
    return { released: true, reused: true, reservation: reservationView(reservation) };
  if (packet.state !== "recorded")
    return { released: false, code: "NO_ACTIVE_RESERVATION" };
  const released = await db.query<LaunchCashReservationRow>(
    `UPDATE launch_cash_reservations
     SET state='released',released_at=now(),released_by=$2,release_note=$3
     WHERE id=$1 AND state='active' RETURNING *`,
    [reservation.id, userId, note],
  );
  const saved = released.rows[0];
  if (!saved) return { released: false, code: "NO_ACTIVE_RESERVATION" };
  await db.query("UPDATE order_packets SET state='cancelled' WHERE id=$1", [
    packet.id,
  ]);
  await db.query(
    "INSERT INTO audit_events(actor,action,target,approval_hash,meta) VALUES($1,'launch_cash_reservation_released',$2,$3,$4::jsonb)",
    [
      userId,
      saved.id,
      packet.payload_hash,
      JSON.stringify({ packetId: packet.id, note }),
    ],
  );
  return { released: true, reservation: reservationView(saved) };
}

export function registerOrderCancellation(app: FastifyInstance, pool: Pool) {
  app.post("/api/order-packets/:id/cancel", async (request, reply) => {
    const value = Reflect.get(request, "userId");
    const userId = typeof value === "string" ? value : undefined;
    if (!userId) return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const params = orderParams.safeParse(request.params);
    const body = cancelOrderPacketInput.safeParse(request.body);
    if (!params.success || !body.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "A cancellation note is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await cancelOrderPacket(
        client,
        params.data.id,
        userId,
        body.data.note,
      );
      await client.query("COMMIT");
      if (!result.released)
        return reply
          .status(result.code === "NOT_FOUND" ? 404 : 409)
          .send({ code: result.code, message: "No active cash reservation" });
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
