import { enums } from "google-ads-api";

export type JsonRecord = Record<string, unknown>;

export function escapeGaql(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function quoteGaql(value: string) {
  return `'${escapeGaql(value)}'`;
}

export function buildGaqlQuery(params: {
  fields: string[];
  resource: string;
  conditions?: string[];
  orderings?: string[];
  limit?: number;
}) {
  let query = `SELECT ${params.fields.join(", ")} FROM ${params.resource}`;
  if (params.conditions?.length) {
    query += ` WHERE ${params.conditions.join(" AND ")}`;
  }
  if (params.orderings?.length) {
    query += ` ORDER BY ${params.orderings.join(", ")}`;
  }
  if (params.limit) {
    query += ` LIMIT ${params.limit}`;
  }
  return query;
}

export function enumValue<T extends Record<string, string | number>>(
  enumObj: T,
  value: string | number | undefined,
  fallback?: string | number
) {
  if (value == null) return fallback;
  if (typeof value === "number") return value;
  return (enumObj[value as keyof T] as number | undefined) ?? fallback ?? value;
}

export function enumName<T extends Record<string, string | number>>(
  enumObj: T,
  value: unknown
) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return (enumObj as Record<number, string>)[value] ?? String(value);
  }
  return String(value);
}

export function normalizeEnumFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeEnumFields);
  if (!value || typeof value !== "object") return value;

  const obj = value as JsonRecord;
  const normalized: JsonRecord = {};
  for (const [key, fieldValue] of Object.entries(obj)) {
    normalized[key] = normalizeEnumFields(fieldValue);
  }
  return normalized;
}

export function toResourceName(customerId: string, collection: string, idOrName: string) {
  if (idOrName.startsWith("customers/")) return idOrName;
  return `customers/${customerId}/${collection}/${idOrName}`;
}

export function customerScopedConstant(prefix: string, idOrName: string) {
  if (idOrName.includes("/")) return idOrName;
  return `${prefix}/${idOrName}`;
}

export function extractResourceNames(value: unknown): string[] {
  const names = new Set<string>();

  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = node as JsonRecord;
    const rn = obj.resource_name ?? obj.resourceName;
    if (typeof rn === "string") names.add(rn);
    for (const child of Object.values(obj)) visit(child);
  }

  visit(value);
  return Array.from(names);
}

export function extractRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as JsonRecord;
  if (typeof obj.request_id === "string") return obj.request_id;
  if (typeof obj.requestId === "string") return obj.requestId;
  return undefined;
}

export function statusEnumForResource(resource: "campaign" | "ad_group" | "ad_group_ad") {
  if (resource === "campaign") return enums.CampaignStatus;
  if (resource === "ad_group") return enums.AdGroupStatus;
  return enums.AdGroupAdStatus;
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
