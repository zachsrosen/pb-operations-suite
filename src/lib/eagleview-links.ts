/**
 * Build EagleView web-interface links from a report ID (RID).
 *
 * Requested in Freshservice tickets cmpx1kied… ("Create link to open True
 * Design") and cmpx4lzio… ("EVTD Order Details Page"). Returns null when there
 * is no real RID yet (null / empty / "pending:" placeholder).
 */
export interface EagleViewLinks {
  trueDesign: string;
  orderPage: string;
}

export function eagleViewLinks(reportId: string | null | undefined): EagleViewLinks | null {
  if (!reportId || reportId.startsWith("pending:")) return null;
  return {
    trueDesign: `https://apps.eagleview.com/truedesign/${reportId}`,
    orderPage: `https://apps.eagleview.com/myev/orders/report/${reportId}`,
  };
}
