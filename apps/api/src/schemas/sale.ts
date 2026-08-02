import { z } from "zod";

const nullableId = z.string().trim().min(1).nullable().optional();

const productItemSchema = z.object({
  itemType: z.literal("PRODUCT"),
  productId: z.string().trim().min(1),
  serviceId: nullableId.refine((value) => value == null, {
    message: "Produto não pode ter serviço vinculado."
  }),
  quantity: z.coerce.number().int().positive().default(1)
});

const serviceItemSchema = z.object({
  itemType: z.literal("SERVICE"),
  serviceId: z.string().trim().min(1),
  productId: nullableId.refine((value) => value == null, {
    message: "Serviço não pode ter produto vinculado."
  }),
  quantity: z.coerce.number().int().positive().default(1)
});

function normalizeLegacySaleItem(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item = { ...(value as Record<string, unknown>) };
  const productId = typeof item.productId === "string" && item.productId.trim() ? item.productId.trim() : null;
  const serviceId = typeof item.serviceId === "string" && item.serviceId.trim() ? item.serviceId.trim() : null;

  item.productId = productId;
  item.serviceId = serviceId;
  if (item.itemType == null) {
    if (productId && !serviceId) item.itemType = "PRODUCT";
    if (serviceId && !productId) item.itemType = "SERVICE";
  }
  return item;
}

export const saleItemSchema = z.preprocess(
  normalizeLegacySaleItem,
  z.discriminatedUnion("itemType", [productItemSchema, serviceItemSchema])
);

export type SaleItemInput = z.infer<typeof saleItemSchema>;

export function normalizeSaleItems(items: unknown) {
  return z.array(saleItemSchema).min(1).parse(items);
}

