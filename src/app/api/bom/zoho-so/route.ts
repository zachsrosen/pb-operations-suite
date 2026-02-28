import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";
export const maxDuration = 60;

const ADMIN_LINE_ITEMS = new Set([
  "permit fees",
  "interconnection fees",
  "design engineering",
  "inventory no po",
]);

function normalizeLineToken(value: string | undefined | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAdminLineItem(name: string | undefined | null, sku: string | undefined | null): boolean {
  const normalizedName = normalizeLineToken(name);
  const normalizedSku = normalizeLineToken(sku);
  return ADMIN_LINE_ITEMS.has(normalizedName) || ADMIN_LINE_ITEMS.has(normalizedSku);
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = request.nextUrl;
  const soNumber = searchParams.get("so_number");
  const soNumbers = searchParams.get("so_numbers");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const perPage = parseInt(searchParams.get("per_page") ?? "200", 10);

  try {
    if (soNumber) {
      const so = await zohoInventory.getSalesOrder(soNumber);
      const lineItems = Array.isArray(so.line_items) ? so.line_items : [];
      const equipmentItems = lineItems.filter((li) => !isAdminLineItem(li.name, li.sku));

      return NextResponse.json({
        salesorder_number: so.salesorder_number,
        reference_number: so.reference_number,
        date: so.date,
        status: so.status,
        customer_name: so.customer_name,
        total: so.total,
        delivery_method: so.delivery_method,
        notes: so.notes,
        line_item_count: lineItems.length,
        equipment_count: equipmentItems.length,
        line_items: lineItems.map((li) => ({
          name: li.name,
          sku: li.sku,
          quantity: li.quantity,
          rate: li.rate,
          amount: li.amount,
          description: li.description,
        })),
        equipment_items: equipmentItems.map((li) => ({
          name: li.name,
          sku: li.sku,
          quantity: li.quantity,
          rate: li.rate,
          amount: li.amount,
        })),
      });
    }

    if (soNumbers) {
      const numbers = soNumbers
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      if (numbers.length > 50) {
        return NextResponse.json(
          { error: "Maximum 50 SO numbers per batch request" },
          { status: 400 }
        );
      }

      const results = await Promise.allSettled(
        numbers.map(async (num) => {
          const so = await zohoInventory.getSalesOrder(num);
          const lineItems = Array.isArray(so.line_items) ? so.line_items : [];
          const equipmentItems = lineItems.filter((li) => !isAdminLineItem(li.name, li.sku));

          return {
            salesorder_number: so.salesorder_number,
            reference_number: so.reference_number,
            date: so.date,
            customer_name: so.customer_name,
            total: so.total,
            delivery_method: so.delivery_method,
            line_item_count: lineItems.length,
            equipment_count: equipmentItems.length,
            equipment_items: equipmentItems.map((li) => ({
              name: li.name,
              sku: li.sku,
              quantity: li.quantity,
              rate: li.rate,
            })),
          };
        })
      );

      const salesorders = results.map((result, index) => ({
        so_number: numbers[index],
        ...(result.status === "fulfilled"
          ? { success: true, data: result.value }
          : {
              success: false,
              error: result.reason instanceof Error ? result.reason.message : "Unknown error",
            }),
      }));

      return NextResponse.json({
        total_requested: numbers.length,
        total_success: salesorders.filter((entry) => entry.success).length,
        total_failed: salesorders.filter((entry) => !entry.success).length,
        salesorders,
      });
    }

    if (search) {
      const result = await zohoInventory.searchSalesOrders(search, { page, perPage });
      return NextResponse.json({
        search,
        count: result.salesorders.length,
        has_more: result.hasMore,
        salesorders: result.salesorders,
      });
    }

    const result = await zohoInventory.listSalesOrders({
      page,
      perPage,
      sortColumn: "created_time",
      sortOrder: "D",
    });

    return NextResponse.json({
      page,
      count: result.salesorders.length,
      has_more: result.hasMore,
      salesorders: result.salesorders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
