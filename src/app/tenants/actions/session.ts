"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/authentication/session";

export async function signOutTenant(): Promise<never> {
  await destroySession("tenant");
  redirect("/tenants/login");
}
