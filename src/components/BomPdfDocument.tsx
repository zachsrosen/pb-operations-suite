// src/components/BomPdfDocument.tsx
// Server-only — used exclusively by /api/bom/export-pdf, never imported client-side
import React from "react";
import {
  Document, Page, Text, View, StyleSheet,
} from "@react-pdf/renderer";

type BomData = {
  project: {
    customer?: string; address?: string;
    systemSizeKwdc?: number | string; systemSizeKwac?: number | string;
    moduleCount?: number | string; plansetRev?: string; stampDate?: string;
    utility?: string; ahj?: string;
  };
  items: Array<{
    category: string; brand: string | null; model: string | null;
    description: string; qty: number | string;
    unitSpec?: string | number | null; unitLabel?: string | null;
  }>;
  validation?: {
    moduleCountMatch?: boolean | null;
    batteryCapacityMatch?: boolean | null;
    ocpdMatch?: boolean | null;
    warnings?: string[];
  };
};

const CATEGORY_ORDER = [
  "MODULE", "BATTERY", "INVERTER", "EV_CHARGER",
  "RAPID_SHUTDOWN", "RACKING", "ELECTRICAL_BOS", "MONITORING",
];
const CATEGORY_LABELS: Record<string, string> = {
  MODULE: "Modules", BATTERY: "Storage", INVERTER: "Inverter",
  EV_CHARGER: "EV Charger", RAPID_SHUTDOWN: "Rapid Shutdown",
  RACKING: "Racking & Mounting", ELECTRICAL_BOS: "Electrical BOS",
  MONITORING: "Monitoring",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 36, color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16, borderBottomWidth: 2, borderBottomColor: "#0891b2", paddingBottom: 10 },
  headerLeft: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#0891b2" },
  subtitle: { fontSize: 10, color: "#555", marginTop: 2 },
  meta: { fontSize: 8, color: "#777", marginTop: 6 },
  sectionHeader: { backgroundColor: "#f0f9ff", paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8, marginTop: 10, marginBottom: 2 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, color: "#0891b2" },
  table: { borderWidth: 1, borderColor: "#e5e7eb" },
  tableHeader: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, paddingTop: 3, paddingRight: 5, paddingBottom: 3, paddingLeft: 5, color: "#6b7280" },
  td: { fontSize: 8, paddingTop: 3, paddingRight: 5, paddingBottom: 3, paddingLeft: 5, color: "#1a1a1a" },
  colBrand: { width: "18%" }, colModel: { width: "22%" },
  colDesc: { width: "38%" }, colQty: { width: "8%" }, colSpec: { width: "14%" },
  validation: { flexDirection: "row", flexWrap: "wrap", marginTop: 12, padding: 8, backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb" },
  validBadge: { fontSize: 8, paddingTop: 2, paddingRight: 6, paddingBottom: 2, paddingLeft: 6, borderRadius: 4, marginRight: 6, marginBottom: 6 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#aaa" },
});

function validLabel(v: boolean | null | undefined): string {
  if (v === true) return "Pass";
  if (v === false) return "Fail";
  return "N/A";
}

export function BomPdfDocument({
  bom, dealName, version, generatedBy, generatedAt,
}: {
  bom: BomData;
  dealName?: string;
  version?: number;
  generatedBy?: string;
  generatedAt: string;
}) {
  const { project, items, validation } = bom;
  const grouped = CATEGORY_ORDER.reduce<Record<string, typeof items>>((acc, cat) => {
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length) acc[cat] = catItems;
    return acc;
  }, {});

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Planset BOM</Text>
            <Text style={styles.subtitle}>{project.customer ?? dealName ?? "—"}</Text>
            {project.address && <Text style={styles.meta}>{project.address}</Text>}
            <Text style={styles.meta}>
              {[
                project.moduleCount && `${project.moduleCount} modules`,
                project.systemSizeKwdc && `${project.systemSizeKwdc} kWdc`,
                project.systemSizeKwac && `${project.systemSizeKwac} kWac`,
              ].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <View>
            {project.plansetRev && <Text style={styles.meta}>Rev {project.plansetRev}</Text>}
            {project.stampDate && <Text style={styles.meta}>Stamped {project.stampDate}</Text>}
            {version && <Text style={styles.meta}>v{version}</Text>}
          </View>
        </View>

        {/* BOM Sections */}
        {CATEGORY_ORDER.filter((cat) => grouped[cat]).map((cat) => (
          <View key={cat}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{CATEGORY_LABELS[cat] ?? cat}</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.colBrand]}>Brand</Text>
                <Text style={[styles.th, styles.colModel]}>Model</Text>
                <Text style={[styles.th, styles.colDesc]}>Description</Text>
                <Text style={[styles.th, styles.colQty]}>Qty</Text>
                <Text style={[styles.th, styles.colSpec]}>Spec</Text>
              </View>
              {grouped[cat].map((item, i) => (
                <View key={i} style={[styles.tableRow, i % 2 === 1 ? { backgroundColor: "#fafafa" } : {}]}>
                  <Text style={[styles.td, styles.colBrand]}>{item.brand ?? "—"}</Text>
                  <Text style={[styles.td, styles.colModel]}>{item.model ?? "—"}</Text>
                  <Text style={[styles.td, styles.colDesc]}>{item.description}</Text>
                  <Text style={[styles.td, styles.colQty]}>{String(item.qty)}</Text>
                  <Text style={[styles.td, styles.colSpec]}>
                    {item.unitSpec != null ? `${item.unitSpec}${item.unitLabel ? ` ${item.unitLabel}` : ""}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* Validation */}
        {validation && (
          <View style={styles.validation}>
            <Text style={[styles.validBadge, { backgroundColor: validation.moduleCountMatch ? "#dcfce7" : "#fee2e2" }]}>
              {validLabel(validation.moduleCountMatch)} Module count
            </Text>
            <Text style={[styles.validBadge, { backgroundColor: validation.batteryCapacityMatch ? "#dcfce7" : validation.batteryCapacityMatch === false ? "#fee2e2" : "#f3f4f6" }]}>
              {validLabel(validation.batteryCapacityMatch)} Battery kWh
            </Text>
            <Text style={[styles.validBadge, { backgroundColor: validation.ocpdMatch ? "#dcfce7" : validation.ocpdMatch === false ? "#fee2e2" : "#f3f4f6" }]}>
              {validLabel(validation.ocpdMatch)} OCPD
            </Text>
            {validation.warnings?.map((w, i) => (
              <Text key={i} style={[styles.validBadge, { backgroundColor: "#fef9c3" }]}>Warning: {w}</Text>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Generated by PB Ops · {generatedAt}</Text>
          <Text>{generatedBy ?? ""}</Text>
        </View>
      </Page>
    </Document>
  );
}
