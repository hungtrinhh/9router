import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getMachineId } from "@/shared/utils/machine";
import { isLocalRequest } from "@/dashboardGuard";
import ToolDetailClient from "./ToolDetailClient";

export default async function ToolDetailPage({ params }) {
  const { toolId } = await params;
  if (!CLI_TOOLS[toolId]) notFound();
  const [machineId] = await Promise.all([getMachineId()]);
  return <ToolDetailClient toolId={toolId} machineId={machineId} canManageLocalSettings={true} />;
}
