import { getDealProperties } from "@/lib/hubspot";

const INSTALL_NOTIFICATION_PROPERTY_KEYS = [
  "expected_days_for_install",
  "days_for_installers",
  "days_for_electricians",
  "expected_installer_cont",
  "expected_electrician_count",
  "notes_for_install",
  "module_brand",
  "module_model",
  "module_count",
  "module_wattage",
  "inverter_brand",
  "inverter_model",
  "inverter_qty",
  "inverter_size_kwac",
  "battery_brand",
  "battery_model",
  "battery_count",
  "battery_size",
  "battery_expansion_count",
  "ev_count",
  "modules",
  "inverter",
  "battery",
  "battery_expansion",
  "expansion_model",
  "calculated_system_size__kwdc_",
  "system_size_kwac",
] as const;

export interface InstallNotificationDetails {
  forecastedInstallDays?: number;
  installerDays?: number;
  electricianDays?: number;
  installersCount?: number;
  electriciansCount?: number;
  installNotes?: string;
  equipmentSummary?: string;
}

function parseNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  const parsed = Number(str);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildModulesSummary(props: Record<string, unknown>): string | undefined {
  const count = parseNumber(props.module_count);
  const productName = parseText(props.modules);
  const brand = parseText(props.module_brand);
  const model = parseText(props.module_model);
  const wattage = parseNumber(props.module_wattage);

  const modelParts = [brand, model].filter(Boolean).join(" ").trim();
  const descriptor = productName || modelParts || undefined;
  if (!count && !descriptor && !wattage) return undefined;

  const pieces: string[] = [];
  if (count) pieces.push(`${formatDecimal(count)}x`);
  if (descriptor) pieces.push(descriptor);
  if (wattage) pieces.push(`${formatDecimal(wattage)}W`);

  return `Modules: ${pieces.join(" ").trim() || "Configured"}`;
}

function buildInverterSummary(props: Record<string, unknown>): string | undefined {
  const count = parseNumber(props.inverter_qty);
  const productName = parseText(props.inverter);
  const brand = parseText(props.inverter_brand);
  const model = parseText(props.inverter_model);
  const sizeKwac = parseNumber(props.inverter_size_kwac);

  const modelParts = [brand, model].filter(Boolean).join(" ").trim();
  const descriptor = productName || modelParts || undefined;
  if (!count && !descriptor && !sizeKwac) return undefined;

  const pieces: string[] = [];
  if (count) pieces.push(`${formatDecimal(count)}x`);
  if (descriptor) pieces.push(descriptor);
  if (sizeKwac) pieces.push(`${formatDecimal(sizeKwac)}kWac`);

  return `Inverter: ${pieces.join(" ").trim() || "Configured"}`;
}

function buildBatterySummary(props: Record<string, unknown>): string | undefined {
  const count = parseNumber(props.battery_count);
  const productName = parseText(props.battery);
  const brand = parseText(props.battery_brand);
  const model = parseText(props.battery_model);
  const sizeKwh = parseNumber(props.battery_size);
  const expansionCount = parseNumber(props.battery_expansion_count);
  const expansionProduct = parseText(props.battery_expansion);
  const expansionModel = parseText(props.expansion_model);

  const modelParts = [brand, model].filter(Boolean).join(" ").trim();
  const descriptor = productName || modelParts || undefined;
  if (!count && !descriptor && !sizeKwh && !expansionCount && !expansionProduct && !expansionModel) {
    return undefined;
  }

  const pieces: string[] = [];
  if (count) pieces.push(`${formatDecimal(count)}x`);
  if (descriptor) pieces.push(descriptor);
  if (sizeKwh) pieces.push(`${formatDecimal(sizeKwh)}kWh`);
  let summary = `Battery: ${pieces.join(" ").trim() || "Configured"}`;

  if (expansionCount || expansionProduct || expansionModel) {
    const expansionBits: string[] = [];
    if (expansionCount) expansionBits.push(`${formatDecimal(expansionCount)}x`);
    if (expansionProduct || expansionModel) {
      expansionBits.push([expansionProduct, expansionModel].filter(Boolean).join(" ").trim());
    }
    summary += ` (Expansions: ${expansionBits.join(" ").trim() || "Configured"})`;
  }

  return summary;
}

function buildEquipmentSummary(props: Record<string, unknown>): string | undefined {
  const lines: string[] = [];

  const modules = buildModulesSummary(props);
  if (modules) lines.push(modules);

  const inverter = buildInverterSummary(props);
  if (inverter) lines.push(inverter);

  const battery = buildBatterySummary(props);
  if (battery) lines.push(battery);

  const evCount = parseNumber(props.ev_count);
  if (evCount) {
    lines.push(`EV Chargers: ${formatDecimal(evCount)}`);
  }

  const systemSizeKwdc = parseNumber(props.calculated_system_size__kwdc_);
  const systemSizeKwac = parseNumber(props.system_size_kwac);
  if (systemSizeKwdc || systemSizeKwac) {
    const pieces: string[] = [];
    if (systemSizeKwdc) pieces.push(`${formatDecimal(systemSizeKwdc)}kWdc`);
    if (systemSizeKwac) pieces.push(`${formatDecimal(systemSizeKwac)}kWac`);
    lines.push(`System Size: ${pieces.join(" / ")}`);
  }

  if (lines.length === 0) return undefined;
  return lines.join("\n");
}

export async function getInstallNotificationDetails(
  dealId: string
): Promise<{ details?: InstallNotificationDetails; warning?: string }> {
  try {
    const props = await getDealProperties(dealId, [...INSTALL_NOTIFICATION_PROPERTY_KEYS]);
    if (!props) {
      return { warning: "Install detail lookup failed (HubSpot read returned no data)" };
    }

    const details: InstallNotificationDetails = {
      forecastedInstallDays: parseNumber(props.expected_days_for_install),
      installerDays: parseNumber(props.days_for_installers),
      electricianDays: parseNumber(props.days_for_electricians),
      installersCount: parseNumber(props.expected_installer_cont),
      electriciansCount: parseNumber(props.expected_electrician_count),
      installNotes: parseText(props.notes_for_install),
      equipmentSummary: buildEquipmentSummary(props),
    };

    if (
      details.forecastedInstallDays == null &&
      details.installerDays == null &&
      details.electricianDays == null &&
      details.installersCount == null &&
      details.electriciansCount == null &&
      !details.installNotes &&
      !details.equipmentSummary
    ) {
      return {};
    }

    return { details };
  } catch (error) {
    return {
      warning: `Install detail lookup failed (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
