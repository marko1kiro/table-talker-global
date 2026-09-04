import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";

export type AdminManagerRow = {
  id: string;
  idManager: string;
  fullName: string;
  restaurantId: string;
  restaurantName: string;
  restaurantCode: string;
  status: string;
  createdAt: string;
};

export const listManagers = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: true; managers: AdminManagerRow[] } | { ok: false; error: string }> => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, error: "Tidak dapat memuat data manager." };
    const { data, error } = await client
      .from("manager_accounts")
      .select(
        "id, id_manager, full_name, restaurant_id, status, created_at, restaurants(display_name, code)",
      )
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: "Tidak dapat memuat data manager." };
    const managers = (data ?? []).map((row) => {
      const r = row as unknown as Record<string, unknown>;
      const resto = (r.restaurants ?? {}) as Record<string, unknown>;
      return {
        id: String(r.id),
        idManager: String(r.id_manager),
        fullName: String(r.full_name),
        restaurantId: String(r.restaurant_id),
        restaurantName: String(resto.display_name ?? ""),
        restaurantCode: String(resto.code ?? ""),
        status: String(r.status),
        createdAt: String(r.created_at),
      };
    });
    return { ok: true, managers };
  },
);

export const disableManager = createServerFn({ method: "POST" })
  .validator(z.object({ managerId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, error: "Tidak dapat mengubah data manager." };
    const { error: sessionError } = await client
      .from("manager_sessions")
      .delete()
      .eq("manager_id", data.managerId);
    if (sessionError) return { ok: false, error: "Tidak dapat mengubah data manager." };
    const { error } = await client
      .from("manager_accounts")
      .update({ status: "nonaktif", updated_at: new Date().toISOString() })
      .eq("id", data.managerId);
    if (error) return { ok: false, error: "Tidak dapat mengubah data manager." };
    return { ok: true };
  });
