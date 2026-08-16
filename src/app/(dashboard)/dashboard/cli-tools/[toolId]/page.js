import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getMachineId } from "@/shared/utils/machine";
import { isLocalRequest } from "@/dashboardGuard";
import ToolDetailClient from "./ToolDetailClient";

export default async function ToolDetailPage({ params }) {
  const { toolId } = await params;
  if (!CLI_TOOLS[toolId]) notFound();
  const [machineId, requestHeaders] = await Promise.all([getMachineId(), headers()]);
  const canManageLocalSettings = isLocalRequest({ headers: requestHeaders });
  return <ToolDetailClient toolId={toolId} machineId={machineId} canManageLocalSettings={canManageLocalSettings} />;
}
