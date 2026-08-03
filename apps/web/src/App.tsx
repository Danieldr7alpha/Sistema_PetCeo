import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Clock3, CreditCard, Eye, Lock, Pencil, Plus, Search, Tag, Trash2, XCircle } from "lucide-react";
import { Layout } from "./components/Layout";
import { Modal } from "./components/Modal";
import { ApiError, api, checkConnection, currency, dateBR, type ConnectionFailure, type Session } from "./lib/api";
import { pendingOperations } from "./lib/offline";

type Gender = "MALE" | "FEMALE" | "OTHER" | "UNINFORMED";
type PetStatus = "ACTIVE" | "INACTIVE" | "DECEASED";
type Customer = {
  id: string; internalCode?: number; matchedPetId?: string; matchedPetName?: string; name: string; cpf: string; gender: Gender; customGender?: string; phone: string;
  zipCode?: string; street?: string; number?: string; complement?: string; neighborhood?: string; city?: string; state?: string;
  pets: Pet[]; memberships?: Membership[];
};
type Pet = {
  id: string; name: string; species: string; customSpecies?: string; breed?: string; gender?: string; size?: string; color?: string;
  weight?: string; birthDate?: string; vaccinesStatus?: string; notes?: string; status: PetStatus; isPrimary: boolean;
};
type PetDraft = {
  name: string; species: string; customSpecies: string; breed: string; gender: string; size: string; color: string;
  weight: string; birthDate: string; vaccinesStatus: string; notes: string; status: PetStatus;
};
type Service = { id: string; internalCode?: number; catalogCode?: number; legacyInternalCode?: number; name: string; category?: string; categoryId?: string; petSize?: string; coat?: string; price: string; costEstimate?: string; estimatedMinutes: number; desiredMargin?: string; active: boolean; notes?: string };
type Product = { id: string; internalCode?: number; catalogCode?: number; legacyInternalCode?: number; name: string; category?: string; categoryId?: string; sku?: string; barcode?: string; brand?: string; brandId?: string; supplier?: string; supplierId?: string; salePrice: string; costPrice?: string; desiredMargin?: string; stock: number | string; minStock?: number | string; unit?: string; allowNegativeStock?: boolean; active: boolean; notes?: string };
type MembershipUsage = { id: string; status: "RESERVED" | "CONSUMED" | "RELEASED"; usageNumber?: number | null; balanceBefore: number; balanceAfter?: number | null; reservedAt: string; consumedAt?: string | null; releasedAt?: string | null };
type MembershipRenewal = { id: string; status: "PENDING_PAYMENT" | "PAID" | "CANCELLED"; priceSnapshot: number | string; plan: Plan; membershipId?: string | null };
type AppointmentExtraService = { id: string; serviceId: string; nameSnapshot: string; priceSnapshot: number | string; service?: Service };
type Appointment = { id: string; date: string; startTime: string; endTime?: string; notes?: string; status: string; paymentStatus: string; paymentMode?: "AVULSO" | "PACKAGE" | "RENEWAL_AT_CHECKOUT"; membershipId?: string | null; membership?: Membership | null; membershipUsage?: MembershipUsage | null; membershipRenewal?: MembershipRenewal | null; extraServices?: AppointmentExtraService[]; customer: Customer; pet: Pet; service: Service; sales?: { id: string; internalCode?: number; status?: string; total?: number | string; pendingAmount?: number | string }[] };
type Plan = { id: string; name: string; usageQuantity: number; validityDays: number; suggestedFrequencyDays: number; price: string; active: boolean; service: Service };
type Membership = { id: string; startDate: string; endDate: string; totalUses: number; remainingUses: number; usedUses: number; status: string; customer: Customer; pet: Pet; plan: Plan; usages?: { id: string }[]; reservedUses?: number; availableUses?: number; usable?: boolean; unavailableReason?: "EXPIRED" | "INACTIVE" | "PENDING_PAYMENT" | "NO_BALANCE" | null };
type SaleStatus = "WAITING_PAYMENT" | "PARTIALLY_PAID" | "PENDING" | "PAID" | "CANCELLED" | "REFUNDED";
type PaymentMethod = "PIX" | "CASH" | "DEBIT" | "CREDIT" | "TRANSFER" | "VOUCHER" | "OTHER";
type SaleItem = { id?: string; itemType: "SERVICE" | "PRODUCT"; serviceId?: string | null; productId?: string | null; description: string; quantity: number; unitPrice: number | string; total: number | string; coveredByMembership?: boolean; service?: Service; product?: Product };
type SalePayment = { id?: string; method: PaymentMethod; amount: number | string; paymentMethodNameSnapshot?: string | null; institutionNameSnapshot?: string | null; grossAmount?: number | string | null; feeAmount?: number | string | null; netAmount?: number | string | null; expectedSettlementDate?: string | null; cardBrand?: string | null; cardNsu?: string | null; cardAuthorization?: string | null; installments?: number | null; pixReference?: string | null; cashReceived?: number | string | null; changeAmount?: number | string | null; paidAt?: string };
type SalesReceipt = { id: string; receiptCode: number; saleId: string; companyNameSnapshot: string; companyDocumentSnapshot?: string | null; customerCodeSnapshot?: number | null; customerNameSnapshot?: string | null; petNameSnapshot?: string | null; operatorNameSnapshot?: string | null; itemsSnapshot: { itemType: "PRODUCT" | "SERVICE"; catalogCode?: number | null; description: string; quantity: number; unitPrice: number; total: number; coveredByMembership?: boolean }[]; paymentsSnapshot: { method: PaymentMethod; amount: number; paymentMethodNameSnapshot?: string | null; institutionNameSnapshot?: string | null; grossAmount?: number | null; feeAmount?: number | null; netAmount?: number | null; expectedSettlementDate?: string | null; cardBrand?: string | null; cardNsu?: string | null; cardAuthorization?: string | null; installments?: number | null; pixReference?: string | null; cashReceived?: number | null; changeAmount?: number | null; paidAt?: string }[]; subtotal: number | string; discount: number | string; total: number | string; paidAmount: number | string; issuedAt: string; status: string };
type Sale = { id: string; internalCode?: number; cashSessionId?: string | null; preSaleId?: string | null; customer?: Customer | null; pet?: Pet | null; appointment?: Appointment | null; appointmentId?: string | null; origin: "AGENDA" | "DIRECT" | "PRE_SALE"; status: SaleStatus; paymentMethod?: PaymentMethod | null; paymentStatus?: string; subtotal: number | string; discount: number | string; discountType?: "VALUE" | "PERCENT"; discountPercent?: number | string | null; total: number | string; paidAmount?: number | string; pendingAmount?: number | string; pendingReason?: string | null; pendingNotes?: string | null; pendingSince?: string | null; expectedPaymentDate?: string | null; cancelReason?: string | null; cardBrand?: string | null; cardNsu?: string | null; cardAuthorization?: string | null; operatorName?: string | null; paidAt?: string | null; cancelledAt?: string | null; createdAt: string; payments?: SalePayment[]; items: SaleItem[]; receipt?: SalesReceipt | null };
type CustomerHistoryItem = { id: string; saleId?: string | null; createdAt: string; title: string; description?: string; amount?: string };
type CustomerDetailData = Customer & { histories: CustomerHistoryItem[]; sales: Sale[] };
type ReceiptDetailSale = Sale & { cashSession?: CashSession | null };
type ReceivableSalesPage = { items: Sale[]; page: number; pageSize: number; total: number; totalPages: number; summary?: { total: number; paid: number; pending: number } };
type OrderNotice = { title: string; message: string; details?: string[]; notFound?: boolean };
type SaleItemForm = { itemType: "SERVICE" | "PRODUCT"; serviceId?: string | null; productId?: string | null; description: string; quantity: number; unitPrice: number; code?: string; coveredByMembership?: boolean };

function normalizeSaleItemPayload(item: SaleItemForm) {
  if (item.itemType === "SERVICE" && item.serviceId) {
    return { itemType: "SERVICE" as const, serviceId: item.serviceId, productId: null, quantity: item.quantity };
  }
  if (item.itemType === "PRODUCT" && item.productId) {
    return { itemType: "PRODUCT" as const, productId: item.productId, serviceId: null, quantity: item.quantity };
  }
  throw new Error("O pedido contém um item sem produto ou serviço vinculado.");
}
type PaymentForm = { method: PaymentMethod; financialPaymentMethodId?: string; amountCents: string; cardBrand: string; cardNsu: string; cardAuthorization: string; installments: string };
type PosPaymentMethod = "CASH" | "PIX" | "DEBIT" | "CREDIT";
type PosPaymentForm = PaymentForm & { method: PosPaymentMethod; cashReceivedCents: string };
type CashMovementType = "CASH_IN" | "CASH_OUT" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";
type CashMovement = { id: string; internalCode?: number; type: CashMovementType; amount: number | string; reason: string; notes?: string; originAccount?: string | null; destinationAccount?: string | null; transferId?: string | null; operatorName?: string; createdAt: string };
type CashSession = { id: string; internalCode?: number; status: "OPEN" | "CLOSED"; openedByName?: string; closedByName?: string; openingAmount: number | string; closingCashAmount?: number | string | null; expectedCashAmount?: number | string | null; difference?: number | string | null; differenceReason?: string | null; notes?: string | null; openedAt: string; closedAt?: string | null; movements?: CashMovement[] };
type CashCurrent = { session: CashSession | null };
type CashSummary = { session: CashSession; sales: Sale[]; totalsByMethod: Record<PaymentMethod, number>; pendingTotal: number; cancelledTotal: number; discountsTotal: number; cashIn: number; cashOut: number; totalReceived: number; expectedCash: number };
type CashPaymentDetail = { id: string; method: PaymentMethod; amount: number; cardBrand?: string | null; cardNsu?: string | null; installments?: number | null; pixReference?: string | null; cashReceived?: number | null; changeAmount?: number | null; paidAt: string; saleCode?: number | null; receiptCode?: number | null; customerName: string; petName?: string | null; operatorName: string };
type CashReport = { totalsByMethod: Record<PaymentMethod, number>; totalReceived: number; pendingTotal: number; cancelledTotal: number; discountsTotal: number; paymentDetails: CashPaymentDetail[]; byOperator: { name: string; total: number }[]; byService: { name: string; total: number }[]; byProduct: { name: string; total: number }[]; byHour: { hour: string; total: number }[] };
type PreSaleStatus = "OPEN" | "CONVERTED" | "EXPIRED" | "CANCELLED";
type PreSaleItem = SaleItem & { preSaleId?: string };
type PreSale = { id: string; internalCode?: number; customer?: Customer | null; pet?: Pet | null; operatorName?: string | null; status: PreSaleStatus; expiresAt?: string | null; subtotal: number | string; discount: number | string; total: number | string; notes?: string | null; convertedSaleId?: string | null; createdAt: string; items: PreSaleItem[] };
type ReusableOption = { id: string; name: string; active: boolean };
type ProductOptions = { categories: ReusableOption[]; brands: ReusableOption[]; suppliers: ReusableOption[]; serviceCategories: ReusableOption[] };
type CatalogModalState = { type: "product"; mode: "create" | "view" | "edit"; item?: Product; adminPassword?: string } | { type: "service"; mode: "create" | "view" | "edit"; item?: Service; adminPassword?: string };
type AdminCatalogAction = { action: "edit" | "inactive"; type: "product"; item: Product } | { action: "edit" | "inactive"; type: "service"; item: Service };
type ReusableKind = "product-category" | "product-brand" | "supplier" | "service-category";
type ReusableEditTarget = { kind: ReusableKind; label: string; option: ReusableOption };
type ConnectionState = "UNKNOWN" | "CHECKING" | "ONLINE" | "OFFLINE" | "SYNCING";
type FinancialAccount = { id: string; name: string; type: "CASH_DRAWER" | "CHECKING_ACCOUNT" | "SAVINGS_ACCOUNT" | "DIGITAL_ACCOUNT" | "PAYMENT_WALLET" | "OTHER"; institutionName?: string | null; openingBalance: number | string; openingBalanceDate: string; calculatedBalance?: number; isPrimary: boolean; active: boolean; notes?: string | null };
type FinancialFeeRule = { id: string; installments?: number | null; feePercentage: number | string; fixedFee: number | string; settlementDays: number; effectiveFrom: string; effectiveUntil?: string | null; active: boolean };
type FinancialPaymentMethod = { id: string; name: string; type: "CASH" | "PIX" | "DEBIT_CARD" | "CREDIT_CARD" | "BANK_TRANSFER" | "OTHER"; institutionName?: string | null; destinationAccountId: string; destinationAccount: FinancialAccount; defaultFeePercentage: number | string; fixedFee: number | string; settlementDays: number; settlementDayType: "CALENDAR" | "BUSINESS"; maxInstallments: number; requiresNsu: boolean; requiresReceiptCode: boolean; active: boolean; brands: { id: string; brandName: string; active: boolean }[]; feeRules: FinancialFeeRule[] };

const genderLabels: Record<string, string> = { MALE: "Masculino", FEMALE: "Feminino", OTHER: "Outro", UNINFORMED: "Prefiro não informar" };
const petStatusLabels: Record<string, string> = { ACTIVE: "Ativo", INACTIVE: "Inativo", DECEASED: "Falecido" };
const petGenderLabels: Record<string, string> = { MALE: "Macho", FEMALE: "Fêmea", UNINFORMED: "Não informado" };
const petSizeLabels: Record<string, string> = { SMALL: "Pequeno", MEDIUM: "Médio", LARGE: "Grande", GIANT: "Gigante" };
const vaccinesLabels: Record<string, string> = { YES: "Sim", NO: "Não", UNINFORMED: "Não informado" };
const statusLabels: Record<string, string> = {
  SCHEDULED: "Agendado", ARRIVED: "Cliente chegou", IN_SERVICE: "Em atendimento", BATHING: "Em banho",
  WAITING_PICKUP: "Aguardando retirada", FINISHED: "Finalizado", CANCELLED: "Cancelado"
};
const membershipStatusLabels: Record<string, string> = { ACTIVE: "Ativo", EXPIRED: "Vencido", CANCELLED: "Cancelado" };
const saleStatusLabels: Record<SaleStatus, string> = { WAITING_PAYMENT: "Aguardando pagamento", PARTIALLY_PAID: "Parcialmente pago", PENDING: "Pagar depois", PAID: "Pago", CANCELLED: "Cancelado", REFUNDED: "Estornado" };
const paymentMethodLabels: Record<PaymentMethod, string> = { PIX: "PIX", CASH: "Dinheiro", DEBIT: "Débito", CREDIT: "Crédito", TRANSFER: "Transferência", VOUCHER: "Voucher", OTHER: "Outro" };
const pendingReasonLabels: Record<string, string> = { PIX_LATER: "Cliente vai fazer PIX depois", PAY_ON_PICKUP: "Pagará na retirada", OWED: "Ficou devendo", CARD_PROBLEM: "Problema no cartão", PARTIAL_PAYMENT: "Pagamento parcial", OTHER: "Outro" };
const paymentLabels: Record<string, string> = { PIX: "PIX", CASH: "Dinheiro", DEBIT: "Débito", CREDIT: "Crédito" };
const paymentStatusLabels: Record<string, string> = { PENDING: "Pendente", PAID: "Pago", CANCELLED: "Cancelado" };
const saleOriginLabels: Record<Sale["origin"], string> = { AGENDA: "Agenda", DIRECT: "Venda direta", PRE_SALE: "Pré-venda" };
const cashMovementLabels: Record<CashMovementType, string> = { CASH_IN: "Suprimento", CASH_OUT: "Sangria", EXPENSE: "Despesa", TRANSFER_IN: "Transferência entrada", TRANSFER_OUT: "Transferência saída", ADJUSTMENT: "Ajuste" };
const preSaleStatusLabels: Record<PreSaleStatus, string> = { OPEN: "Aberta", CONVERTED: "Convertida", EXPIRED: "Expirada", CANCELLED: "Cancelada" };
const serviceCoatOptions = ["Pelo curto", "Pelo médio", "Pelo longo", "Dupla pelagem", "Sem pelo", "Outro"];

function onlyDigits(value: string, maxLength?: number) {
  const digits = value.replace(/\D/g, "");
  return maxLength ? digits.slice(0, maxLength) : digits;
}

function normalizeOption(value?: string) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR") ?? "";
}

function uniqueOptions(values: (string | undefined | null)[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = normalizeOption(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function servicePetSizeLabel(value?: string) {
  return value ? `Porte ${value}` : "Porte não informado";
}

function serviceCoatLabel(value?: string) {
  return value || "Não informado";
}

function formatCpf(value: string) {
  const digits = onlyDigits(value, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

function formatCnpj(value: string) {
  const digits = onlyDigits(value, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function formatPhone(value: string) {
  const digits = onlyDigits(value, 11);
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCep(value: string) {
  return onlyDigits(value, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

function centsFromCurrency(value: string | number) {
  if (typeof value === "number") return String(Math.round(value * 100));
  const raw = String(value);
  if (raw.includes(",") || raw.includes(".")) {
    const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
    return String(Math.round(Number(normalized || 0) * 100));
  }
  return String(Math.round(Number(raw || 0) * 100));
}

function formatCurrencyInput(value: string | number) {
  const cents = Number(onlyDigits(String(value)) || 0);
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function decimalFromCents(value: string) {
  return Number(onlyDigits(value) || 0) / 100;
}

function stockAllowsDecimal(unit?: string) {
  return ["kg", "litro", "outro"].includes(unit ?? "");
}

function sanitizeStockInput(value: string, unit?: string) {
  let clean = value.replace(/[^\d,.]/g, "");
  if (!stockAllowsDecimal(unit)) {
    const integer = onlyDigits(clean);
    return integer.replace(/^0+(?=\d)/, "");
  }

  clean = clean.replace(/\./g, ",");
  const [integerPart, ...decimalParts] = clean.split(",");
  const integer = integerPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const decimal = decimalParts.join("").replace(/\D/g, "").slice(0, 3);
  if (clean.includes(",")) return `${integer || "0"},${decimal}`;
  return integer;
}

function normalizeStockForUnit(value: string, unit?: string) {
  if (stockAllowsDecimal(unit)) return sanitizeStockInput(value, unit);
  return onlyDigits(value).replace(/^0+(?=\d)/, "");
}

function stockNumber(value: string) {
  return Number(value.replace(",", ".") || 0);
}

function stockInputValue(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "";
  const number = Number(String(value).replace(",", "."));
  if (Number.isNaN(number) || number === 0) return "";
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function stockPlaceholder(unit?: string) {
  const placeholders: Record<string, string> = { unidade: "Ex.: 10", pacote: "Ex.: 3", kg: "Ex.: 1,5", g: "Ex.: 500", litro: "Ex.: 2,75", ml: "Ex.: 500", outro: "Ex.: 1,5" };
  return placeholders[unit ?? "unidade"] ?? "Ex.: 10";
}

function unitLabel(unit?: string, quantity?: number) {
  const labels: Record<string, [string, string]> = {
    unidade: ["unidade", "unidades"],
    pacote: ["pacote", "pacotes"],
    kg: ["kg", "kg"],
    g: ["g", "g"],
    litro: ["litro", "litros"],
    ml: ["ml", "ml"],
    outro: ["", ""]
  };
  const [singular, plural] = labels[unit ?? "unidade"] ?? labels.unidade;
  return quantity === 1 ? singular : plural;
}

function formatStock(value?: string | number | null, unit?: string) {
  const number = Number(String(value ?? 0).replace(",", "."));
  const formatted = number.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const label = unitLabel(unit, number);
  return label ? `${formatted} ${label}` : formatted;
}

function weightDigitsFromValue(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "";
  const raw = String(value);
  if (raw.includes(",") || raw.includes(".")) {
    const normalized = raw.replace(/[^\d,.-]/g, "").replace(",", ".");
    return String(Math.round(Number(normalized || 0) * 100));
  }
  return onlyDigits(raw, 5);
}

function formatWeightInput(value: string | number) {
  const digits = onlyDigits(String(value), 5);
  if (!digits) return "";
  const grams = Number(digits || 0);
  return `${(grams / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
}

function weightNumberFromInput(value: string | number) {
  const digits = onlyDigits(String(value), 5);
  if (!digits) return undefined;
  return Number((Number(digits) / 100).toFixed(2));
}

function emptyPetDraft(): PetDraft {
  return { name: "", species: "DOG", customSpecies: "", breed: "", gender: "UNINFORMED", size: "SMALL", color: "", weight: "", birthDate: "", vaccinesStatus: "UNINFORMED", notes: "", status: "ACTIVE" };
}

function petDraftPayload(pet: PetDraft, isPrimary: boolean) {
  return {
    name: pet.name,
    species: pet.species,
    customSpecies: pet.customSpecies,
    breed: pet.breed,
    gender: pet.gender,
    size: pet.size,
    color: pet.color,
    weight: weightNumberFromInput(pet.weight),
    birthDate: pet.birthDate || undefined,
    notes: pet.notes,
    vaccinesStatus: pet.vaccinesStatus,
    status: pet.status,
    isPrimary
  };
}

function formatWeightDisplay(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "";
  const weight = Number(String(value).replace(",", "."));
  if (Number.isNaN(weight)) return "";
  return `${weight.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
}

function localDateInput(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function isPastDate(value: string) {
  return value < localDateInput();
}

function dateTitle(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function parseLocalDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function addDays(value: string, days: number) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return localDateInput(date);
}

function addMonths(value: string, months: number) {
  const date = parseLocalDate(value);
  date.setMonth(date.getMonth() + months);
  return localDateInput(date);
}

function startOfWeek(value: string) {
  return addDays(value, -parseLocalDate(value).getDay());
}

function sameMonth(a: string, b: string) {
  const dateA = parseLocalDate(a);
  const dateB = parseLocalDate(b);
  return dateA.getMonth() === dateB.getMonth() && dateA.getFullYear() === dateB.getFullYear();
}

function weekDays(value: string) {
  const start = startOfWeek(value);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function monthDays(value: string) {
  const date = parseLocalDate(value);
  const first = localDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function calendarTitle(value: string) {
  return parseLocalDate(value).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function periodTitle(view: "day" | "week" | "month", value: string) {
  if (view === "day") return dateTitle(value);
  if (view === "month") return calendarTitle(value);
  const days = weekDays(value);
  const start = parseLocalDate(days[0]).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const end = parseLocalDate(days[6]).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  return `Semana de ${start} – ${end}`;
}

function appointmentBadge(appointment: Appointment) {
  if (appointment.paymentStatus === "PAID") return "Pago";
  const membership = appointment.customer.memberships?.find((item) => item.pet.id === appointment.pet.id && item.status === "ACTIVE");
  return membership ? "Mensalista" : "Avulso";
}

function appointmentColor(status: string) {
  if (status === "ARRIVED" || status === "IN_SERVICE" || status === "BATHING") return { dot: "bg-blue-500", card: "border-blue-200 bg-blue-50/80" };
  if (status === "WAITING_PICKUP") return { dot: "bg-emerald-500", card: "border-emerald-200 bg-emerald-50/80" };
  if (status === "FINISHED") return { dot: "bg-slate-400", card: "border-slate-200 bg-slate-50" };
  if (status === "CANCELLED") return { dot: "bg-red-500", card: "border-red-200 bg-red-50/80" };
  return { dot: "bg-amber-500", card: "border-amber-200 bg-amber-50/80" };
}

function customerCode(customer: Pick<Customer, "internalCode">) {
  return customer.internalCode ? `#${String(customer.internalCode).padStart(4, "0")}` : "-";
}

function catalogCode(item?: { catalogCode?: number | null; internalCode?: number | null }) {
  const code = item?.catalogCode ?? item?.internalCode;
  return code ? String(code).padStart(6, "0") : "-";
}

function productCode(product?: Pick<Product, "catalogCode" | "internalCode">) {
  return catalogCode(product);
}

function serviceCode(service?: Pick<Service, "catalogCode" | "internalCode">) {
  return catalogCode(service);
}

function saleCode(sale?: Pick<Sale, "internalCode">) {
  return sale?.internalCode ? `PD-${String(sale.internalCode).padStart(5, "0")}` : "-";
}

function receiptCode(receipt?: Pick<SalesReceipt, "receiptCode"> | null) {
  return receipt?.receiptCode ? `CV-${String(receipt.receiptCode).padStart(6, "0")}` : "-";
}

function cashSessionCode(session?: Pick<CashSession, "internalCode"> | null) {
  return session?.internalCode ? `CXA-${String(session.internalCode).padStart(6, "0")}` : "-";
}

function preSaleCode(preSale?: Pick<PreSale, "internalCode"> | null) {
  return preSale?.internalCode ? `PRE-${String(preSale.internalCode).padStart(6, "0")}` : "-";
}

function cashMovementCode(movement?: Pick<CashMovement, "internalCode"> | null) {
  return movement?.internalCode ? `MOV-${String(movement.internalCode).padStart(6, "0")}` : "-";
}

function codeDigits(item?: { catalogCode?: number | null; internalCode?: number | null }) {
  const code = item?.catalogCode ?? item?.internalCode;
  return code ? String(code).padStart(6, "0") : "";
}

function readonlyCatalogCode(_prefix: "PRO" | "SER", item?: { catalogCode?: number | null; internalCode?: number | null }) {
  const code = catalogCode(item);
  return code === "-" ? "Gerado automaticamente ao salvar" : code;
}

function dateTimeBR(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function pendingObservation(value?: string | null) {
  return value?.replace(/\n?Previsão de pagamento:\s*\d{2}\/\d{2}\/\d{4}\s*$/i, "").trim() ?? "";
}

function expectedPaymentText(value?: string | null) {
  if (!value) return "Não informada";
  const expectedDate = new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const days = Math.floor((new Date(`${today}T12:00:00-03:00`).getTime() - new Date(`${expectedDate}T12:00:00-03:00`).getTime()) / 86400000);
  const formatted = dateBR(value);
  return days > 0 ? `${formatted} — vencida há ${days} dia${days === 1 ? "" : "s"}` : formatted;
}

function displayGender(customer: Pick<Customer, "gender" | "customGender">) {
  return customer.gender === "OTHER" && customer.customGender ? customer.customGender : genderLabels[customer.gender];
}

function displaySpecies(pet: Pick<Pet, "species" | "customSpecies">) {
  const labels: Record<string, string> = { DOG: "Cão", CAT: "Gato", OTHER: "Outro" };
  return pet.species === "OTHER" && pet.customSpecies ? pet.customSpecies : labels[pet.species] ?? pet.species;
}

function isConnectionError(error: unknown) {
  return error instanceof ApiError
    && (error.code === "API_UNREACHABLE" || error.code === "DATABASE_UNREACHABLE" || error.code === "DATABASE_SCHEMA_OUTDATED");
}

function useData<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);
  useEffect(() => {
    const retry = () => setRefreshKey((key) => key + 1);
    window.addEventListener("ceo-pet-retry", retry);
    return () => window.removeEventListener("ceo-pet-retry", retry);
  }, []);
  useEffect(() => {
    if (!path) {
      setData(null);
      setError("");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    setError("");
    if (data === null) setLoading(true);
    else setRefreshing(true);
    api<T>(path, { signal: controller.signal })
      .then((result) => {
        if (requestId.current === currentRequest) setData(result);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (requestId.current !== currentRequest) return;
        setError(isConnectionError(err) ? "" : err instanceof Error ? err.message : "Não foi possível carregar os dados.");
        console.error(err);
      })
      .finally(() => {
        if (requestId.current === currentRequest) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [path, refreshKey, ...deps]);
  return { data, error, loading, refreshing, refresh: () => setRefreshKey((key) => key + 1) };
}

type RegistrationForm = {
  legalName: string; tradeName: string; cnpj: string; stateRegistration: string; municipalRegistration: string; taxRegime: string;
  zipCode: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string; country: string;
  landline: string; mobile: string; site: string; instagram: string; facebook: string;
  responsibleName: string; responsibleCpf: string; responsibleRole: string; responsibleEmail: string; responsibleMobile: string;
  email: string; password: string; confirmPassword: string;
};

const emptyRegistration: RegistrationForm = {
  legalName: "", tradeName: "", cnpj: "", stateRegistration: "", municipalRegistration: "", taxRegime: "",
  zipCode: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", country: "Brasil",
  landline: "", mobile: "", site: "", instagram: "", facebook: "",
  responsibleName: "", responsibleCpf: "", responsibleRole: "", responsibleEmail: "", responsibleMobile: "",
  email: "", password: "", confirmPassword: ""
};

function Login({ onSession }: { onSession: (session: Session) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [form, setForm] = useState<RegistrationForm>(emptyRegistration);
  const [error, setError] = useState("");
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const update = (field: keyof RegistrationForm, value: string) => {
    const formatted = field === "cnpj" ? formatCnpj(value)
      : field === "responsibleCpf" ? formatCpf(value)
      : field === "zipCode" ? formatCep(value)
      : ["landline", "mobile", "responsibleMobile"].includes(field) ? formatPhone(value)
      : field === "state" ? value.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase()
      : value;
    setForm((current) => ({ ...current, [field]: formatted }));
  };

  async function lookupCep() {
    const cep = onlyDigits(form.zipCode);
    if (cep.length !== 8) return;
    setLookingUpCep(true);
    setError("");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!response.ok) throw new Error("Não foi possível consultar o CEP.");
      const address = await response.json() as { erro?: boolean; logradouro?: string; complemento?: string; bairro?: string; localidade?: string; uf?: string };
      if (address.erro) throw new Error("CEP não encontrado.");
      setForm((current) => ({
        ...current,
        street: address.logradouro || current.street,
        complement: current.complement || address.complemento || "",
        neighborhood: address.bairro || current.neighborhood,
        city: address.localidade || current.city,
        state: address.uf || current.state
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível consultar o CEP.");
    } finally {
      setLookingUpCep(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "register" && form.password !== form.confirmPassword) throw new Error("As senhas não conferem.");
      const payload = mode === "login" ? loginForm : {
        ...form,
        cnpj: onlyDigits(form.cnpj), zipCode: onlyDigits(form.zipCode), mobile: onlyDigits(form.mobile), landline: onlyDigits(form.landline),
        responsibleCpf: onlyDigits(form.responsibleCpf), responsibleMobile: onlyDigits(form.responsibleMobile),
        state: form.state.toUpperCase(), confirmPassword: undefined
      };
      const session = await api<Session>(mode === "login" ? "/auth/login" : "/auth/register", { method: "POST", body: JSON.stringify(payload) });
      localStorage.setItem("ceo-pet-session", JSON.stringify(session));
      onSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no acesso");
    }
  }
  if (mode === "login") return <main className="grid min-h-screen place-items-center bg-slate-100 p-4">
    <form onSubmit={submit} className="panel w-full max-w-md p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">CEO Pet AI</h1>
      <p className="mt-1 text-sm text-slate-500">Acesse o painel operacional do pet shop.</p>
      <div className="mt-5 grid gap-3">
        <input className="field" aria-label="E-mail" autoComplete="username" placeholder="E-mail" type="email" required value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
        <input className="field" aria-label="Senha" autoComplete="current-password" placeholder="Senha" type="password" required value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button className="btn btn-primary mt-5 w-full" type="submit">Entrar</button>
      <button className="btn btn-secondary mt-3 w-full" type="button" onClick={() => { setError(""); setMode("register"); }}>Criar primeira conta</button>
    </form>
  </main>;

  const field = (label: string, name: keyof RegistrationForm, options?: { type?: string; required?: boolean; placeholder?: string; autoComplete?: string; onBlur?: () => void }) =>
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}{options?.required !== false && <span className="ml-1 text-red-500">*</span>}</span>
      <input className="field" type={options?.type ?? "text"} required={options?.required !== false} placeholder={options?.placeholder} autoComplete={options?.autoComplete} value={form[name]} onBlur={options?.onBlur} onChange={(event) => update(name, event.target.value)} />
    </label>;

  return <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 lg:py-12">
    <form onSubmit={submit} className="panel mx-auto w-full max-w-5xl overflow-hidden shadow-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-6 sm:px-8">
        <p className="text-sm font-semibold text-brand-600">CEO Pet AI</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Cadastre sua empresa</h1>
        <p className="mt-1 text-sm text-slate-500">Preencha os dados abaixo para preparar o acesso ao sistema.</p>
      </header>
      <div className="grid gap-8 p-6 sm:p-8">
        <section>
          <h2 className="text-lg font-semibold">Dados da empresa</h2><p className="mb-4 text-sm text-slate-500">Informações básicas e fiscais.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {field("Nome da empresa (Razão Social)", "legalName", { autoComplete: "organization" })}
            {field("Nome Fantasia", "tradeName")}
            {field("CNPJ", "cnpj", { placeholder: "00.000.000/0000-00" })}
            {field("Inscrição Estadual", "stateRegistration", { required: false })}
            {field("Inscrição Municipal", "municipalRegistration", { required: false })}
            <label className="grid gap-1.5 text-sm font-medium text-slate-700"><span>Regime Tributário <span className="ml-1 text-red-500">*</span></span><select className="field" required value={form.taxRegime} onChange={(event) => update("taxRegime", event.target.value)}><option value="">Selecione</option><option value="MEI">MEI</option><option value="SIMPLES_NACIONAL">Simples Nacional</option><option value="LUCRO_PRESUMIDO">Lucro Presumido</option><option value="LUCRO_REAL">Lucro Real</option></select></label>
          </div>
        </section>
        <section className="border-t border-slate-200 pt-8">
          <h2 className="text-lg font-semibold">Endereço</h2><p className="mb-4 text-sm text-slate-500">Digite o CEP para preencher o endereço automaticamente.</p>
          <div className="grid gap-4 md:grid-cols-6">
            <div className="md:col-span-2">{field(lookingUpCep ? "Consultando CEP..." : "CEP", "zipCode", { placeholder: "00000-000", autoComplete: "postal-code", onBlur: lookupCep })}</div>
            <div className="md:col-span-4">{field("Rua", "street", { autoComplete: "address-line1" })}</div>
            <div className="md:col-span-2">{field("Número", "number")}</div><div className="md:col-span-4">{field("Complemento", "complement", { required: false, autoComplete: "address-line2" })}</div>
            <div className="md:col-span-2">{field("Bairro", "neighborhood")}</div><div className="md:col-span-2">{field("Cidade", "city", { autoComplete: "address-level2" })}</div><div className="md:col-span-1">{field("Estado (UF)", "state", { autoComplete: "address-level1" })}</div><div className="md:col-span-1">{field("País", "country", { autoComplete: "country-name" })}</div>
          </div>
        </section>
        <section className="border-t border-slate-200 pt-8">
          <h2 className="text-lg font-semibold">Contato</h2><p className="mb-4 text-sm text-slate-500">Canais oficiais da empresa.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {field("Telefone fixo", "landline", { required: false, type: "tel" })}{field("Celular / WhatsApp", "mobile", { type: "tel" })}
            {field("Site", "site", { required: false, type: "url", placeholder: "https://" })}{field("Instagram", "instagram", { required: false, placeholder: "@suaempresa" })}{field("Facebook", "facebook", { required: false })}
          </div>
        </section>
        <section className="border-t border-slate-200 pt-8">
          <h2 className="text-lg font-semibold">Dados do responsável</h2><p className="mb-4 text-sm text-slate-500">Pessoa responsável pela empresa e pelo cadastro.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {field("Nome do responsável", "responsibleName", { autoComplete: "name" })}{field("CPF", "responsibleCpf", { placeholder: "000.000.000-00" })}{field("Cargo", "responsibleRole")}{field("E-mail", "responsibleEmail", { type: "email", autoComplete: "email" })}{field("Celular", "responsibleMobile", { type: "tel", autoComplete: "tel" })}
          </div>
        </section>
        <section className="rounded-lg border border-brand-100 bg-brand-50/50 p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Acesso ao sistema</h2><p className="mb-4 text-sm text-slate-600">Defina o e-mail e a senha que serão usados para entrar no CEO Pet AI.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">{field("E-mail de acesso", "email", { type: "email", autoComplete: "username" })}</div>
            {field("Criar senha", "password", { type: "password", autoComplete: "new-password", placeholder: "Mínimo de 6 caracteres" })}{field("Confirmar senha", "confirmPassword", { type: "password", autoComplete: "new-password" })}
          </div>
        </section>
        {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-end">
          <button className="btn btn-secondary px-6" type="button" onClick={() => { setError(""); setMode("login"); }}>Voltar para login</button>
          <button className="btn btn-primary px-8" type="submit">Criar empresa e acessar</button>
        </div>
      </div>
    </form>
  </main>;
}

function Dashboard() {
  const { data } = useData<{ cards: Record<string, number>; recommendations: string[] }>("/dashboard");
  const cards = [
    ["Atendimentos de hoje", data?.cards.appointmentsToday ?? 0],
    ["Faturamento de hoje", currency(data?.cards.revenueToday ?? 0)],
    ["Clientes cadastrados", data?.cards.customers ?? 0],
    ["Mensalistas ativos", data?.cards.activeMemberships ?? 0],
    ["Pacotes vencendo", data?.cards.expiringMemberships ?? 0],
    ["Clientes frios", data?.cards.coldCustomers ?? 0],
    ["Frequência reduzida", data?.cards.reducedFrequency ?? 0]
  ];
  return <Page title="Dashboard">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div className="panel p-4" key={label}><p className="text-sm text-slate-500">{label}</p><strong className="mt-2 block text-2xl">{value}</strong></div>)}</div>
    <section className="panel mt-5 p-5"><h2 className="font-semibold">CEO Pet AI recomenda</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{(data?.recommendations ?? []).map((text) => <div key={text} className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">{text}</div>)}</div></section>
  </Page>;
}

function Customers() {
  const [q, setQ] = useState("");
  const { data, error, refresh } = useData<Customer[]>(`/customers?q=${encodeURIComponent(q)}`, [q]);
  const [modal, setModal] = useState<"new" | "detail" | "edit" | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const customers = data ?? [];
  return <Page title="Clientes" action={<button className="btn btn-primary" onClick={() => setModal("new")}><Plus size={16} />Adicionar Cliente</button>}>
    <div className="panel mb-4 flex items-center gap-2 p-3"><Search size={18} className="text-slate-400" /><input className="w-full bg-transparent text-sm outline-none" placeholder="Buscar por tutor, CPF, pet ou celular" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Não foi possível carregar os clientes. Verifique se a API está aberta e tente novamente.</div>}
    <div className="panel overflow-hidden">
      <table className="hidden w-full text-left text-sm md:table"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Código</th><th>Tutor</th><th>Pet</th><th>CPF</th><th>Celular</th><th>Status</th><th></th></tr></thead><tbody>{customers.map((customer) => <tr className="border-t border-slate-100" key={customer.id}><td className="p-3 font-semibold text-slate-500">{customerCode(customer)}</td><td className="font-medium">{customer.name}</td><td>{customer.pets.find((p) => p.isPrimary)?.name ?? (customer.pets.length === 1 ? customer.pets[0].name : `${customer.pets.length} pets`)}</td><td>{formatCpf(customer.cpf)}</td><td>{formatPhone(customer.phone)}</td><td>{customer.memberships?.some((m) => m.status === "ACTIVE") && <span className="badge bg-emerald-50 text-emerald-700">Mensalista</span>}</td><td><div className="flex gap-2"><button className="btn btn-secondary" onClick={() => { setSelected(customer); setModal("detail"); }}><Eye size={16} /></button><button className="btn btn-secondary" onClick={() => { setSelected(customer); setModal("edit"); }}><Pencil size={16} /></button></div></td></tr>)}</tbody></table>
      <div className="grid gap-3 p-3 md:hidden">{customers.map((customer) => <div className="rounded-md border border-slate-200 p-3" key={customer.id}><strong>{customerCode(customer)} — {customer.name}</strong><p className="text-sm text-slate-500">{customer.pets.map((pet) => pet.name).join(", ")} | {formatPhone(customer.phone)}</p><div className="mt-3 flex gap-2"><button className="btn btn-secondary flex-1" onClick={() => { setSelected(customer); setModal("detail"); }}><Eye size={16} />Ver</button><button className="btn btn-secondary flex-1" onClick={() => { setSelected(customer); setModal("edit"); }}><Pencil size={16} />Editar</button></div></div>)}</div>
    </div>
    {modal === "new" && <CustomerForm onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
    {modal === "edit" && selected && <CustomerForm customerId={selected.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
    {modal === "detail" && selected && <CustomerDetail id={selected.id} onClose={() => setModal(null)} />}
  </Page>;
}

function CustomerForm({ customerId, onClose, onSaved }: { customerId?: string; onClose: () => void; onSaved: () => void }) {
  const isEdit = Boolean(customerId);
  const { data, refresh } = useData<(Customer & { histories: unknown[] }) | null>(customerId ? `/customers/${customerId}` : "", [customerId]);
  const [form, setForm] = useState({ name: "", cpf: "", gender: "UNINFORMED" as Gender, customGender: "", phone: "", zipCode: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", petName: "", species: "DOG", customSpecies: "", breed: "", petGender: "UNINFORMED", size: "SMALL", color: "", weight: "", birthDate: "", notes: "", vaccinesStatus: "UNINFORMED", status: "ACTIVE" });
  const [editingPet, setEditingPet] = useState<Pet | null>(null);
  const [petOpen, setPetOpen] = useState(false);
  const [pendingPets, setPendingPets] = useState<PetDraft[]>([]);
  const [pendingPetOpen, setPendingPetOpen] = useState(false);
  const [editingPendingPetIndex, setEditingPendingPetIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (data && isEdit) {
      setForm((current) => ({ ...current, name: data.name, cpf: onlyDigits(data.cpf, 11), gender: data.gender, customGender: data.customGender ?? "", phone: onlyDigits(data.phone, 11), zipCode: onlyDigits(data.zipCode ?? "", 8), street: data.street ?? "", number: data.number ?? "", complement: data.complement ?? "", neighborhood: data.neighborhood ?? "", city: data.city ?? "", state: data.state ?? "" }));
    }
  }, [data?.id, isEdit]);

  async function cep() {
    if (form.zipCode.length < 8) return;
    const response = await fetch(`https://viacep.com.br/ws/${form.zipCode.replace(/\D/g, "")}/json/`);
    const address = await response.json();
    setForm({ ...form, street: address.logradouro ?? "", neighborhood: address.bairro ?? "", city: address.localidade ?? "", state: address.uf ?? "" });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    const payload = { name: form.name, cpf: onlyDigits(form.cpf, 11), gender: form.gender, customGender: form.customGender, phone: onlyDigits(form.phone, 11), zipCode: onlyDigits(form.zipCode, 8), street: form.street, number: form.number, complement: form.complement, neighborhood: form.neighborhood, city: form.city, state: form.state };
    if (form.gender === "OTHER" && !form.customGender.trim()) {
      setError("Informe o gênero personalizado do tutor.");
      return;
    }
    if (!isEdit && form.species === "OTHER" && !form.customSpecies.trim()) {
      setError("Informe a espécie personalizada do pet.");
      return;
    }
    try {
      setSaving(true);
      if (isEdit) {
        await api(`/customers/${customerId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        const initialPet = {
          name: form.petName,
          species: form.species,
          customSpecies: form.customSpecies,
          breed: form.breed,
          gender: form.petGender,
          size: form.size,
          color: form.color,
          weight: weightNumberFromInput(form.weight),
          birthDate: form.birthDate || undefined,
          notes: form.notes,
          vaccinesStatus: form.vaccinesStatus,
          status: form.status,
          isPrimary: true
        };
        await api("/customers", { method: "POST", body: JSON.stringify({ ...payload, pets: [initialPet, ...pendingPets.map((pet) => petDraftPayload(pet, false))] }) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o cliente.");
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={isEdit ? "Editar Cliente" : "Adicionar Cliente"} onClose={onClose}><form onSubmit={submit} className="grid gap-4">
    <Section title="Tutor"><input className="field" required placeholder="Nome completo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input className="field" required inputMode="numeric" placeholder="CPF" value={formatCpf(form.cpf)} onChange={(e) => setForm({ ...form, cpf: onlyDigits(e.target.value, 11) })} />{form.gender === "OTHER" ? <input className="field" autoFocus placeholder="Digite o gênero" value={form.customGender} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} onChange={(e) => setForm({ ...form, customGender: e.target.value })} /> : <select className="field" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as Gender })}>{Object.entries(genderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<input className="field" required inputMode="numeric" placeholder="Celular/WhatsApp" value={formatPhone(form.phone)} onChange={(e) => setForm({ ...form, phone: onlyDigits(e.target.value, 11) })} /></Section>
    <Section title="Endereço"><input className="field" inputMode="numeric" placeholder="CEP" value={formatCep(form.zipCode)} onBlur={cep} onChange={(e) => setForm({ ...form, zipCode: onlyDigits(e.target.value, 8) })} /><input className="field" placeholder="Rua" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /><input className="field" placeholder="Número" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /><input className="field" placeholder="Complemento" value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} /><input className="field" placeholder="Bairro" value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} /><input className="field" placeholder="Cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /><input className="field" placeholder="Estado" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Section>
    {!isEdit && <><Section title="Pet inicial"><input className="field" required placeholder="Nome do pet" value={form.petName} onChange={(e) => setForm({ ...form, petName: e.target.value })} /><PetBasics form={form} setForm={setForm} /></Section><div className="rounded-md border border-slate-200 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">Pets adicionais</h3><p className="text-sm text-slate-500">Adicione outros pets deste tutor antes de salvar o cliente.</p></div><button className="btn btn-secondary" type="button" onClick={() => { setEditingPendingPetIndex(null); setPendingPetOpen(true); }}><Plus size={16} />Novo pet</button></div>{pendingPets.length > 0 && <div className="mt-3 grid gap-2">{pendingPets.map((pet, index) => <div className="rounded-md border border-slate-200 p-3" key={`${pet.name}-${index}`}><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><b>{pet.name}</b><p className="text-sm text-slate-500">{petSizeLabels[pet.size] ?? pet.size} · {petGenderLabels[pet.gender] ?? pet.gender} · {petStatusLabels[pet.status]}</p></div><div className="flex flex-wrap gap-2"><button className="btn btn-secondary" type="button" onClick={() => { setEditingPendingPetIndex(index); setPendingPetOpen(true); }}><Pencil size={16} />Editar</button><button className="btn btn-secondary" type="button" onClick={() => setPendingPets((current) => current.filter((_, petIndex) => petIndex !== index))}><Trash2 size={16} />Remover</button></div></div></div>)}</div>}</div></>}
    {isEdit && data && <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Pets</h3><button className="btn btn-secondary" type="button" onClick={() => { setEditingPet(null); setPetOpen(true); }}><Plus size={16} />Novo pet</button></div><div className="grid gap-2">{data.pets.map((pet) => <div className="rounded-md border border-slate-200 p-3" key={pet.id}><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><b>{pet.name}</b><p className="text-sm text-slate-500">{petStatusLabels[pet.status]} {pet.isPrimary ? "| Principal" : ""}</p></div><button className="btn btn-secondary" type="button" onClick={() => { setEditingPet(pet); setPetOpen(true); }}><Pencil size={16} />Editar pet</button></div></div>)}</div></div>}
    {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <button className="btn btn-primary justify-self-end disabled:opacity-60" type="submit" disabled={saving}><Check size={16} />{saving ? "Salvando..." : "Salvar cliente"}</button>
  </form>{petOpen && customerId && <PetModal customerId={customerId} pet={editingPet} onClose={() => setPetOpen(false)} onSaved={() => { setPetOpen(false); refresh(); }} />}{pendingPetOpen && !isEdit && <PendingPetModal pet={editingPendingPetIndex === null ? null : pendingPets[editingPendingPetIndex] ?? null} onClose={() => { setPendingPetOpen(false); setEditingPendingPetIndex(null); }} onSaved={(pet) => { setPendingPets((current) => editingPendingPetIndex === null ? [...current, pet] : current.map((item, index) => index === editingPendingPetIndex ? pet : item)); setPendingPetOpen(false); setEditingPendingPetIndex(null); }} />}</Modal>;
}

function PetBasics({ form, setForm }: { form: Record<string, string>; setForm: (value: any) => void }) {
  return <>{form.species === "OTHER" ? <input className="field" autoFocus placeholder="Digite a espécie" value={form.customSpecies} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} onChange={(e) => setForm({ ...form, customSpecies: e.target.value })} /> : <select className="field" value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })}><option value="DOG">Cão</option><option value="CAT">Gato</option><option value="OTHER">Outro</option></select>}<input className="field" placeholder="Raça" value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} /><select className="field" value={form.petGender} onChange={(e) => setForm({ ...form, petGender: e.target.value })}><option value="MALE">Macho</option><option value="FEMALE">Fêmea</option><option value="UNINFORMED">Não informado</option></select><select className="field" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}><option value="SMALL">Pequeno</option><option value="MEDIUM">Médio</option><option value="LARGE">Grande</option><option value="GIANT">Gigante</option></select><input className="field" placeholder="Cor" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /><input className="field" inputMode="numeric" placeholder="Peso (kg)" value={formatWeightInput(form.weight)} onChange={(e) => setForm({ ...form, weight: onlyDigits(e.target.value, 5) })} /><input className="field" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /><select className="field" value={form.vaccinesStatus} onChange={(e) => setForm({ ...form, vaccinesStatus: e.target.value })}><option value="YES">Vacinas em dia</option><option value="NO">Vacinas pendentes</option><option value="UNINFORMED">Não informado</option></select><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{Object.entries(petStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea className="field md:col-span-2" placeholder="Observações/cuidados" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></>;
}

function PendingPetModal({ pet, onClose, onSaved }: { pet: PetDraft | null; onClose: () => void; onSaved: (pet: PetDraft) => void }) {
  const [form, setForm] = useState<PetDraft>(pet ?? emptyPetDraft());
  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSaved(form);
  }
  return <Modal title={pet ? "Editar pet" : "Adicionar pet"} onClose={onClose}><form className="grid gap-3 md:grid-cols-2" onSubmit={submit}><input className="field" required placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />{form.species === "OTHER" ? <input className="field" autoFocus placeholder="Digite a espécie" value={form.customSpecies} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} onChange={(e) => setForm({ ...form, customSpecies: e.target.value })} /> : <select className="field" value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })}><option value="DOG">Cão</option><option value="CAT">Gato</option><option value="OTHER">Outro</option></select>}<input className="field" placeholder="Raça" value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} /><select className="field" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="MALE">Macho</option><option value="FEMALE">Fêmea</option><option value="UNINFORMED">Não informado</option></select><select className="field" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}><option value="SMALL">Pequeno</option><option value="MEDIUM">Médio</option><option value="LARGE">Grande</option><option value="GIANT">Gigante</option></select><input className="field" placeholder="Cor" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /><input className="field" inputMode="numeric" placeholder="Peso (kg)" value={formatWeightInput(form.weight)} onChange={(e) => setForm({ ...form, weight: onlyDigits(e.target.value, 5) })} /><input className="field" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /><select className="field" value={form.vaccinesStatus} onChange={(e) => setForm({ ...form, vaccinesStatus: e.target.value })}><option value="YES">Vacinas em dia</option><option value="NO">Vacinas pendentes</option><option value="UNINFORMED">Não informado</option></select><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PetStatus })}>{Object.entries(petStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea className="field md:col-span-2" placeholder="Observações/cuidados" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /><button className="btn btn-primary justify-self-end md:col-span-2">Salvar pet</button></form></Modal>;
}

function PetModal({ customerId, pet, onClose, onSaved }: { customerId: string; pet: Pet | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: pet?.name ?? "", species: pet?.species ?? "DOG", customSpecies: pet?.customSpecies ?? "", breed: pet?.breed ?? "", gender: pet?.gender ?? "UNINFORMED", size: pet?.size ?? "SMALL", color: pet?.color ?? "", weight: weightDigitsFromValue(pet?.weight), birthDate: pet?.birthDate?.slice(0, 10) ?? "", vaccinesStatus: pet?.vaccinesStatus ?? "UNINFORMED", notes: pet?.notes ?? "", status: pet?.status ?? "ACTIVE", isPrimary: pet?.isPrimary ?? false });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = { ...form, weight: weightNumberFromInput(form.weight), birthDate: form.birthDate || undefined };
    await api(pet ? `/customers/${customerId}/pets/${pet.id}` : `/customers/${customerId}/pets`, { method: pet ? "PATCH" : "POST", body: JSON.stringify(body) });
    onSaved();
  }
  return <Modal title={pet ? "Editar pet" : "Adicionar pet"} onClose={onClose}><form className="grid gap-3 md:grid-cols-2" onSubmit={submit}><input className="field" required placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />{form.species === "OTHER" ? <input className="field" autoFocus placeholder="Digite a espécie" value={form.customSpecies} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} onChange={(e) => setForm({ ...form, customSpecies: e.target.value })} /> : <select className="field" value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })}><option value="DOG">Cão</option><option value="CAT">Gato</option><option value="OTHER">Outro</option></select>}<input className="field" placeholder="Raça" value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} /><select className="field" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="MALE">Macho</option><option value="FEMALE">Fêmea</option><option value="UNINFORMED">Não informado</option></select><select className="field" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}><option value="SMALL">Pequeno</option><option value="MEDIUM">Médio</option><option value="LARGE">Grande</option><option value="GIANT">Gigante</option></select><input className="field" placeholder="Cor" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /><input className="field" inputMode="numeric" placeholder="Peso (kg)" value={formatWeightInput(form.weight)} onChange={(e) => setForm({ ...form, weight: onlyDigits(e.target.value, 5) })} /><input className="field" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /><select className="field" value={form.vaccinesStatus} onChange={(e) => setForm({ ...form, vaccinesStatus: e.target.value })}><option value="YES">Vacinas em dia</option><option value="NO">Vacinas pendentes</option><option value="UNINFORMED">Não informado</option></select><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PetStatus })}>{Object.entries(petStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />Pet principal</label><textarea className="field md:col-span-2" placeholder="Observações/cuidados" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /><button className="btn btn-primary justify-self-end md:col-span-2">Salvar pet</button></form></Modal>;
}

function saleItemsSummary(sale: Sale) {
  const descriptions = sale.receipt?.itemsSnapshot.map((item) => item.description) ?? sale.items.map((item) => item.description);
  if (!descriptions.length) return "Itens da compra";
  return descriptions.length <= 2 ? descriptions.join(" + ") : `${descriptions.slice(0, 2).join(" + ")} + ${descriptions.length - 2} ${descriptions.length === 3 ? "item" : "itens"}`;
}

function salePaymentsSummary(sale: Sale) {
  const payments = sale.receipt?.paymentsSnapshot ?? sale.payments ?? [];
  return payments.map((payment) => {
    const card = payment.cardBrand ? ` ${payment.cardBrand}` : "";
    const installments = payment.installments ? ` ${payment.installments}x` : "";
    return `${payment.paymentMethodNameSnapshot ?? paymentMethodLabels[payment.method]}${card}${installments} ${currency(payment.amount)}`;
  }).join(" + ") || "Não informado";
}

function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useData<CustomerDetailData>(`/customers/${id}`);
  const [tab, setTab] = useState("cadastro");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [fullTimeline, setFullTimeline] = useState(false);
  if (!data) return null;
  const fields = [["Código", customerCode(data)], ["Nome completo", data.name], ["CPF", formatCpf(data.cpf)], ["Gênero", displayGender(data)], ["Celular/WhatsApp", formatPhone(data.phone)], ["CEP", formatCep(data.zipCode ?? "")], ["Rua", data.street], ["Número", data.number], ["Complemento", data.complement], ["Bairro", data.neighborhood], ["Cidade", data.city], ["Estado", data.state]];
  return <Modal title={data.name} onClose={onClose}><div className="mb-4 flex flex-wrap gap-2">{["cadastro", "histórico", "pets", "mensalista"].map((item) => <button key={item} className={`btn ${tab === item ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === "cadastro" && <InfoGrid fields={fields} />}
    {tab === "pets" && <div className="grid gap-3">{data.pets.map((pet) => <div className="rounded-md border border-slate-200 p-3" key={pet.id}><div className="mb-2 flex flex-wrap gap-2"><b>{pet.name}</b><span className="badge bg-slate-100 text-slate-700">{petStatusLabels[pet.status]}</span>{pet.isPrimary && <span className="badge bg-blue-50 text-blue-700">Principal</span>}</div><InfoGrid fields={[["Espécie", displaySpecies(pet)], ["Raça", pet.breed], ["Sexo", petGenderLabels[pet.gender ?? "UNINFORMED"] ?? "Não informado"], ["Porte", petSizeLabels[pet.size ?? ""] ?? "-"], ["Cor", pet.color], ["Peso", formatWeightDisplay(pet.weight)], ["Nascimento", pet.birthDate ? dateBR(pet.birthDate) : ""], ["Vacinas", vaccinesLabels[pet.vaccinesStatus ?? "UNINFORMED"] ?? "Não informado"], ["Observações", pet.notes]]} /></div>)}</div>}
    {tab === "histórico" && <div className="grid gap-3">
      {data.sales.map((sale) => <article className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4" key={sale.id}>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="grid min-w-0 gap-1 text-sm">
            <p className="text-slate-500">{dateTimeBR(sale.receipt?.issuedAt ?? sale.paidAt ?? sale.createdAt)}</p>
            <b className="text-base">Compra finalizada</b>
            <p>Comprovante: <button className="font-semibold text-brand-700 underline" onClick={() => setSelectedSaleId(sale.id)}>{receiptCode(sale.receipt)}</button></p>
            <p>Pedido: {saleCode(sale)}</p>
            <p className="line-clamp-2">{saleItemsSummary(sale)}</p>
            <p className="break-words"><b>Pagamento:</b> {salePaymentsSummary(sale)}</p>
            <p><b>Total:</b> {currency(sale.total)}</p>
          </div>
          <button className="btn btn-secondary shrink-0 justify-center" onClick={() => setSelectedSaleId(sale.id)}>Ver compra</button>
        </div>
      </article>)}
      <button className="btn btn-secondary justify-self-start" onClick={() => setFullTimeline((current) => !current)}>{fullTimeline ? "Ocultar linha do tempo completa" : "Ver linha do tempo completa"}</button>
      {fullTimeline && data.histories.map((item) => <div className="rounded-md border border-slate-200 p-3" key={item.id}><b>{dateTimeBR(item.createdAt)} - {item.title}</b><p className="text-sm text-slate-500">{item.description} {item.amount ? currency(item.amount) : ""}</p></div>)}
      {!data.sales.length && !fullTimeline && <p className="text-sm text-slate-500">Nenhuma compra finalizada encontrada.</p>}
    </div>}
    {tab === "mensalista" && <div className="grid gap-3">{data.memberships?.length ? data.memberships.map((m) => <PackageCard key={m.id} membership={m} />) : <p className="text-sm text-slate-500">Cliente sem mensalidade ativa.</p>}</div>}
    {selectedSaleId && <PurchaseDetailsModal saleId={selectedSaleId} onClose={() => setSelectedSaleId(null)} />}
  </Modal>;
}

function PurchaseDetailsModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { data: sale, error, loading } = useData<ReceiptDetailSale>(`/sales/${saleId}/receipt-details`, [saleId]);
  const receipt = sale?.receipt;
  const balance = Math.max(0, Number(sale?.total ?? 0) - Number(sale?.paidAmount ?? 0));
  return <Modal title="Detalhes da compra" onClose={onClose}>
    {loading && <p className="p-6 text-center text-sm text-slate-500">Carregando detalhes da compra...</p>}
    {error && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar os detalhes da compra.</p>}
    {sale && receipt && <div className="grid gap-5 text-sm">
      <section className="grid gap-3 rounded-lg bg-emerald-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <p><b>Comprovante</b><br /><span className="text-xl font-bold text-emerald-900">{receiptCode(receipt)}</span></p>
        <p><b>Pedido</b><br />{saleCode(sale)}</p><p><b>Status</b><br />Pago</p>
        <p><b>Data e hora</b><br />{dateTimeBR(receipt.issuedAt)}</p>
        <p><b>Caixa</b><br />{cashSessionCode(sale.cashSession)}</p>
        <p><b>Loja/unidade</b><br />{receipt.companyNameSnapshot}</p>
        <p><b>Operador</b><br />{receipt.operatorNameSnapshot ?? sale.operatorName ?? "Não informado"}</p>
        <p><b>Origem</b><br />{saleOriginLabels[sale.origin]}</p>
      </section>
      <section><h3 className="mb-2 font-semibold">Cliente e pet</h3><div className="grid gap-2 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
        <p><b>Cliente:</b> {receipt.customerCodeSnapshot ? `#${String(receipt.customerCodeSnapshot).padStart(4, "0")} — ` : ""}{receipt.customerNameSnapshot ?? sale.customer?.name ?? "Consumidor final"}</p>
        <p><b>CPF:</b> {sale.customer?.cpf ? formatCpf(sale.customer.cpf) : "Não informado"}</p>
        <p><b>Telefone:</b> {sale.customer?.phone ? formatPhone(sale.customer.phone) : "Não informado"}</p>
        <p><b>Pet:</b> {receipt.petNameSnapshot ?? sale.pet?.name ?? "Pet não vinculado"}</p>
      </div></section>
      <section><h3 className="mb-2 font-semibold">Itens da venda</h3><div className="grid gap-2">
        {sale.items.map((item, index) => <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-7" key={item.id ?? index}>
          <p><b>Código</b><br />{catalogCode(item.product ?? item.service)}</p><p><b>Tipo</b><br />{item.itemType === "SERVICE" ? "Serviço" : "Produto"}</p>
          <p className="lg:col-span-2"><b>Descrição</b><br />{item.description}{item.coveredByMembership && <><br /><span className="text-emerald-700">Coberto pelo pacote</span></>}</p>
          <p><b>Quantidade</b><br />{item.quantity}</p><p><b>Unitário</b><br />{currency(item.unitPrice)}</p><p><b>Total</b><br />{currency(item.total)}</p>
        </div>)}
      </div></section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div><h3 className="mb-2 font-semibold">Resumo financeiro</h3><div className="grid gap-1 rounded-lg bg-slate-50 p-4">
          <p>Subtotal: {currency(receipt.subtotal)}</p><p>Desconto: -{currency(receipt.discount)}</p><p className="font-bold">Total: {currency(receipt.total)}</p><p>Valor pago: {currency(receipt.paidAmount)}</p><p>Saldo: {currency(balance)}</p>
        </div></div>
        <div><h3 className="mb-2 font-semibold">Pagamentos</h3><div className="grid gap-2">{receipt.paymentsSnapshot.map((payment, index) => <div className="rounded-lg border border-slate-200 p-3" key={index}>
          <p className="font-semibold">{paymentMethodLabels[payment.method]} — {currency(payment.amount)}</p>
          {payment.cardBrand && <p>Bandeira: {payment.cardBrand}</p>}{payment.installments && <p>Parcelas: {payment.installments}x</p>}
          {payment.cardNsu && <p>NSU: {payment.cardNsu}</p>}{payment.cardAuthorization && <p>Autorização: {payment.cardAuthorization}</p>}
          {payment.pixReference && <p>Comprovante PIX: {payment.pixReference}</p>}
          {payment.method === "CASH" && <p>Entregue: {currency(payment.cashReceived ?? payment.amount)} · Troco: {currency(payment.changeAmount ?? 0)}</p>}
          <p>Data: {dateTimeBR(payment.paidAt ?? receipt.issuedAt)}</p>
        </div>)}</div></div>
      </section>
      {sale.appointment && <section><h3 className="mb-2 font-semibold">Atendimento</h3><div className="grid gap-1 rounded-lg bg-slate-50 p-4"><p>Data: {dateTimeBR(sale.appointment.date)}</p><p>Serviço realizado: {sale.appointment.service.name}</p><p>Pet: {sale.pet?.name ?? "Pet não vinculado"}</p>{sale.appointment.membership && <><p className="mt-2 font-semibold">Pacote utilizado</p><p>Plano: {sale.appointment.membership.plan.name}</p>{sale.appointment.membershipUsage && <p>Saldo: {sale.appointment.membershipUsage.balanceBefore} → {sale.appointment.membershipUsage.balanceAfter ?? "-"}</p>}</>}</div></section>}
      {sale.pendingSince && <section><h3 className="mb-2 font-semibold">Histórico da pendência</h3><div className="grid gap-1 rounded-lg border border-amber-200 bg-amber-50 p-4"><p>Marcado como Pagar depois em: {dateTimeBR(sale.pendingSince)}</p><p>Motivo: {sale.pendingReason ? pendingReasonLabels[sale.pendingReason] ?? sale.pendingReason : "Motivo não informado"}</p>{pendingObservation(sale.pendingNotes) && <p>Observação: {pendingObservation(sale.pendingNotes)}</p>}<p>Previsão: {sale.expectedPaymentDate ? dateBR(sale.expectedPaymentDate) : "Não informada"}</p><p>Quitado em: {dateTimeBR(sale.paidAt)}</p></div></section>}
      <div className="flex flex-wrap justify-end gap-2"><button className="btn btn-secondary" onClick={onClose}>Fechar</button><button className="btn btn-primary" onClick={() => window.print()}>Imprimir comprovante</button></div>
    </div>}
  </Modal>;
}

function Memberships({ onCreateCustomer }: { onCreateCustomer: () => void }) {
  const [tab, setTab] = useState<"memberships" | "plans">("memberships");
  const [filter, setFilter] = useState<"ACTIVE" | "EXPIRED" | "CANCELLED" | "EXPIRING">("ACTIVE");
  const [planFilter, setPlanFilter] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const { data: memberships, refresh } = useData<Membership[]>(`/memberships?status=${filter}`, [filter]);
  const [planKey, setPlanKey] = useState(0);
  const { data: plans } = useData<Plan[]>("/memberships/plans", [planKey]);
  const { data: services } = useData<Service[]>("/catalog/services");
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [planModal, setPlanModal] = useState<{ mode: "create" | "view" | "edit"; plan?: Plan } | null>(null);
  const [deletePlan, setDeletePlan] = useState<Plan | null>(null);
  const visiblePlans = (plans ?? []).filter((plan) => planFilter === "ACTIVE" ? plan.active : !plan.active);
  async function cancel(id: string) { await api(`/memberships/${id}/cancel`, { method: "PATCH" }); refresh(); }
  const action = tab === "memberships"
    ? <button className="btn btn-primary" onClick={() => setMembershipOpen(true)}><Plus size={16} />Ativar mensalidade</button>
    : <button className="btn btn-primary" onClick={() => setPlanModal({ mode: "create" })}><Plus size={16} />Criar plano</button>;
  return <Page title="Mensalistas" action={action}>
    <div className="mb-4 flex flex-wrap gap-2">
      <button className={`btn ${tab === "memberships" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("memberships")}>Mensalidades</button>
      <button className={`btn ${tab === "plans" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("plans")}>Planos</button>
    </div>
    {tab === "memberships" && <section>
      <div className="mb-4 flex flex-wrap gap-2">{[["ACTIVE", "Ativos"], ["EXPIRED", "Vencidos"], ["CANCELLED", "Cancelados"], ["EXPIRING", "Vencendo 7 dias"]].map(([key, label]) => <button key={key} className={`btn ${filter === key ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(key as "ACTIVE" | "EXPIRED" | "CANCELLED" | "EXPIRING")}>{label}</button>)}</div>
      <DataCards items={(memberships ?? []).map((m) => ({ title: m.customer.name, subtitle: `${m.pet.name} | ${m.plan.name}`, meta: `${m.remainingUses} usos | vence ${dateBR(m.endDate)}`, status: membershipStatusLabels[m.status] ?? m.status, action: m.status === "ACTIVE" ? <button className="btn btn-secondary" onClick={() => cancel(m.id)}>Cancelar</button> : undefined }))} />
    </section>}
    {tab === "plans" && <section>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-semibold">Planos cadastrados</h2>
        <div className="flex flex-wrap gap-2">{[["ACTIVE", "Ativos"], ["INACTIVE", "Inativos"]].map(([key, label]) => <button key={key} className={`btn ${planFilter === key ? "btn-primary" : "btn-secondary"}`} onClick={() => setPlanFilter(key as "ACTIVE" | "INACTIVE")}>{label}</button>)}</div>
      </div>
      <DataCards items={visiblePlans.map((plan) => ({ title: plan.name, subtitle: `${plan.service.name} | ${plan.usageQuantity} usos | ${plan.validityDays} dias`, meta: currency(plan.price), status: plan.active ? "Ativo" : "Inativo", action: <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => setPlanModal({ mode: "view", plan })}><Eye size={16} />Ver</button><button className="btn btn-secondary" onClick={() => setPlanModal({ mode: "edit", plan })}><Pencil size={16} />Editar</button><button className="btn btn-secondary" onClick={() => setDeletePlan(plan)}>Apagar</button></div> }))} />
    </section>}
    {planModal && <PlanModal mode={planModal.mode} plan={planModal.plan} services={services ?? []} onClose={() => setPlanModal(null)} onSaved={() => { setPlanModal(null); setPlanKey((key) => key + 1); }} />}
    {deletePlan && <DeletePlanModal plan={deletePlan} onClose={() => setDeletePlan(null)} onDeleted={() => { setDeletePlan(null); setPlanKey((key) => key + 1); }} />}
    {membershipOpen && <MembershipForm plans={(plans ?? []).filter((p) => p.active)} onCreateCustomer={() => { setMembershipOpen(false); onCreateCustomer(); }} onClose={() => setMembershipOpen(false)} onSaved={() => { setMembershipOpen(false); refresh(); }} />}
  </Page>;
}

function PlanModal({ mode, plan, services, onClose, onSaved }: { mode: "create" | "view" | "edit"; plan?: Plan; services: Service[]; onClose: () => void; onSaved: () => void }) {
  const readOnly = mode === "view";
  const [form, setForm] = useState({ name: plan?.name ?? "Pacote 4 Banhos Mensais", serviceId: plan?.service.id ?? services[0]?.id ?? "", usageQuantity: String(plan?.usageQuantity ?? 4), validityDays: String(plan?.validityDays ?? 30), suggestedFrequencyDays: String(plan?.suggestedFrequencyDays ?? 7), priceCents: centsFromCurrency(plan?.price ?? 200), active: plan?.active ?? true });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  function setIntegerField(field: "usageQuantity" | "validityDays" | "suggestedFrequencyDays", value: string) {
    const digits = onlyDigits(value).replace(/^0+(?=\d)/, "");
    setForm({ ...form, [field]: digits || "1" });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const body = { name: form.name, serviceId: form.serviceId, usageQuantity: Number(form.usageQuantity), validityDays: Number(form.validityDays), suggestedFrequencyDays: Number(form.suggestedFrequencyDays), price: decimalFromCents(form.priceCents), active: form.active };
    await api(plan ? `/memberships/plans/${plan.id}` : "/memberships/plans", { method: plan ? "PATCH" : "POST", body: JSON.stringify(body) });
    setMessage(plan ? "Plano atualizado com sucesso." : "Plano criado com sucesso.");
    if (!plan) setForm({ name: "Pacote 4 Banhos Mensais", serviceId: services[0]?.id ?? "", usageQuantity: "4", validityDays: "30", suggestedFrequencyDays: "7", priceCents: "20000", active: true });
    setTimeout(onSaved, 500);
  }
  return <Modal title={mode === "create" ? "Criar plano" : mode === "edit" ? "Editar plano" : "Plano"} onClose={onClose}><form className="grid gap-3 md:grid-cols-2" onSubmit={submit}><label className="text-sm font-medium">Nome do plano<input className="field mt-1" disabled={readOnly} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label className="text-sm font-medium">Serviço incluído<select className="field mt-1" disabled={readOnly} value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label className="text-sm font-medium">Quantidade de usos<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={form.usageQuantity} onChange={(e) => setIntegerField("usageQuantity", e.target.value)} /></label><label className="text-sm font-medium">Validade em dias<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={form.validityDays} onChange={(e) => setIntegerField("validityDays", e.target.value)} /></label><label className="text-sm font-medium">Frequência sugerida em dias<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={form.suggestedFrequencyDays} onChange={(e) => setIntegerField("suggestedFrequencyDays", e.target.value)} /></label><label className="text-sm font-medium">Valor do plano<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={formatCurrencyInput(form.priceCents)} onChange={(e) => setForm({ ...form, priceCents: onlyDigits(e.target.value) })} /></label><label className="flex items-center gap-2 text-sm font-medium"><input disabled={readOnly} type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Ativo</label>{message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 md:col-span-2">{message}</p>}{!readOnly && <button className="btn btn-primary justify-self-end md:col-span-2">Salvar plano</button>}</form></Modal>;
}

function DeletePlanModal({ plan, onClose, onDeleted }: { plan: Plan; onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api(`/memberships/plans/${plan.id}`, { method: "DELETE", body: JSON.stringify({ password }) });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível apagar o plano.");
    } finally {
      setLoading(false);
    }
  }
  return <Modal title="Apagar plano" onClose={onClose}><form className="grid gap-3" onSubmit={submit}><p className="text-sm text-slate-600">Confirme a senha do administrador para apagar o plano <b>{plan.name}</b>. Se houver mensalidades vinculadas, o plano será apenas desativado para preservar o histórico.</p><label className="text-sm font-medium">Senha do administrador<input className="field mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={loading || !password}>{loading ? "Validando..." : "Apagar"}</button></div></form></Modal>;
}

function MembershipForm({ plans, onCreateCustomer, onClose, onSaved }: { plans: Plan[]; onCreateCustomer: () => void; onClose: () => void; onSaved: () => void }) {
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);
  const [petId, setPetId] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [error, setError] = useState("");
  const activePets = selectedCustomer?.pets.filter((pet) => pet.status === "ACTIVE") ?? [];
  const selectedPetId = petId || (activePets.length === 1 ? activePets[0].id : "");
  const duplicateActive = selectedCustomer?.memberships?.some((membership) => membership.status === "ACTIVE" && membership.pet.id === selectedPetId && membership.plan.id === planId);

  useEffect(() => {
    const search = customerQuery.trim();
    if (selectedCustomer || search.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api<Customer[]>(`/customers/search?q=${encodeURIComponent(search)}`)
        .then((items) => { if (active) setResults(items); })
        .catch(() => { if (active) setResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerQuery, selectedCustomer]);

  useEffect(() => {
    if (!selectedCustomer) {
      setPetId("");
      return;
    }
    const matchedPet = activePets.find((pet) => pet.id === selectedCustomer.matchedPetId);
    if (matchedPet) setPetId(matchedPet.id);
    else if (activePets.length === 1) setPetId(activePets[0].id);
    else if (!activePets.some((pet) => pet.id === petId)) setPetId("");
  }, [selectedCustomer?.id]);

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerQuery(`${customerCode(customer)} — ${customer.name}`);
    setResults([]);
    setSearchTouched(false);
    setError("");
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerQuery("");
    setResults([]);
    setPetId("");
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!selectedCustomer || !selectedPetId || !planId) return;
    if (duplicateActive) {
      setError("Este cliente já possui uma mensalidade ativa para este plano.");
      return;
    }
    try {
      await api("/memberships", { method: "POST", body: JSON.stringify({ customerId: selectedCustomer.id, petId: selectedPetId, planId, startDate: new Date().toISOString() }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ativar a mensalidade.");
    }
  }

  return <Modal title="Ativar Mensalidade" onClose={onClose}><form className="grid gap-3" onSubmit={submit}>
    <label className="relative text-sm font-medium">Buscar cliente
      <div className="mt-1 flex gap-2">
        <input className="field min-h-11 flex-1" placeholder="Digite nome, pet, CPF, celular ou código" value={customerQuery} onFocus={() => setSearchTouched(true)} onChange={(event) => { setSelectedCustomer(null); setCustomerQuery(event.target.value); setSearchTouched(true); setPetId(""); setError(""); }} />
        {selectedCustomer && <button className="btn btn-secondary" type="button" onClick={clearCustomer}>Limpar</button>}
      </div>
      {!selectedCustomer && searchTouched && customerQuery.trim().length >= 2 && <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
        {searching && <p className="p-3 text-sm text-slate-500">Buscando clientes...</p>}
        {!searching && results.map((customer) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={customer.id} type="button" onClick={() => selectCustomer(customer)}>
          <b>{customerCode(customer)} — {customer.name}</b>
          {customer.matchedPetName && <p className="text-blue-700">Pet encontrado: {customer.matchedPetName}</p>}
          <p className="text-slate-600">CPF: {formatCpf(customer.cpf)}</p>
          <p className="text-slate-600">Celular: {formatPhone(customer.phone)}</p>
          <p className="text-slate-600">Pets: {customer.pets.map((pet) => pet.name).join(", ") || "-"}</p>
        </button>)}
        {!searching && !results.length && <div className="grid gap-2 p-3 text-sm text-slate-600"><p>Nenhum cliente encontrado.</p><button className="btn btn-primary justify-self-start" type="button" onClick={onCreateCustomer}>+ Cadastrar novo cliente</button></div>}
      </div>}
    </label>
    {selectedCustomer && <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900"><b>{customerCode(selectedCustomer)} — {selectedCustomer.name}</b><p>{formatCpf(selectedCustomer.cpf)} · {formatPhone(selectedCustomer.phone)}</p></div>}
    {selectedCustomer && activePets.length === 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Este cliente ainda não possui pet cadastrado.</p>}
    {selectedCustomer && activePets.length === 1 && <div className="rounded-md border border-slate-200 p-3 text-sm"><b>Pet selecionado</b><p className="text-slate-600">{activePets[0].name}</p></div>}
    {selectedCustomer && activePets.length > 1 && <label className="text-sm font-medium">Pet<select className="field mt-1" required value={selectedPetId} onChange={(event) => setPetId(event.target.value)}><option value="">Selecione o pet</option>{activePets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></label>}
    <label className="text-sm font-medium">Plano<select className="field mt-1" required value={planId} onChange={(event) => { setPlanId(event.target.value); setError(""); }}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} - {currency(plan.price)}</option>)}</select></label>
    {duplicateActive && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Este cliente já possui uma mensalidade ativa para este plano.</p>}
    {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <button className="btn btn-primary justify-self-end" disabled={!selectedCustomer || !selectedPetId || !planId || plans.length === 0}>Ativar</button>
  </form></Modal>;
}

function Appointments({ onCharge, onRenewMembership }: { onCharge: (appointment: Appointment) => void; onRenewMembership: () => void }) {
  const { data, refresh } = useData<Appointment[]>("/appointments");
  const { data: services } = useData<Service[]>("/catalog/services");
  const [open, setOpen] = useState(false);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedDate, setSelectedDate] = useState(localDateInput());
  const [calendarMonth, setCalendarMonth] = useState(localDateInput());
  const [view, setView] = useState<"day" | "week" | "month">("day");
  const [initialTime, setInitialTime] = useState("09:00");
  const [search, setSearch] = useState("");
  const [loadingId, setLoadingId] = useState("");
  async function move(id: string, status: string) {
    setLoadingId(id);
    try {
      const updated = await api<Appointment>(`/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setSelectedAppointment((current) => current?.id === id ? { ...current, ...updated } : current);
      refresh();
    }
    finally { setLoadingId(""); }
  }
  const query = search.trim().toLowerCase();
  const allAppointments = (data ?? []).filter((appointment) => appointment.status !== "CANCELLED");
  const matchesSearch = (appointment: Appointment) => {
    if (!query) return true;
    const digits = onlyDigits(query);
    return [appointment.customer.name, appointment.pet.name, appointment.service.name, appointment.customer.cpf, appointment.customer.phone]
      .some((value) => value?.toLowerCase().includes(query) || (digits && onlyDigits(value ?? "").includes(digits)));
  };
  const dayAppointments = (date: string) => allAppointments.filter((appointment) => appointment.date.slice(0, 10) === date).filter(matchesSearch);
  const periodAppointments = view === "day" ? dayAppointments(selectedDate) : view === "week" ? weekDays(selectedDate).flatMap(dayAppointments) : monthDays(selectedDate).filter((day) => sameMonth(day, selectedDate)).flatMap(dayAppointments);
  const daysWithAppointments = new Set(allAppointments.map((appointment) => appointment.date.slice(0, 10)));
  const hours = Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, "0")}:00`);
  function openAt(time: string, date = selectedDate) {
    setSelectedDate(date);
    setInitialTime(time);
    setOpen(true);
  }
  function shiftPeriod(direction: -1 | 1) {
    if (view === "day") {
      const next = addDays(selectedDate, direction);
      setSelectedDate(next);
      setCalendarMonth(next);
    }
    if (view === "week") {
      const next = addDays(selectedDate, direction * 7);
      setSelectedDate(next);
      setCalendarMonth(next);
    }
    if (view === "month") {
      const next = addMonths(selectedDate, direction);
      setSelectedDate(next);
      setCalendarMonth(next);
    }
  }
  function selectCalendarDay(date: string) {
    setSelectedDate(date);
    setCalendarMonth(date);
    setView("day");
    setCalendarOpen(false);
  }
  function appointmentCard(appointment: Appointment, compact = false) {
    const color = appointmentColor(appointment.status);
    const membership = appointment.membership;
    const usage = appointment.membershipUsage;
    return <button className={`rounded-lg border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${color.card}`} key={appointment.id} onClick={() => setSelectedAppointment(appointment)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${color.dot}`} /><b>{compact ? `${appointment.startTime} - ${appointment.pet.name}` : appointment.pet.name}</b></div>
          <p className="mt-1 text-sm text-slate-700">{appointment.customer.name}</p>
          <p className="text-sm font-medium text-slate-800">{appointment.service.name}</p>
          {!!appointment.extraServices?.length && <p className="text-xs text-slate-600">+ {appointment.extraServices.length} serviço{appointment.extraServices.length === 1 ? "" : "s"} avulso{appointment.extraServices.length === 1 ? "" : "s"}</p>}
          {!compact && membership && usage && <div className="mt-2 grid gap-1 text-xs text-slate-700"><span className="badge w-fit bg-emerald-50 text-emerald-800">Mensalista</span><p>{membership.plan.name}</p><p>{usage.status === "RESERVED" ? "Uso reservado" : usage.status === "CONSUMED" ? `Pacote utilizado · Uso ${usage.usageNumber} de ${membership.totalUses}` : "Reserva liberada"}</p><p>{usage.status === "CONSUMED" ? `Restam ${usage.balanceAfter ?? membership.remainingUses} usos` : `${Math.max(0, membership.remainingUses - (membership.usages?.length ?? membership.reservedUses ?? 0))} disponíveis`}</p></div>}
          {!compact && appointment.membershipRenewal?.status === "PENDING_PAYMENT" && <div className="mt-2 grid gap-1 text-xs text-amber-900"><span className="badge w-fit bg-amber-100 text-amber-900">Renovação pendente</span><p>{appointment.membershipRenewal.plan.name}</p><p>Cobrar {currency(appointment.membershipRenewal.priceSnapshot)} no Caixa</p></div>}
        </div>
        {!compact && <div className="text-right text-sm"><p>{appointmentBadge(appointment)}</p><p className="mt-6 font-semibold">{currency(appointment.service.price)}</p></div>}
      </div>
    </button>;
  }
  function miniCalendar() {
    const today = localDateInput();
    return <div className="panel h-fit p-3">
      <div className="mb-3 flex items-center justify-between">
        <button className="btn btn-secondary px-3" onClick={() => setCalendarMonth(addMonths(calendarMonth, -1))}>◀</button>
        <b className="capitalize">{calendarTitle(calendarMonth)}</b>
        <button className="btn btn-secondary px-3" onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}>▶</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">{["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">{monthDays(calendarMonth).map((day) => {
        const selected = day === selectedDate;
        const todayClass = day === today;
        const inMonth = sameMonth(day, calendarMonth);
        return <button type="button" key={day} onClick={() => selectCalendarDay(day)} className={`relative rounded-md p-2 text-sm ${selected ? "bg-brand-600 text-white" : todayClass ? "bg-blue-50 font-semibold text-blue-700" : inMonth ? "hover:bg-slate-100" : "text-slate-300 hover:bg-slate-50"}`}>
          {parseLocalDate(day).getDate()}
          {daysWithAppointments.has(day) && <span className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${selected ? "bg-white" : "bg-brand-600"}`} />}
        </button>;
      })}</div>
    </div>;
  }
  return <Page title="Agenda" action={<button className="btn btn-primary" onClick={() => openAt("09:00")}><Plus size={16} />Novo Agendamento</button>}>
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="hidden lg:block">{miniCalendar()}</aside>
      <div className="lg:hidden"><button className="btn btn-secondary w-full" onClick={() => setCalendarOpen(true)}>Escolher data</button></div>
    <div className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button className={`btn ${view === "day" && selectedDate === localDateInput() ? "btn-primary" : "btn-secondary"}`} onClick={() => { const today = localDateInput(); setView("day"); setSelectedDate(today); setCalendarMonth(today); }}>Hoje</button>
          <button className={`btn ${view === "week" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("week")}>Semana</button>
          <button className="btn btn-secondary px-3" onClick={() => shiftPeriod(-1)}>◀</button>
          <span className="font-medium capitalize">{periodTitle(view, selectedDate)}</span>
          <button className="btn btn-secondary px-3" onClick={() => shiftPeriod(1)}>▶</button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} />
            <input className="field w-full pl-9 sm:w-72" placeholder="Buscar cliente, pet, telefone, CPF ou serviço" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <span className="text-sm font-semibold text-slate-700">🐶 {periodAppointments.length} Atendimentos</span>
        </div>
      </div>
      {view === "day" && <><div className="hidden max-h-[70vh] overflow-y-auto md:block">{hours.map((hour) => <div className="grid min-h-24 grid-cols-[72px_1fr] border-b border-slate-100" key={hour}><button className="border-r border-slate-100 p-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => openAt(hour)}>{hour}</button><div className="grid gap-2 p-3" onClick={(event) => { if (event.currentTarget === event.target) openAt(hour); }}>{dayAppointments(selectedDate).filter((appointment) => appointment.startTime.slice(0, 2) === hour.slice(0, 2)).map((appointment) => appointmentCard(appointment))}</div></div>)}</div><div className="grid gap-3 p-3 md:hidden">{dayAppointments(selectedDate).map((appointment) => appointmentCard(appointment, true))}{!dayAppointments(selectedDate).length && <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">Nenhum atendimento encontrado para este dia.</p>}</div></>}
      {view === "week" && <><div className="hidden max-h-[70vh] overflow-auto md:block"><div className="grid min-w-[980px] grid-cols-[72px_repeat(7,1fr)] border-b border-slate-100 bg-slate-50">{["", ...weekDays(selectedDate)].map((day, index) => <div className="p-2 text-center text-sm font-semibold capitalize" key={index}>{day && parseLocalDate(day).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" })}</div>)}</div>{hours.map((hour) => <div className="grid min-w-[980px] grid-cols-[72px_repeat(7,1fr)] border-b border-slate-100" key={hour}><div className="border-r border-slate-100 p-2 text-sm font-semibold text-slate-700">{hour}</div>{weekDays(selectedDate).map((day) => <div className={`min-h-28 border-r border-slate-100 p-2 text-left hover:bg-slate-50 ${day === localDateInput() ? "bg-blue-50/50" : ""}`} key={`${day}-${hour}`} onClick={(event) => { if (event.currentTarget === event.target) openAt(hour, day); }}>{dayAppointments(day).filter((appointment) => appointment.startTime.slice(0, 2) === hour.slice(0, 2)).map((appointment) => appointmentCard(appointment, true))}</div>)}</div>)}</div><div className="grid gap-3 p-3 md:hidden">{weekDays(selectedDate).map((day) => <section className="grid gap-2" key={day}><h3 className="font-semibold capitalize">{parseLocalDate(day).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</h3>{dayAppointments(day).map((appointment) => appointmentCard(appointment, true))}<button className="btn btn-secondary justify-self-start" onClick={() => openAt("09:00", day)}>Novo neste dia</button></section>)}</div></>}
      {view === "month" && <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:grid-cols-7">{monthDays(selectedDate).map((day) => {
        const appointmentsOnDay = dayAppointments(day);
        return <button className={`min-h-28 rounded-lg border p-2 text-left hover:bg-slate-50 ${day === localDateInput() ? "border-blue-300 bg-blue-50/60" : "border-slate-200"} ${!sameMonth(day, selectedDate) ? "opacity-40" : ""}`} key={day} onClick={() => selectCalendarDay(day)}>
          <div className="mb-2 flex items-center justify-between"><b>{parseLocalDate(day).getDate()}</b>{appointmentsOnDay.length > 0 && <span className="badge bg-slate-100 text-slate-700">{appointmentsOnDay.length}</span>}</div>
          <div className="grid gap-1">{appointmentsOnDay.slice(0, 3).map((appointment) => <span className="truncate rounded bg-brand-50 px-2 py-1 text-xs text-brand-700" key={appointment.id}>{appointment.startTime} {appointment.pet.name}</span>)}</div>
        </button>;
      })}</div>}
    </div>
    </div>
    {calendarOpen && <Modal title="Escolher data" onClose={() => setCalendarOpen(false)}>{miniCalendar()}</Modal>}
    {selectedAppointment && <AppointmentDrawer appointment={selectedAppointment} loadingId={loadingId} onClose={() => setSelectedAppointment(null)} onMove={move} onCharge={onCharge} />}
    {open && <AppointmentForm services={services ?? []} initialDate={selectedDate} initialTime={initialTime} onCreateCustomer={() => setCustomerFormOpen(true)} onRenewMembership={() => { setOpen(false); onRenewMembership(); }} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); refresh(); }} />}
    {customerFormOpen && <CustomerForm onClose={() => setCustomerFormOpen(false)} onSaved={() => setCustomerFormOpen(false)} />}
  </Page>;
}

function AppointmentDrawer({ appointment, loadingId, onClose, onMove, onCharge }: { appointment: Appointment; loadingId: string; onClose: () => void; onMove: (id: string, status: string) => void; onCharge: (appointment: Appointment) => void }) {
  const membership = appointment.membership;
  const usage = appointment.membershipUsage;
  const order = appointment.sales?.[0];
  const coveredByPackage = appointment.paymentMode === "PACKAGE" && usage?.status === "CONSUMED";
  const chargeableTotal = Number(order?.pendingAmount ?? order?.total ?? 0);
  const canCharge = appointment.status === "FINISHED" && !!order && chargeableTotal > 0 && order.status !== "PAID" && order.status !== "CANCELLED";
  const noChargeRequired = appointment.status === "FINISHED" && coveredByPackage && chargeableTotal <= 0;
  return <div className="fixed inset-0 z-40 bg-slate-950/30" onClick={onClose}>
    <aside className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <div>
          <h2 className="text-lg font-semibold">{appointment.pet.name}</h2>
          <p className="text-sm text-slate-500">{dateBR(appointment.date)} às {appointment.startTime}</p>
        </div>
        <button className="btn btn-secondary" onClick={onClose}>Fechar</button>
      </div>
      <div className="grid gap-4 overflow-y-auto p-5 text-sm">
        <section>
          <h3 className="mb-2 font-semibold">Cliente</h3>
          <div className="rounded-lg bg-slate-50 p-3">
            <p><b>Tutor:</b> {appointment.customer.name}</p>
            <p><b>Telefone:</b> {formatPhone(appointment.customer.phone)}</p>
            <p><b>CPF:</b> {formatCpf(appointment.customer.cpf)}</p>
          </div>
        </section>
        <section>
          <h3 className="mb-2 font-semibold">Atendimento</h3>
          <div className="rounded-lg bg-slate-50 p-3">
            <p><b>Serviço:</b> {appointment.service.name}</p>
            {!!appointment.extraServices?.length && <div className="mt-2"><p><b>Serviços avulsos adicionais:</b></p>{appointment.extraServices.map((extra) => <p key={extra.id}>{extra.nameSnapshot} — {currency(extra.priceSnapshot)}</p>)}</div>}
            <p><b>Status:</b> {statusLabels[appointment.status] ?? appointment.status}</p>
            <p><b>Forma:</b> {appointment.paymentMode === "PACKAGE" ? "Pacote" : appointment.paymentMode === "RENEWAL_AT_CHECKOUT" ? "Renovação no Caixa" : "Avulso"}</p>
            <p><b>Pagamento:</b> {noChargeRequired ? "Não necessário — coberto pelo pacote" : appointment.paymentMode === "PACKAGE" ? "Pacote + serviços avulsos" : appointment.paymentMode === "RENEWAL_AT_CHECKOUT" ? "Renovação aguardando pagamento" : paymentStatusLabels[appointment.paymentStatus] ?? appointment.paymentStatus}</p>
            <p><b>{coveredByPackage && chargeableTotal > 0 ? "Valor a receber" : "Valor"}:</b> {coveredByPackage ? currency(chargeableTotal) : appointment.membershipRenewal ? currency(appointment.membershipRenewal.priceSnapshot) : currency(order?.total ?? appointment.service.price)}</p>
            {order && <p className="mt-2 flex items-center gap-2"><b>Pedido:</b> <span className="badge bg-blue-50 font-semibold text-blue-700">{saleCode(order as Pick<Sale, "internalCode">)}</span></p>}
          </div>
        </section>
        {membership && usage && <section><h3 className="mb-2 font-semibold">Mensalidade</h3><div className="grid gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><p><b>Plano:</b> {membership.plan.name}</p><p><b>Saldo antes:</b> {usage.balanceBefore}</p><p><b>Uso deste atendimento:</b> 1</p><p><b>Saldo após conclusão:</b> {usage.status === "CONSUMED" ? usage.balanceAfter : Math.max(0, usage.balanceBefore - 1)}</p><p><b>Status do uso:</b> {usage.status === "RESERVED" ? "Reservado" : usage.status === "CONSUMED" ? "Consumido" : "Liberado"}</p>{usage.usageNumber && <p><b>Sequência:</b> Uso {usage.usageNumber} de {membership.totalUses}</p>}</div></section>}
        {appointment.membershipRenewal && <section><h3 className="mb-2 font-semibold">Renovação</h3><div className="grid gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3"><p><b>Plano:</b> {appointment.membershipRenewal.plan.name}</p><p><b>Valor:</b> {currency(appointment.membershipRenewal.priceSnapshot)}</p><p><b>Status:</b> {appointment.membershipRenewal.status === "PENDING_PAYMENT" ? "Aguardando pagamento no Caixa" : appointment.membershipRenewal.status === "PAID" ? "Paga" : "Cancelada"}</p></div></section>}
        {appointment.notes && <section><h3 className="mb-2 font-semibold">Observações</h3><p className="rounded-lg bg-slate-50 p-3">{appointment.notes}</p></section>}
        <section>
          <h3 className="mb-2 font-semibold">Próximas ações</h3>
          <div className="flex flex-wrap gap-2">
            <button disabled={appointment.status !== "SCHEDULED" || loadingId === appointment.id} className="btn btn-secondary disabled:opacity-40" onClick={() => onMove(appointment.id, "ARRIVED")}>Chegou</button>
            <button disabled={appointment.status !== "ARRIVED" || loadingId === appointment.id} className="btn btn-secondary disabled:opacity-40" onClick={() => onMove(appointment.id, "IN_SERVICE")}>Iniciar atendimento</button>
            <button disabled={appointment.status !== "IN_SERVICE" || loadingId === appointment.id} className="btn btn-primary disabled:opacity-40" onClick={() => onMove(appointment.id, "FINISHED")}>Finalizar</button>
            {canCharge ? <button disabled={loadingId === appointment.id} className="btn btn-primary disabled:opacity-40" onClick={() => onCharge(appointment)}>{loadingId === appointment.id ? "Abrindo caixa..." : "Cobrar"}</button> : appointment.status === "FINISHED" && order?.status === "PAID" ? <span className="badge bg-emerald-50 text-emerald-700">Pagamento concluído</span> : noChargeRequired ? <span className="badge bg-emerald-50 text-emerald-700">Sem cobrança pendente</span> : null}
            <button disabled={!["SCHEDULED", "ARRIVED"].includes(appointment.status) || loadingId === appointment.id} className="btn btn-secondary text-red-700 disabled:opacity-40" onClick={() => onMove(appointment.id, "CANCELLED")}>Cancelar</button>
          </div>
        </section>
      </div>
    </aside>
  </div>;
}

function AppointmentForm({ services, initialDate, initialTime, onCreateCustomer, onRenewMembership, onClose, onSaved }: { services: Service[]; initialDate?: string; initialTime?: string; onCreateCustomer: () => void; onRenewMembership: () => void; onClose: () => void; onSaved: () => void }) {
  const [customerQuery, setCustomerQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ petId: "", serviceId: "", date: initialDate ?? localDateInput(), startTime: initialTime ?? "09:00", notes: "" });
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [saving, setSaving] = useState(false);
  const [membershipOptions, setMembershipOptions] = useState<Membership[]>([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipsError, setMembershipsError] = useState("");
  const [selectedMembershipId, setSelectedMembershipId] = useState("");
  const [paymentMode, setPaymentMode] = useState<"AVULSO" | "PACKAGE" | "RENEWAL_AT_CHECKOUT">("AVULSO");
  const [renewalConfirmed, setRenewalConfirmed] = useState(false);
  const [additionalServiceIds, setAdditionalServiceIds] = useState<string[]>([]);
  const [serviceSelectionError, setServiceSelectionError] = useState("");
  const activePets = selectedCustomer?.pets.filter((pet) => pet.status === "ACTIVE") ?? [];
  const petId = form.petId || activePets[0]?.id;
  const additionalServices = additionalServiceIds.map((id) => services.find((service) => service.id === id)).filter((service): service is Service => Boolean(service));
  const additionalTotal = additionalServices.reduce((sum, service) => sum + Number(service.price), 0);
  useEffect(() => {
    const query = customerQuery.trim();
    if (selectedCustomer || query.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      api<Customer[]>(`/customers/search?q=${encodeURIComponent(query)}`)
        .then(setResults)
        .catch((error) => {
          setResults([]);
          setSearchError(isConnectionError(error) ? "" : error instanceof Error ? error.message : "Não foi possível buscar clientes.");
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerQuery, selectedCustomer?.id]);
  useEffect(() => {
    setSelectedMembershipId("");
    setPaymentMode("AVULSO");
    setRenewalConfirmed(false);
    setMembershipsError("");
    if (!petId) {
      setMembershipOptions([]);
      return;
    }
    let active = true;
    setMembershipsLoading(true);
    api<Membership[]>(`/memberships/pet/${petId}/options`)
      .then((options) => { if (active) setMembershipOptions(options); })
      .catch((error) => {
        if (active) {
          setMembershipOptions([]);
          setMembershipsError(isConnectionError(error) ? "" : error instanceof Error ? error.message : "Não foi possível consultar as mensalidades deste pet.");
        }
      })
      .finally(() => { if (active) setMembershipsLoading(false); });
    return () => { active = false; };
  }, [petId]);
  function selectCustomer(customer: Customer) {
    const pets = customer.pets.filter((pet) => pet.status === "ACTIVE");
    const matchedPet = pets.find((pet) => pet.id === customer.matchedPetId);
    setSelectedCustomer(customer);
    setCustomerQuery(`${customerCode(customer)} — ${customer.name}`);
    setResults([]);
    setForm({ ...form, petId: matchedPet?.id ?? (pets.length === 1 ? pets[0].id : "") });
  }
  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerQuery("");
    setResults([]);
    setForm({ ...form, petId: "" });
    setMembershipOptions([]);
    setSelectedMembershipId("");
    setPaymentMode("AVULSO");
    setRenewalConfirmed(false);
    setAdditionalServiceIds([]);
    setServiceSelectionError("");
  }
  function addAdditionalService(serviceId: string) {
    setServiceSelectionError("");
    if (!serviceId) return;
    if (paymentMode !== "AVULSO" && form.serviceId === serviceId) {
      setServiceSelectionError("Este serviço já está incluído no pacote selecionado.");
      return;
    }
    if (additionalServiceIds.includes(serviceId)) {
      setServiceSelectionError("Este serviço já foi adicionado ao agendamento.");
      return;
    }
    setAdditionalServiceIds((current) => [...current, serviceId]);
  }
  function selectPackage(membership: Membership, mode: "PACKAGE" | "RENEWAL_AT_CHECKOUT") {
    const coveredServiceId = membership.plan.service.id;
    setSelectedMembershipId(membership.id);
    setPaymentMode(mode);
    setRenewalConfirmed(false);
    setForm((current) => ({ ...current, serviceId: coveredServiceId }));
    if (additionalServiceIds.includes(coveredServiceId)) {
      setAdditionalServiceIds((current) => current.filter((id) => id !== coveredServiceId));
      setServiceSelectionError("Este serviço já está incluído no pacote selecionado e foi retirado dos adicionais.");
    } else {
      setServiceSelectionError("");
    }
    setError("");
  }
  function removePackage() {
    setSelectedMembershipId("");
    setPaymentMode("AVULSO");
    setRenewalConfirmed(false);
    setForm((current) => ({ ...current, serviceId: additionalServiceIds[0] ?? "" }));
    setServiceSelectionError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (isPastDate(form.date)) {
      setError("Não é permitido agendar em uma data que já passou.");
      return;
    }
    if (!selectedCustomer || !petId) return;
    const primaryServiceId = paymentMode === "AVULSO" ? additionalServiceIds[0] : form.serviceId;
    const persistedAdditionalServiceIds = paymentMode === "AVULSO" ? additionalServiceIds.slice(1) : additionalServiceIds;
    if (!primaryServiceId) {
      setError("Adicione ao menos um serviço ao agendamento.");
      return;
    }
    try {
      setSaving(true);
      const selectedMembership = membershipOptions.find((membership) => membership.id === selectedMembershipId);
      await api("/appointments", { method: "POST", body: JSON.stringify({
        ...form,
        serviceId: primaryServiceId,
        customerId: selectedCustomer.id,
        petId,
        paymentMode,
        membershipId: paymentMode === "PACKAGE" ? selectedMembershipId : undefined,
        renewalPlanId: paymentMode === "RENEWAL_AT_CHECKOUT" ? selectedMembership?.plan.id : undefined,
        additionalServiceIds: persistedAdditionalServiceIds
      }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o agendamento.");
    } finally {
      setSaving(false);
    }
  }
  return <Modal title="Novo Agendamento" onClose={onClose}><form className="grid gap-3" onSubmit={submit}>
    <div className="relative">
      <label className="text-sm font-medium text-slate-700">Buscar cliente<input className="field mt-1" placeholder="Digite nome, CPF, celular, pet, rua ou código" value={customerQuery} onChange={(e) => { setSelectedCustomer(null); setCustomerQuery(e.target.value); }} /></label>
      {selectedCustomer && <button className="btn btn-secondary mt-2" type="button" onClick={clearCustomer}>Limpar seleção</button>}
      {!selectedCustomer && customerQuery.trim().length >= 2 && <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
        {searching && <p className="p-3 text-sm text-slate-500">Buscando clientes...</p>}
        {!searching && searchError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{searchError}</p>}
        {!searching && results.map((customer) => <button className="w-full rounded-lg p-3 text-left text-sm hover:bg-slate-50" key={customer.id} type="button" onClick={() => selectCustomer(customer)}>
          <div className="font-semibold">{customerCode(customer)} — {customer.name}</div>
          {customer.matchedPetName && <p className="text-blue-700">Pet encontrado: {customer.matchedPetName}</p>}
          <p className="text-slate-600">CPF: {formatCpf(customer.cpf)} · Celular: {formatPhone(customer.phone)}</p>
          <p className="text-slate-600">Pets: {customer.pets.map((pet) => pet.name).join(", ") || "-"}</p>
          <p className="text-slate-600">Endereço: {customer.street || "-"}</p>
        </button>)}
        {!searching && !searchError && !results.length && <div className="grid gap-2 p-3 text-sm text-slate-600"><p>Nenhum cliente encontrado</p><button className="btn btn-primary justify-self-start" type="button" onClick={onCreateCustomer}>+ Cadastrar novo cliente</button></div>}
      </div>}
    </div>
    {selectedCustomer && <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900"><b>{customerCode(selectedCustomer)} — {selectedCustomer.name}</b><p>{formatPhone(selectedCustomer.phone)} · {formatCpf(selectedCustomer.cpf)}</p></div>}
    {selectedCustomer && activePets.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Este cliente ainda não possui pet cadastrado.</p>}
    {selectedCustomer && activePets.length === 1 && <div className="rounded-lg bg-slate-50 p-3 text-sm"><b>Pet:</b> {activePets[0].name}</div>}
    {selectedCustomer && activePets.length > 1 && <label className="text-sm font-medium text-slate-700">Pet<select className="field mt-1" value={form.petId} onChange={(e) => setForm({ ...form, petId: e.target.value })}>{activePets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></label>}
    {membershipsLoading && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Consultando mensalidades deste pet...</p>}
    {membershipsError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{membershipsError}</p>}
    {!membershipsLoading && membershipOptions.length > 0 && <section className="grid gap-2">
      <h3 className="text-sm font-semibold text-emerald-900">Serviços do pacote</h3>
      {membershipOptions.map((membership) => {
        const selected = paymentMode !== "AVULSO" && selectedMembershipId === membership.id;
        const available = membership.availableUses ?? membership.remainingUses;
        const reserved = membership.reservedUses ?? 0;
        const expired = membership.unavailableReason === "EXPIRED";
        return <div className={`rounded-lg border p-4 text-sm ${selected ? "border-emerald-500 bg-emerald-50" : membership.usable ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50"}`} key={membership.id}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="grid gap-1">
              <b>{membership.plan.name}</b>
              <p>{membership.plan.service.name}</p>
              <p className="text-base font-semibold">Disponível: {available} de {membership.totalUses} usos</p>
              <p>{available} disponíveis{reserved > 0 ? ` • ${reserved} reservado${reserved === 1 ? "" : "s"}` : ""}</p>
              <p>Válido até {dateBR(membership.endDate)}</p>
              <p>Status: {expired ? "Vencida" : membership.unavailableReason === "PENDING_PAYMENT" ? "Aguardando pagamento" : membership.unavailableReason === "INACTIVE" ? "Inativa" : membership.unavailableReason === "NO_BALANCE" ? "Sem saldo" : "Ativa"}</p>
              {expired && <p className="font-medium text-amber-900">Mensalidade vencida em {dateBR(membership.endDate)}.</p>}
              {membership.unavailableReason === "PENDING_PAYMENT" && <p className="font-medium text-amber-900">Esta mensalidade ainda não foi paga e não possui saldo liberado.</p>}
              {!expired && !membership.usable && <p className="font-medium text-amber-900">Este pet não possui utilizações disponíveis. Renove a mensalidade para usar o pacote.</p>}
            </div>
            <div className="grid shrink-0 gap-2">
              {membership.usable && selected && paymentMode === "PACKAGE" ? <button className="btn btn-secondary min-h-11 justify-center text-red-700" type="button" onClick={removePackage}>Remover pacote</button> : membership.usable && <button className="btn btn-secondary min-h-11 justify-center" type="button" onClick={() => selectPackage(membership, "PACKAGE")}>Usar pacote</button>}
              {!membership.usable && <button className="btn btn-secondary min-h-11 justify-center" type="button" onClick={onRenewMembership}>Renovar agora</button>}
              {!membership.usable && selected && paymentMode === "RENEWAL_AT_CHECKOUT" ? <button className="btn btn-secondary min-h-11 justify-center text-red-700" type="button" onClick={removePackage}>Remover renovação</button> : !membership.usable && <button className="btn btn-secondary min-h-11 justify-center" type="button" onClick={() => selectPackage(membership, "RENEWAL_AT_CHECKOUT")}>Cobrar renovação ao finalizar</button>}
            </div>
          </div>
        </div>;
      })}
    </section>}
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold text-slate-700">Serviços avulsos adicionais</h3>
      <select className="field w-full" value="" onChange={(event) => addAdditionalService(event.target.value)}>
        <option value="">Adicionar serviço avulso...</option>
        {services.map((service) => <option key={service.id} value={service.id}>{service.name} — {currency(service.price)}</option>)}
      </select>
      {serviceSelectionError && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{serviceSelectionError}</p>}
      {!!additionalServices.length && <div className="grid gap-2">{additionalServices.map((service) => <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" key={service.id}><div><b>{service.name}</b><p className="text-slate-600">{servicePetSizeLabel(service.petSize)} · {serviceCoatLabel(service.coat)}</p><p className="font-semibold text-blue-800">{currency(service.price)}</p></div><button className="btn btn-secondary min-h-11 justify-center text-red-700" type="button" onClick={() => { setAdditionalServiceIds((current) => current.filter((id) => id !== service.id)); setServiceSelectionError(""); }}>Remover</button></div>)}</div>}
    </section>
    <label className="text-sm font-medium text-slate-700">Data do atendimento<input className="field mt-1" type="date" min={localDateInput()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
    <label className="text-sm font-medium text-slate-700">Horário de início<input className="field mt-1" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></label>
    <label className="text-sm font-medium text-slate-700">Observações<textarea className="field mt-1" placeholder="Ex.: alergias, cuidados especiais ou combinado com o tutor" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
    <section className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <h3 className="font-semibold">Resumo</h3>
      {paymentMode !== "AVULSO" && <div><p><b>Serviço do pacote:</b> {services.find((service) => service.id === form.serviceId)?.name ?? "-"}</p><p className="text-emerald-800">Coberto pelo pacote</p></div>}
      <div><p><b>Serviços avulsos:</b></p>{additionalServices.length ? additionalServices.map((service) => <p key={service.id}>{service.name} — {currency(service.price)}</p>) : <p className="text-slate-500">Nenhum serviço avulso adicionado.</p>}</div>
      <p className="text-base"><b>Total avulso previsto:</b> {currency(additionalTotal)}</p>
      {paymentMode === "PACKAGE" && <p><b>Uso do pacote:</b> 1 utilização será reservada.</p>}
    </section>
    {paymentMode === "PACKAGE" && selectedMembershipId && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Uso do pacote será reservado agora e consumido somente ao finalizar o atendimento.</p>}
    {paymentMode === "RENEWAL_AT_CHECKOUT" && selectedMembershipId && <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Este atendimento será realizado com renovação pendente. A renovação será adicionada ao pedido no Caixa após a conclusão do atendimento.</p><label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={renewalConfirmed} onChange={(event) => setRenewalConfirmed(event.target.checked)} /><span>Confirmo que o valor do pacote deverá ser cobrado no Caixa ao finalizar.</span></label></div>}
    {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<button className="btn btn-primary justify-self-end disabled:opacity-60" disabled={saving || !selectedCustomer || !petId || (paymentMode === "AVULSO" ? !additionalServiceIds.length : !form.serviceId || !selectedMembershipId) || (paymentMode === "RENEWAL_AT_CHECKOUT" && !renewalConfirmed) || isPastDate(form.date)}>{saving ? "Salvando..." : "Salvar"}</button>
  </form></Modal>;
}

function Catalog({ isAdmin }: { isAdmin: boolean }) {
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive">("active");
  const { data: services, refresh: refreshServices } = useData<Service[]>(isAdmin ? "/catalog/services?includeInactive=true" : "/catalog/services", [isAdmin]);
  const { data: products, refresh: refreshProducts } = useData<Product[]>(isAdmin ? "/catalog/products?includeInactive=true" : "/catalog/products", [isAdmin]);
  const { data: productOptions, refresh: refreshProductOptions } = useData<ProductOptions>("/catalog/product-options");
  const [tab, setTab] = useState<"products" | "services">("products");
  const [query, setQuery] = useState("");
  const [productFilters, setProductFilters] = useState({ category: "", brand: "", supplier: "" });
  const [serviceFilters, setServiceFilters] = useState({ category: "", petSize: "", coat: "" });
  const [modal, setModal] = useState<CatalogModalState | null>(null);
  const [adminAction, setAdminAction] = useState<AdminCatalogAction | null>(null);
  const [reusableOpen, setReusableOpen] = useState(false);
  const [reusableEdit, setReusableEdit] = useState<ReusableEditTarget | null>(null);
  const search = query.trim().toLowerCase();
  const visibleProducts = (products ?? [])
    .filter((item) => isAdmin ? (statusFilter === "active" ? item.active : !item.active) : item.active)
    .filter((item) => [productCode(item), codeDigits(item), String(item.catalogCode ?? item.internalCode ?? ""), item.name, item.category, item.sku, item.barcode, item.brand, item.supplier].some((value) => value?.toLowerCase().includes(search)))
    .filter((item) => !productFilters.category || normalizeOption(item.category) === normalizeOption(productFilters.category))
    .filter((item) => !productFilters.brand || normalizeOption(item.brand) === normalizeOption(productFilters.brand))
    .filter((item) => !productFilters.supplier || normalizeOption(item.supplier) === normalizeOption(productFilters.supplier));
  const visibleServices = (services ?? [])
    .filter((item) => isAdmin ? (statusFilter === "active" ? item.active : !item.active) : item.active)
    .filter((item) => [serviceCode(item), codeDigits(item), String(item.catalogCode ?? item.internalCode ?? ""), item.name, item.category, item.petSize, item.coat, item.notes].some((value) => value?.toLowerCase().includes(search)))
    .filter((item) => !serviceFilters.category || normalizeOption(item.category) === normalizeOption(serviceFilters.category))
    .filter((item) => !serviceFilters.petSize || normalizeOption(item.petSize) === normalizeOption(serviceFilters.petSize))
    .filter((item) => !serviceFilters.coat || normalizeOption(item.coat) === normalizeOption(serviceFilters.coat));
  async function inactivate(type: "product" | "service", id: string, adminPassword: string) {
    await api(type === "service" ? `/catalog/services/${id}` : `/catalog/products/${id}`, { method: "DELETE", body: JSON.stringify({ adminPassword }) });
    type === "service" ? refreshServices() : refreshProducts();
  }
  async function afterAdminAuth(action: AdminCatalogAction, adminPassword: string) {
    if (action.action === "edit") {
      if (action.type === "product") setModal({ type: "product", mode: "edit", item: action.item, adminPassword });
      else setModal({ type: "service", mode: "edit", item: action.item, adminPassword });
    } else {
      await inactivate(action.type, action.item.id, adminPassword);
    }
    setAdminAction(null);
  }
  const emptyProductOptions = { categories: [], brands: [], suppliers: [], serviceCategories: [] };
  const catalogOptions = productOptions ?? emptyProductOptions;
  const serviceCategoryOptions = uniqueOptions([...catalogOptions.serviceCategories.map((option) => option.name), ...(services ?? []).map((item) => item.category)]);
  const serviceCoatFilterOptions = uniqueOptions([...serviceCoatOptions.filter((option) => option !== "Outro"), ...(services ?? []).map((item) => item.coat)]);
  const action = <div className="flex flex-wrap gap-2">
    {isAdmin && <button className="btn btn-secondary" onClick={() => setReusableOpen(true)}><Pencil size={16} />Editar cadastros</button>}
    {tab === "products"
      ? <button className="btn btn-primary" onClick={() => setModal({ type: "product", mode: "create" })}><Plus size={16} />Novo produto</button>
      : <button className="btn btn-primary" onClick={() => setModal({ type: "service", mode: "create" })}><Plus size={16} />Novo serviço</button>}
  </div>;
  return <Page title="Produtos e Serviços" action={action}>
    <div className="mb-4 flex flex-wrap gap-2">
      <button className={`btn ${tab === "products" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setTab("products"); setQuery(""); }}>Produtos</button>
      <button className={`btn ${tab === "services" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setTab("services"); setQuery(""); }}>Serviços</button>
    </div>
    {isAdmin && <div className="mb-4 flex flex-wrap gap-2">
      <button className={`btn ${statusFilter === "active" ? "btn-primary" : "btn-secondary"}`} onClick={() => setStatusFilter("active")}>Ativos</button>
      <button className={`btn ${statusFilter === "inactive" ? "btn-primary" : "btn-secondary"}`} onClick={() => setStatusFilter("inactive")}>{tab === "products" ? "Produtos inativos" : "Serviços inativos"}</button>
    </div>}
    <div className="panel mb-4 flex items-center gap-2 p-3"><Search size={18} className="text-slate-400" /><input className="w-full bg-transparent text-sm outline-none" placeholder={tab === "products" ? "Buscar código, produto, categoria, SKU, marca ou fornecedor" : "Buscar código, serviço, categoria ou porte"} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {tab === "products" && <div className="panel mb-4 grid gap-3 p-3 md:grid-cols-4">
      <select className="field" value={productFilters.category} onChange={(event) => setProductFilters({ ...productFilters, category: event.target.value })}><option value="">Todas as categorias</option>{catalogOptions.categories.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}</select>
      <select className="field" value={productFilters.brand} onChange={(event) => setProductFilters({ ...productFilters, brand: event.target.value })}><option value="">Todas as marcas</option>{catalogOptions.brands.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}</select>
      <select className="field" value={productFilters.supplier} onChange={(event) => setProductFilters({ ...productFilters, supplier: event.target.value })}><option value="">Todos os fornecedores</option>{catalogOptions.suppliers.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}</select>
      <button className="btn btn-secondary" onClick={() => setProductFilters({ category: "", brand: "", supplier: "" })}>Limpar filtros</button>
    </div>}
    {tab === "services" && <div className="panel mb-4 grid gap-3 p-3 md:grid-cols-4">
      <select className="field" value={serviceFilters.category} onChange={(event) => setServiceFilters({ ...serviceFilters, category: event.target.value })}><option value="">Todos os tipos</option>{serviceCategoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      <select className="field" value={serviceFilters.petSize} onChange={(event) => setServiceFilters({ ...serviceFilters, petSize: event.target.value })}><option value="">Todos os portes</option>{["Pequeno", "Médio", "Grande", "Gigante"].map((option) => <option key={option} value={option}>{option}</option>)}</select>
      <select className="field" value={serviceFilters.coat} onChange={(event) => setServiceFilters({ ...serviceFilters, coat: event.target.value })}><option value="">Todas as pelagens</option>{serviceCoatFilterOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      <button className="btn btn-secondary" onClick={() => { setQuery(""); setServiceFilters({ category: "", petSize: "", coat: "" }); }}>Limpar filtros</button>
    </div>}
    {tab === "products" && <DataCards items={visibleProducts.map((item) => ({ title: `${productCode(item)} — ${item.name}`, subtitle: `${item.category ?? "Produto"} | ${item.brand ?? "Sem marca"} | Estoque ${formatStock(item.stock, item.unit)} | Mín. ${formatStock(item.minStock ?? 0, item.unit)}`, meta: `${currency(item.salePrice)}${item.sku ? ` | SKU ${item.sku}` : ""}${item.supplier ? ` | ${item.supplier}` : ""}${item.allowNegativeStock ? " | vende sem estoque" : ""}`, status: item.active ? "Ativo" : "Inativo", action: <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => setModal({ type: "product", mode: "view", item })}><Eye size={16} />Visualizar</button><button className="btn btn-secondary" onClick={() => setAdminAction({ action: "edit", type: "product", item })}><Pencil size={16} />Editar</button>{item.active && <button className="btn btn-secondary" onClick={() => setAdminAction({ action: "inactive", type: "product", item })}><Trash2 size={16} />Inativar</button>}</div> }))} />}
    {tab === "services" && <DataCards items={visibleServices.map((item) => ({ title: `${serviceCode(item)} — ${item.name}`, subtitle: `${item.category ?? "Serviço"} | ${servicePetSizeLabel(item.petSize)} | ${serviceCoatLabel(item.coat)} | ${item.estimatedMinutes} min`, meta: currency(item.price), status: item.active ? "Ativo" : "Inativo", action: <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => setModal({ type: "service", mode: "view", item })}><Eye size={16} />Visualizar</button><button className="btn btn-secondary" onClick={() => setAdminAction({ action: "edit", type: "service", item })}><Pencil size={16} />Editar</button>{item.active && <button className="btn btn-secondary" onClick={() => setAdminAction({ action: "inactive", type: "service", item })}><Trash2 size={16} />Inativar</button>}</div> }))} />}
    {adminAction && <AdminAuthModal action={adminAction} onClose={() => setAdminAction(null)} onConfirmed={(adminPassword) => afterAdminAuth(adminAction, adminPassword)} />}
    {reusableOpen && <ReusableOptionsModal options={catalogOptions} onClose={() => setReusableOpen(false)} onEdit={setReusableEdit} />}
    {reusableEdit && <ReusableOptionEditModal target={reusableEdit} onClose={() => setReusableEdit(null)} onSaved={() => { setReusableEdit(null); refreshProducts(); refreshServices(); refreshProductOptions(); }} />}
    {modal && <CatalogModal type={modal.type} mode={modal.mode} item={modal.item} adminPassword={modal.adminPassword} productOptions={catalogOptions} onClose={() => setModal(null)} onSaved={() => { setModal(null); if (modal.type === "service") { refreshServices(); refreshProductOptions(); } else { refreshProducts(); refreshProductOptions(); } }} />}
  </Page>;
}

function ReusableOptionsModal({ options, onClose, onEdit }: { options: ProductOptions; onClose: () => void; onEdit: (target: ReusableEditTarget) => void }) {
  const groups: { title: string; kind: ReusableKind; items: ReusableOption[] }[] = [
    { title: "Categorias de produto", kind: "product-category", items: options.categories },
    { title: "Marcas de produto", kind: "product-brand", items: options.brands },
    { title: "Fornecedores", kind: "supplier", items: options.suppliers },
    { title: "Categorias de serviço", kind: "service-category", items: options.serviceCategories }
  ];

  return <Modal title="Cadastros reutilizáveis" onClose={onClose}>
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((group) => <section className="rounded-lg border border-slate-200 p-3" key={group.kind}>
        <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
        <div className="grid gap-2">
          {group.items.map((option) => <div className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm" key={option.id}>
            <span>{option.name}</span>
            <button className="btn btn-secondary px-2 py-1" onClick={() => onEdit({ kind: group.kind, label: group.title, option })} aria-label={`Editar ${option.name}`}><Pencil size={14} /></button>
          </div>)}
          {!group.items.length && <p className="text-sm text-slate-500">Nenhum cadastro criado ainda.</p>}
        </div>
      </section>)}
    </div>
  </Modal>;
}

function ReusableOptionEditModal({ target, onClose, onSaved }: { target: ReusableEditTarget; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(target.option.name);
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api(`/catalog/reusable-options/${target.kind}/${target.option.id}`, { method: "PATCH", body: JSON.stringify({ name, adminPassword }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível editar este cadastro.");
    } finally {
      setLoading(false);
    }
  }

  return <Modal title="Editar cadastro reutilizável" onClose={onClose}>
    <form className="mx-auto grid max-w-md gap-4" onSubmit={submit}>
      <p className="text-sm text-slate-600">Para editar <b>{target.option.name}</b> em {target.label.toLowerCase()}, informe a senha do administrador.</p>
      <label className="text-sm font-medium">Novo nome<input className="field mt-1" required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="text-sm font-medium">Senha do administrador<input className="field mt-1" type="password" required value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></label>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={loading || !name.trim() || !adminPassword}>{loading ? "Salvando..." : "Salvar"}</button></div>
    </form>
  </Modal>;
}

function AdminAuthModal({ action, onClose, onConfirmed }: { action: AdminCatalogAction; onClose: () => void; onConfirmed: (adminPassword: string) => Promise<void> | void }) {
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const entityLabel = action.type === "product" ? "produto" : "serviço";
  const title = action.action === "inactive" ? `Inativar ${action.type === "product" ? "Produto" : "Serviço"}` : "Autenticação do Administrador";
  const message = action.action === "inactive"
    ? `Você está prestes a inativar este ${entityLabel}. ${action.type === "product" ? "Produtos" : "Serviços"} inativos deixam de aparecer em novas vendas, porém permanecem preservados no histórico.`
    : `Para editar este ${entityLabel} é necessário informar a senha do administrador.`;
  const confirmLabel = action.action === "inactive" ? "Confirmar Inativação" : "Confirmar";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/catalog/admin-auth", { method: "POST", body: JSON.stringify({ adminPassword }) });
      await onConfirmed(adminPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senha do administrador incorreta.");
    } finally {
      setLoading(false);
    }
  }

  return <Modal title={title} onClose={onClose}>
    <form className="mx-auto grid max-w-md gap-4" onSubmit={submit}>
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-xl">🔒</div>
        <h3 className="font-semibold">Autenticação do Administrador</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
      </div>
      <label className="text-sm font-medium">Senha do administrador<input className="field mt-1" type="password" autoFocus value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></label>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={loading || !adminPassword}>{loading ? "Validando..." : confirmLabel}</button></div>
    </form>
  </Modal>;
}

function ReusableCombobox({ label, value, options, disabled, onChange }: { label: string; value: string; options: ReusableOption[]; disabled?: boolean; onChange: (value: string) => void }) {
  const datalistId = useId();
  return <label className="text-sm font-medium">{label}<input className="field mt-1" disabled={disabled} list={datalistId} value={value} onChange={(event) => onChange(event.target.value)} /><datalist id={datalistId}>{options.map((option) => <option key={option.id} value={option.name} />)}</datalist></label>;
}

function CatalogModal({ type, mode, item, adminPassword, productOptions, onClose, onSaved }: { type: "product" | "service"; mode: "create" | "view" | "edit"; item?: Product | Service; adminPassword?: string; productOptions: ProductOptions; onClose: () => void; onSaved: () => void }) {
  const readOnly = mode === "view";
  const product = type === "product" ? item as Product | undefined : undefined;
  const service = type === "service" ? item as Service | undefined : undefined;
  const [message, setMessage] = useState("");
  const [productForm, setProductForm] = useState({
    name: product?.name ?? "",
    category: product?.category ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    brand: product?.brand ?? "",
    supplier: product?.supplier ?? "",
    costPriceCents: centsFromCurrency(product?.costPrice ?? 0),
    salePriceCents: centsFromCurrency(product?.salePrice ?? 0),
    desiredMargin: product?.desiredMargin ? String(product.desiredMargin) : "",
    stock: stockInputValue(product?.stock),
    minStock: stockInputValue(product?.minStock),
    unit: product?.unit ?? "unidade",
    allowNegativeStock: product?.allowNegativeStock ?? false,
    active: product?.active ?? true,
    notes: product?.notes ?? ""
  });
  const [serviceForm, setServiceForm] = useState({
    name: service?.name ?? "",
    category: service?.category ?? "",
    petSize: service?.petSize ?? "Todos",
    coat: service?.coat && serviceCoatOptions.includes(service.coat) ? service.coat : service?.coat ? "Outro" : "",
    customCoat: service?.coat && !serviceCoatOptions.includes(service.coat) ? service.coat : "",
    priceCents: centsFromCurrency(service?.price ?? 0),
    costEstimateCents: centsFromCurrency(service?.costEstimate ?? 0),
    estimatedMinutes: String(service?.estimatedMinutes ?? 60),
    desiredMargin: service?.desiredMargin ? String(service.desiredMargin) : "",
    active: service?.active ?? true,
    notes: service?.notes ?? ""
  });
  const productCost = decimalFromCents(productForm.costPriceCents);
  const productFinalPrice = decimalFromCents(productForm.salePriceCents);
  const desiredMargin = Number(productForm.desiredMargin || 0);
  const suggestedPrice = productCost > 0 ? productCost * (1 + desiredMargin / 100) : 0;
  const suggestedPriceCents = String(Math.round(suggestedPrice * 100));
  const realMargin = productCost > 0 ? ((productFinalPrice - productCost) / productCost) * 100 : null;
  const finalBelowCost = productCost > 0 && productFinalPrice > 0 && productFinalPrice < productCost;
  const finalBelowSuggested = productCost > 0 && productFinalPrice > 0 && productFinalPrice < suggestedPrice && !finalBelowCost;
  const serviceCost = decimalFromCents(serviceForm.costEstimateCents);
  const serviceFinalPrice = decimalFromCents(serviceForm.priceCents);
  const serviceDesiredMargin = Number(serviceForm.desiredMargin || 0);
  const serviceSuggestedPrice = serviceCost > 0 ? serviceCost * (1 + serviceDesiredMargin / 100) : 0;
  const serviceSuggestedPriceCents = String(Math.round(serviceSuggestedPrice * 100));
  const serviceRealMargin = serviceCost > 0 ? ((serviceFinalPrice - serviceCost) / serviceCost) * 100 : null;
  const serviceBelowCost = serviceCost > 0 && serviceFinalPrice > 0 && serviceFinalPrice < serviceCost;
  const serviceBelowSuggested = serviceCost > 0 && serviceFinalPrice > 0 && serviceFinalPrice < serviceSuggestedPrice && !serviceBelowCost;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const endpoint = type === "service" ? "/catalog/services" : "/catalog/products";
    const id = item?.id;
    const serviceCoat = serviceForm.coat === "Outro" ? serviceForm.customCoat : serviceForm.coat;
    const payload = type === "service"
      ? { name: serviceForm.name, category: serviceForm.category, petSize: serviceForm.petSize, coat: serviceCoat, price: decimalFromCents(serviceForm.priceCents), costEstimate: decimalFromCents(serviceForm.costEstimateCents), estimatedMinutes: Number(serviceForm.estimatedMinutes || 1), desiredMargin: serviceForm.desiredMargin ? Number(serviceForm.desiredMargin) : undefined, active: serviceForm.active, notes: serviceForm.notes }
      : { name: productForm.name, category: productForm.category, sku: productForm.sku, barcode: productForm.barcode, brand: productForm.brand, supplier: productForm.supplier, costPrice: decimalFromCents(productForm.costPriceCents), salePrice: decimalFromCents(productForm.salePriceCents), desiredMargin: productForm.desiredMargin ? Number(productForm.desiredMargin) : undefined, stock: stockNumber(productForm.stock), minStock: stockNumber(productForm.minStock), unit: productForm.unit, allowNegativeStock: productForm.allowNegativeStock, active: productForm.active, notes: productForm.notes };
    await api(id ? `${endpoint}/${id}` : endpoint, { method: id ? "PATCH" : "POST", body: JSON.stringify(id ? { ...payload, adminPassword } : payload) });
    setMessage(id ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
    setTimeout(onSaved, 400);
  }
  const title = mode === "create" ? (type === "product" ? "Novo produto" : "Novo serviço") : mode === "edit" ? (type === "product" ? "Editar produto" : "Editar serviço") : (type === "product" ? "Produto" : "Serviço");
  return <Modal title={title} onClose={onClose}><form className="grid gap-4" onSubmit={submit}>
    {type === "product" && <>
      <Section title="Dados do produto">
        <label className="text-sm font-medium">Código interno<input className="field mt-1 bg-slate-50 font-semibold text-blue-700" readOnly value={readonlyCatalogCode("PRO", product)} /></label>
        <label className="text-sm font-medium">Nome do produto<input className="field mt-1" required disabled={readOnly} value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} /></label>
        <ReusableCombobox label="Categoria" disabled={readOnly} value={productForm.category} options={productOptions.categories} onChange={(value) => setProductForm({ ...productForm, category: value })} />
        <label className="text-sm font-medium">SKU interno<input className="field mt-1" disabled={readOnly} value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} /></label>
        <label className="text-sm font-medium">Código de barras<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: onlyDigits(e.target.value) })} /></label>
        <ReusableCombobox label="Marca" disabled={readOnly} value={productForm.brand} options={productOptions.brands} onChange={(value) => setProductForm({ ...productForm, brand: value })} />
        <ReusableCombobox label="Fornecedor" disabled={readOnly} value={productForm.supplier} options={productOptions.suppliers} onChange={(value) => setProductForm({ ...productForm, supplier: value })} />
      </Section>
      <Section title="Precificação">
        <label className="text-sm font-medium">Preço de custo<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={formatCurrencyInput(productForm.costPriceCents)} onChange={(e) => setProductForm({ ...productForm, costPriceCents: onlyDigits(e.target.value) })} /></label>
        <label className="text-sm font-medium">Margem desejada (%)<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={productForm.desiredMargin} onChange={(e) => setProductForm({ ...productForm, desiredMargin: onlyDigits(e.target.value, 3) })} /></label>
        <label className="text-sm font-medium">Preço de venda sugerido<input className="field mt-1 bg-slate-50 text-slate-600" readOnly value={formatCurrencyInput(suggestedPriceCents)} /></label>
        <label className="text-sm font-medium">Preço de venda final<input className="field mt-1" required disabled={readOnly} inputMode="numeric" value={formatCurrencyInput(productForm.salePriceCents)} onChange={(e) => setProductForm({ ...productForm, salePriceCents: onlyDigits(e.target.value) })} /></label>
        <div className="md:col-span-2">
          {realMargin !== null && <p className="text-sm font-medium text-slate-700">Margem real: {realMargin.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</p>}
          {finalBelowSuggested && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Preço final está abaixo da margem desejada.</p>}
          {finalBelowCost && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Preço de venda menor que o custo. Você terá prejuízo.</p>}
        </div>
      </Section>
      <Section title="Estoque e status">
        <label className="text-sm font-medium">Estoque atual<div className="relative mt-1"><input className="field pr-16" disabled={readOnly} inputMode={stockAllowsDecimal(productForm.unit) ? "decimal" : "numeric"} placeholder={stockPlaceholder(productForm.unit)} value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: sanitizeStockInput(e.target.value, productForm.unit) })} />{productForm.unit !== "outro" && <span className="pointer-events-none absolute right-3 top-2 text-xs text-slate-400">{unitLabel(productForm.unit)}</span>}</div></label>
        <label className="text-sm font-medium">Estoque mínimo<div className="relative mt-1"><input className="field pr-16" disabled={readOnly} inputMode={stockAllowsDecimal(productForm.unit) ? "decimal" : "numeric"} placeholder={stockPlaceholder(productForm.unit)} value={productForm.minStock} onChange={(e) => setProductForm({ ...productForm, minStock: sanitizeStockInput(e.target.value, productForm.unit) })} />{productForm.unit !== "outro" && <span className="pointer-events-none absolute right-3 top-2 text-xs text-slate-400">{unitLabel(productForm.unit)}</span>}</div></label>
        <label className="text-sm font-medium">Unidade<select className="field mt-1" disabled={readOnly} value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value, stock: normalizeStockForUnit(productForm.stock, e.target.value), minStock: normalizeStockForUnit(productForm.minStock, e.target.value) })}>{["unidade", "pacote", "kg", "g", "litro", "ml", "outro"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
        <label className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm font-medium md:col-span-2"><input disabled={readOnly} type="checkbox" checked={productForm.allowNegativeStock} onChange={(e) => setProductForm({ ...productForm, allowNegativeStock: e.target.checked })} /><span><b>Permitir venda sem estoque</b><br /><span className="font-normal text-slate-500">Permite finalizar vendas mesmo com estoque 0 ou negativo.</span></span></label>
        <label className="flex items-center gap-2 text-sm font-medium"><input disabled={readOnly} type="checkbox" checked={productForm.active} onChange={(e) => setProductForm({ ...productForm, active: e.target.checked })} />Ativo</label>
        <label className="text-sm font-medium md:col-span-2">Observações<textarea className="field mt-1" disabled={readOnly} value={productForm.notes} onChange={(e) => setProductForm({ ...productForm, notes: e.target.value })} /></label>
      </Section>
    </>}
    {type === "service" && <>
      <Section title="Dados do serviço">
        <label className="text-sm font-medium">Código interno<input className="field mt-1 bg-slate-50 font-semibold text-blue-700" readOnly value={readonlyCatalogCode("SER", service)} /></label>
        <label className="text-sm font-medium">Nome do serviço<input className="field mt-1" required disabled={readOnly} value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} /></label>
        <ReusableCombobox label="Categoria" disabled={readOnly} value={serviceForm.category} options={productOptions.serviceCategories} onChange={(value) => setServiceForm({ ...serviceForm, category: value })} />
        <label className="text-sm font-medium">Porte do pet<select className="field mt-1" disabled={readOnly} value={serviceForm.petSize} onChange={(e) => setServiceForm({ ...serviceForm, petSize: e.target.value })}>{["Pequeno", "Médio", "Grande", "Gigante", "Todos"].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <label className="text-sm font-medium">Pelagem<select className="field mt-1" disabled={readOnly} value={serviceForm.coat} onChange={(e) => setServiceForm({ ...serviceForm, coat: e.target.value, customCoat: e.target.value === "Outro" ? serviceForm.customCoat : "" })}><option value="">Não informado</option>{serviceCoatOptions.map((coat) => <option key={coat} value={coat}>{coat}</option>)}</select></label>
        {serviceForm.coat === "Outro" && <label className="text-sm font-medium">Pelagem personalizada<input className="field mt-1" disabled={readOnly} value={serviceForm.customCoat} onChange={(e) => setServiceForm({ ...serviceForm, customCoat: e.target.value })} /></label>}
        <label className="text-sm font-medium">Tempo estimado em minutos<input className="field mt-1" required disabled={readOnly} inputMode="numeric" value={serviceForm.estimatedMinutes} onChange={(e) => setServiceForm({ ...serviceForm, estimatedMinutes: onlyDigits(e.target.value) || "1" })} /></label>
        <label className="flex items-center gap-2 text-sm font-medium"><input disabled={readOnly} type="checkbox" checked={serviceForm.active} onChange={(e) => setServiceForm({ ...serviceForm, active: e.target.checked })} />Ativo</label>
        <label className="text-sm font-medium md:col-span-2">Observações<textarea className="field mt-1" disabled={readOnly} value={serviceForm.notes} onChange={(e) => setServiceForm({ ...serviceForm, notes: e.target.value })} /></label>
      </Section>
      <Section title="Precificação do serviço">
        <label className="text-sm font-medium">Custo estimado<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={formatCurrencyInput(serviceForm.costEstimateCents)} onChange={(e) => setServiceForm({ ...serviceForm, costEstimateCents: onlyDigits(e.target.value) })} /></label>
        <label className="text-sm font-medium">Margem desejada (%)<input className="field mt-1" disabled={readOnly} inputMode="numeric" value={serviceForm.desiredMargin} onChange={(e) => setServiceForm({ ...serviceForm, desiredMargin: onlyDigits(e.target.value, 3) })} /></label>
        <label className="text-sm font-medium">Preço de venda sugerido<input className="field mt-1 bg-slate-50 text-slate-600" readOnly value={formatCurrencyInput(serviceSuggestedPriceCents)} /></label>
        <label className="text-sm font-medium">Preço de venda final<input className="field mt-1" required disabled={readOnly} inputMode="numeric" value={formatCurrencyInput(serviceForm.priceCents)} onChange={(e) => setServiceForm({ ...serviceForm, priceCents: onlyDigits(e.target.value) })} /></label>
        <div className="md:col-span-2">
          {serviceRealMargin !== null && <p className="text-sm font-medium text-slate-700">Margem real: {serviceRealMargin.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</p>}
          {serviceBelowSuggested && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Preço final está abaixo da margem desejada.</p>}
          {serviceBelowCost && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Preço de venda menor que o custo. Você terá prejuízo.</p>}
        </div>
      </Section>
    </>}
    {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
    <div className="flex justify-end gap-2"><button className="btn btn-secondary" type="button" onClick={onClose}>Fechar</button>{!readOnly && <button className="btn btn-primary">Salvar</button>}</div>
  </form></Modal>;
}

type CashSectionKey = "pos" | "session" | "sales" | "preSales" | "pending" | "movements" | "reports";

function checkoutSectionFromPage(page: string): CashSectionKey {
  if (page === "checkout:pending") return "pending";
  if (page === "checkout:reports") return "reports";
  if (page === "checkout:transfer" || page === "checkout:consumption") return "movements";
  if (page === "checkout:close") return "session";
  return "pos";
}

function isFinalizedAppointmentSale(sale?: Sale | null) {
  return Boolean(sale?.appointmentId && sale.origin === "AGENDA" && (!sale.appointment || sale.appointment.status === "FINISHED"));
}

function Checkout({ draft, chargeSaleId, onClearDraft, session, sectionPage }: { draft: Appointment | null; chargeSaleId: string | null; onClearDraft: () => void; session: Session; sectionPage: string }) {
  const [section, setSection] = useState<CashSectionKey>(() => checkoutSectionFromPage(sectionPage));
  const [query, setQuery] = useState("");
  const [saleModal, setSaleModal] = useState<{ sale?: Sale } | null>(null);
  const [loadedSale, setLoadedSale] = useState<Sale | null>(null);
  const [saleLoadError, setSaleLoadError] = useState("");
  const search = query.trim();
  const { data: cashCurrent, error: cashCurrentError, loading: cashCurrentLoading, refresh: refreshCash } = useData<CashCurrent>("/cash/current");
  const cashSession = cashCurrent?.session ?? null;
  const cashStateReady = cashCurrent !== null;
  const { data: waitingSales, refresh: refreshWaiting } = useData<Sale[]>(section === "pos" ? `/sales?status=WAITING_PAYMENT${search ? `&q=${encodeURIComponent(search)}` : ""}` : "", [section, search]);
  const { data: pendingSales, refresh: refreshPending } = useData<Sale[]>(section === "pos" ? `/sales?status=PENDING${search ? `&q=${encodeURIComponent(search)}` : ""}` : "", [section, search]);
  const { data: partialSales, refresh: refreshPartial } = useData<Sale[]>(section === "pos" ? `/sales?status=PARTIALLY_PAID${search ? `&q=${encodeURIComponent(search)}` : ""}` : "", [section, search]);

  useEffect(() => {
    if (draft) {
      setSection("pos");
      const orderId = draft.sales?.[0]?.id;
      if (orderId) {
        void loadSale(orderId);
      }
      onClearDraft();
    }
  }, [draft?.id]);

  useEffect(() => {
    const urlOrderId = new URLSearchParams(window.location.search).get("pedido");
    const orderId = chargeSaleId || urlOrderId;
    if (orderId) {
      setSection("pos");
      void loadSale(orderId);
    }
  }, [chargeSaleId]);

  useEffect(() => {
    setSection(checkoutSectionFromPage(sectionPage));
  }, [sectionPage]);

  function refreshPos() {
    refreshCash();
    refreshWaiting();
    refreshPending();
    refreshPartial();
  }

  function clearLoadedSale() {
    setLoadedSale(null);
    window.history.replaceState(null, "", window.location.pathname);
    refreshPos();
  }

  function openSaleInPos(sale: Sale) {
    setLoadedSale(sale);
    setSection("pos");
    window.history.replaceState(null, "", `${window.location.pathname}?pedido=${sale.id}`);
  }

  async function loadSale(saleId: string) {
    setSaleLoadError("");
    try {
      const sale = await api<Sale>(`/sales/${saleId}/receivable`);
      setLoadedSale(sale);
      window.history.replaceState(null, "", `${window.location.pathname}?pedido=${sale.id}`);
    } catch (error) {
      setSaleLoadError(error instanceof Error ? error.message : "Falha ao carregar pedido no caixa.");
    }
  }

  return <Page title="Caixa">
    <div className="hidden">
      {[
        ["pos", "Ponto de Venda"],
        ["session", "Abertura e Fechamento"],
        ["sales", "Vendas"],
        ["preSales", "Pré-vendas"],
        ["pending", "Pendências"],
        ["movements", "Movimentações"],
        ["reports", "Relatório do Caixa"]
      ].map(([key, label]) => <button key={key} className={`btn whitespace-nowrap ${section === key ? "btn-primary" : "btn-secondary"}`} onClick={() => setSection(key as CashSectionKey)}>{label}</button>)}
    </div>
    {section !== "pos" && <button className="btn btn-secondary mb-4" type="button" onClick={() => setSection("pos")}>Voltar ao Caixa</button>}

    {saleLoadError && section === "pos" && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{saleLoadError}</p>}
    {["pos", "session", "movements"].includes(section) && !cashStateReady && <div className="panel p-5">
      {(cashCurrentLoading || !cashCurrentError) && <p className="text-sm text-slate-600">Verificando o caixa aberto...</p>}
      {!cashCurrentLoading && cashCurrentError && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-red-700">{cashCurrentError}</p><button className="btn btn-secondary" type="button" onClick={refreshCash}>Tentar novamente</button></div>}
    </div>}
    {section === "pos" && cashStateReady && <CashPointOfSaleLayout cashSession={cashSession} query={query} setQuery={setQuery} loadedSale={loadedSale} waitingSales={waitingSales ?? []} pendingSales={[...(partialSales ?? []), ...(pendingSales ?? [])]} onOpened={refreshCash} onShortcut={setSection} onOpenSale={openSaleInPos} onSaved={clearLoadedSale} session={session} />}
    {section === "session" && cashStateReady && <CashSessionPanel cashSession={cashSession} onRefresh={refreshCash} />}
    {section === "sales" && <CashSalesHistory />}
    {section === "preSales" && <CashPreSales onReceive={(sale) => setSaleModal({ sale })} />}
    {section === "pending" && <CashPendingSales onOpenInPos={openSaleInPos} />}
    {section === "movements" && cashStateReady && <CashMovements cashSession={cashSession} onRefresh={refreshCash} />}
    {section === "reports" && <CashReports isAdmin={session.user.role === "ADMIN"} />}

    {saleModal && <SaleReceiveModal sale={saleModal.sale} session={session} cashSession={cashSession} onClose={() => setSaleModal(null)} onSaved={() => { setSaleModal(null); refreshPos(); }} />}
  </Page>;
}

function CashPointOfSale({ cashSession, query, setQuery, waitingSales, pendingSales, onOpened, onShortcut, onReceive, session }: { cashSession: CashSession | null; query: string; setQuery: (value: string) => void; waitingSales: Sale[]; pendingSales: Sale[]; onOpened: () => void; onShortcut: (section: CashSectionKey) => void; onReceive: (sale: Sale) => void; session: Session }) {
  const [cashRegister, setCashRegister] = useState("Caixa 01");
  const [openingCents, setOpeningCents] = useState("0");
  const [openError, setOpenError] = useState("");
  const [itemOpen, setItemOpen] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [cart, setCart] = useState<SaleItemForm[]>([]);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [, setSelectedPetId] = useState("");
  const { data: services } = useData<Service[]>("/catalog/services");
  const { data: products } = useData<Product[]>("/catalog/products");
  const { data: summary } = useData<CashSummary>(cashSession ? `/cash/${cashSession.id}/summary` : "", [cashSession?.id]);

  async function openCash() {
    setOpenError("");
    try {
      await api("/cash/open", { method: "POST", body: JSON.stringify({ openingAmount: decimalFromCents(openingCents), notes: cashRegister }) });
      onOpened();
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Falha ao abrir caixa.");
    }
  }

  const catalogItems = [
    ...(services ?? []).filter((service) => service.active).map((service) => ({ type: "SERVICE" as const, id: service.id, code: serviceCode(service), name: service.name, meta: service.category ?? "Serviço", price: Number(service.price) })),
    ...(products ?? []).filter((product) => product.active).map((product) => ({ type: "PRODUCT" as const, id: product.id, code: productCode(product), name: product.name, meta: [product.category, product.sku ? `SKU ${product.sku}` : "", `Estoque ${product.stock}`].filter(Boolean).join(" · "), price: Number(product.salePrice) }))
  ].filter((item) => {
    const query = itemQuery.trim();
    return /^\d+$/.test(query)
      ? Number(item.code) === Number(query)
      : normalizeOption(`${item.code} ${item.name} ${item.meta}`).includes(normalizeOption(query));
  });

  function addCatalogItem(item: typeof catalogItems[number]) {
    setCart([...cart, { itemType: item.type, serviceId: item.type === "SERVICE" ? item.id : undefined, productId: item.type === "PRODUCT" ? item.id : undefined, description: item.name, quantity: 1, unitPrice: item.price, code: item.code }]);
    setItemOpen(false);
    setItemQuery("");
  }
  const onNewPreSale = () => onShortcut("preSales");
  const onNewSale = () => setItemOpen(true);

  if (!cashSession) return <div className="panel grid gap-4 p-5 md:grid-cols-[1fr_320px] md:items-start">
    <div><h2 className="text-xl font-semibold">Selecionar Caixa</h2><p className="text-sm text-slate-500">Nenhum caixa está aberto para operar o PDV. Escolha o caixa e informe o valor inicial.</p></div>
    <div className="grid gap-3">
      <label className="text-sm font-medium">Caixa<select className="field mt-1" value={cashRegister} onChange={(event) => setCashRegister(event.target.value)}><option>Caixa 01</option><option>Caixa 02</option></select></label>
      <label className="text-sm font-medium">Valor inicial<input className="field mt-1" inputMode="numeric" value={formatCurrencyInput(openingCents)} onChange={(event) => setOpeningCents(onlyDigits(event.target.value))} /></label>
      {openError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{openError}</p>}
      <button className="btn btn-primary" type="button" onClick={openCash}>Abrir e iniciar PDV</button>
    </div>
  </div>;
  const cartSubtotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const saleCard = (sale: Sale) => {
    const mainItems = sale.items.slice(0, 2).map((item) => item.description).join(", ");
    return {
      title: saleCode(sale),
      subtitle: `${sale.customer?.name ?? "Consumidor final"}${sale.pet?.name ? ` | ${sale.pet.name}` : ""}`,
      meta: `${mainItems || "Venda"} | Total: ${currency(sale.total)} | Origem: ${saleOriginLabels[sale.origin]} | ${dateTimeBR(sale.createdAt)}`,
      status: saleStatusLabels[sale.status],
      action: <button className="btn btn-primary" onClick={() => onReceive(sale)}>Receber</button>
    };
  };
  return <div className="grid gap-4">
    <div className="panel grid gap-2 p-4 md:grid-cols-4">
      <p><b>Status:</b> <span className="text-emerald-700">Aberto</span></p>
      <p><b>Operador:</b> {session.user.name}</p>
      <p><b>Sessão:</b> {cashSessionCode(cashSession)}</p>
      <p><b>Aberto desde:</b> {dateTimeBR(cashSession.openedAt)}</p>
    </div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="panel flex flex-1 items-center gap-2 p-3"><Search size={18} className="text-slate-400" /><input className="w-full bg-transparent text-sm outline-none" placeholder="Buscar cliente, pet, CPF, telefone ou código" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="flex flex-col gap-2 sm:flex-row"><button className="btn btn-secondary" onClick={onNewPreSale}><Plus size={16} />Pré-venda</button><button className="btn btn-primary" onClick={onNewSale}><Plus size={16} />Nova venda</button></div>
    </div>
    <section className="panel overflow-hidden">
      <div className="hidden grid-cols-[110px_1fr_110px_130px_130px_44px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 md:grid"><span>Código</span><span>Descrição</span><span>Quantidade</span><span>Valor unitário</span><span>Valor total</span><span /></div>
      <div className="grid gap-2 p-4">
        {cart.map((item, index) => <div className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[110px_1fr_110px_130px_130px_44px] md:items-center" key={`${item.description}-${index}`}>
          <span className="text-sm font-medium">{item.code}</span>
          <div><b>{item.description}</b><p className="text-xs text-slate-500">{item.itemType === "SERVICE" ? "Serviço" : "Produto"}</p></div>
          <input className="field" inputMode="numeric" value={item.quantity} onChange={(event) => setCart(cart.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: Math.max(1, Number(onlyDigits(event.target.value) || 1)) } : current))} />
          <span className="font-medium">{currency(item.unitPrice)}</span>
          <b>{currency(item.quantity * item.unitPrice)}</b>
          <button className="btn btn-secondary" type="button" onClick={() => setCart(cart.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button>
        </div>)}
        {!cart.length && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nenhum item no pedido. Clique em Nova venda para buscar produtos e serviços.</p>}
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-slate-500">Total do pedido</p><b className="text-2xl">{currency(cartSubtotal)}</b></div><div className="flex flex-wrap gap-2"><button className="btn btn-secondary" type="button" onClick={() => setCart([])}>Limpar</button><button className="btn btn-primary" type="button" onClick={() => onReceive({ id: "", origin: "DIRECT", status: "WAITING_PAYMENT", subtotal: cartSubtotal, discount: 0, total: cartSubtotal, createdAt: new Date().toISOString(), items: cart } as Sale)}>Finalizar no modal completo</button></div></div>
    </section>
    <div className="grid gap-3 lg:grid-cols-5"><button className="btn btn-secondary justify-start" type="button" onClick={() => onShortcut("pending")}>Pedidos Pendentes</button><button className="btn btn-secondary justify-start" type="button" onClick={() => onShortcut("reports")}>Relatórios</button><button className="btn btn-secondary justify-start" type="button" onClick={() => onShortcut("movements")}>Transferência</button><button className="btn btn-secondary justify-start" type="button" onClick={() => onShortcut("movements")}>Consumo</button><button className="btn btn-primary justify-start" type="button" onClick={() => onShortcut("session")}>Fechar Caixa</button></div>
    <div className="panel grid gap-2 p-4 text-sm md:grid-cols-3"><p><b>Total recebido:</b> {currency(summary?.totalReceived ?? 0)}</p><p><b>Pendentes:</b> {currency(summary?.pendingTotal ?? 0)}</p><p><b>Dinheiro esperado:</b> {currency(summary?.expectedCash ?? cashSession.openingAmount)}</p></div>
    <section className="grid gap-3"><h2 className="font-semibold">Aguardando pagamento</h2><DataCards items={waitingSales.map(saleCard)} />{!waitingSales.length && <p className="text-sm text-slate-500">Nenhum atendimento aguardando pagamento.</p>}</section>
    <section className="grid gap-3"><h2 className="font-semibold">Pendentes</h2><DataCards items={pendingSales.map(saleCard)} />{!pendingSales.length && <p className="text-sm text-slate-500">Nenhuma venda pendente.</p>}</section>
    {clientModalOpen && <Modal title="Selecionar cliente" onClose={() => setClientModalOpen(false)}><div className="grid gap-3"><div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search size={18} className="text-slate-500" /><input className="w-full bg-transparent text-sm outline-none" autoFocus placeholder="Buscar por código, nome, CPF, celular ou pet" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} /></div><div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">{clientResults.map((customer) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={customer.id} type="button" onClick={() => { setSelectedCustomer(customer); const pet = customer.pets.find((item) => item.id === customer.matchedPetId) ?? customer.pets.find((item) => item.status === "ACTIVE") ?? null; setSelectedPetId(pet?.id ?? ""); setQuery(`${customerCode(customer)} ${customer.name}`); setClientModalOpen(false); }}><b>{customerCode(customer)} - {customer.name}</b>{customer.matchedPetName && <p className="text-blue-700">Pet encontrado: {customer.matchedPetName}</p>}<p className="text-slate-600">CPF: {formatCpf(customer.cpf)} · Celular: {formatPhone(customer.phone)}</p><p className="text-slate-600">Pets: {customer.pets.map((pet) => pet.name).join(", ") || "-"}</p></button>)}{clientQuery.trim().length < 2 && <p className="p-4 text-sm text-slate-500">Digite ao menos 2 caracteres para buscar.</p>}{clientQuery.trim().length >= 2 && !clientResults.length && <p className="p-4 text-sm text-slate-500">Nenhum cliente encontrado.</p>}</div>{selectedCustomer && <button className="btn btn-secondary justify-self-start" type="button" onClick={() => { setSelectedCustomer(null); setSelectedPetId(""); setQuery(""); setClientModalOpen(false); }}>Limpar cliente</button>}</div></Modal>}
    {itemOpen && <Modal title="Buscar produto ou serviço" onClose={() => setItemOpen(false)}><div className="grid gap-3"><input className="field" autoFocus placeholder="Código, nome, SKU ou categoria" value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} /><div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">{catalogItems.map((item) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={`${item.type}-${item.id}`} type="button" onClick={() => addCatalogItem(item)}><b>{item.code} — {item.name}</b><p className="text-slate-600">{item.type === "SERVICE" ? "Serviço" : "Produto"} · {item.meta}</p><p className="font-semibold text-blue-700">{currency(item.price)}</p></button>)}{!catalogItems.length && <p className="p-4 text-sm text-slate-500">Nenhum produto ou serviço encontrado.</p>}</div></div></Modal>}
  </div>;
}

function CashPointOfSaleLayout({ cashSession, query, setQuery, loadedSale, waitingSales, pendingSales, onOpened, onShortcut, onOpenSale, onSaved, session }: { cashSession: CashSession | null; query: string; setQuery: (value: string) => void; loadedSale: Sale | null; waitingSales: Sale[]; pendingSales: Sale[]; onOpened: () => void; onShortcut: (section: CashSectionKey) => void; onOpenSale: (sale: Sale) => void; onSaved: () => void; session: Session }) {
  const [cashRegister, setCashRegister] = useState("CX - 101");
  const [openingCents, setOpeningCents] = useState("0");
  const [openError, setOpenError] = useState("");
  const [itemOpen, setItemOpen] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [cart, setCart] = useState<SaleItemForm[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedPetId, setSelectedPetId] = useState("");
  const [petModalOpen, setPetModalOpen] = useState(false);
  const [petQuery, setPetQuery] = useState("");
  const [manualOrderNumber, setManualOrderNumber] = useState("");
  const [orderSearching, setOrderSearching] = useState(false);
  const [orderValidation, setOrderValidation] = useState("");
  const [orderNotice, setOrderNotice] = useState<OrderNotice | null>(null);
  const [orderSearchOpen, setOrderSearchOpen] = useState(false);
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const [orderSearchPage, setOrderSearchPage] = useState(1);
  const [orderSearchResult, setOrderSearchResult] = useState<ReceivableSalesPage | null>(null);
  const [orderListLoading, setOrderListLoading] = useState(false);
  const [expandedOrderDetails, setExpandedOrderDetails] = useState<Set<string>>(() => new Set());
  const orderInputRef = useRef<HTMLInputElement>(null);
  const orderRequestRef = useRef(false);
  const [finishedAppointmentCancelOpen, setFinishedAppointmentCancelOpen] = useState(false);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [payLaterModalOpen, setPayLaterModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<"VALUE" | "PERCENT">("VALUE");
  const [discountCents, setDiscountCents] = useState("0");
  const [discountPercent, setDiscountPercent] = useState("");
  const [completedReceipt, setCompletedReceipt] = useState<{ sale: Sale; receipt: SalesReceipt } | null>(null);
  const { data: services } = useData<Service[]>("/catalog/services");
  const { data: products } = useData<Product[]>("/catalog/products");
  const cartTotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const activePets = selectedCustomer?.pets?.filter((pet) => pet.status === "ACTIVE") ?? [];
  const selectedPet = activePets.find((pet) => pet.id === selectedPetId) ?? (activePets.length === 1 ? activePets[0] : null);
  const filteredPets = activePets.filter((pet) => normalizeOption(pet.name).includes(normalizeOption(petQuery)));
  const appointmentSaleLocked = isFinalizedAppointmentSale(loadedSale);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!loadedSale) return;
    setSelectedCustomer(loadedSale.customer ?? null);
    setSelectedPetId(loadedSale.pet?.id ?? "");
    setManualOrderNumber(loadedSale.internalCode ? String(loadedSale.internalCode).padStart(6, "0") : "");
    setDiscountType(loadedSale.discountType ?? "VALUE");
    setDiscountCents(centsFromCurrency(loadedSale.discount ?? 0));
    setDiscountPercent(loadedSale.discountType === "PERCENT" && loadedSale.discountPercent != null ? String(loadedSale.discountPercent) : "");
    setCart(loadedSale.items.map((item) => ({
      itemType: item.itemType,
      serviceId: item.serviceId,
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      code: item.service ? serviceCode(item.service) : item.product ? productCode(item.product) : "",
      coveredByMembership: item.coveredByMembership
    })));
  }, [loadedSale?.id]);

  useEffect(() => {
    if (!orderSearchOpen) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setOrderListLoading(true);
      try {
        const result = await api<ReceivableSalesPage>(`/sales/receivable/search?period=all&q=${encodeURIComponent(orderSearchQuery.trim())}&page=${orderSearchPage}&limit=15`);
        if (active) setOrderSearchResult(result);
      } catch {
        if (active) setOrderSearchResult({ items: [], page: 1, pageSize: 15, total: 0, totalPages: 1 });
      } finally {
        if (active) setOrderListLoading(false);
      }
    }, orderSearchQuery.trim() ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [orderSearchOpen, orderSearchQuery, orderSearchPage]);

  useEffect(() => {
    if (!appointmentSaleLocked) return;
    setClientModalOpen(false);
    setPetModalOpen(false);
  }, [appointmentSaleLocked]);

  useEffect(() => {
    const term = clientQuery.trim();
    if (!clientModalOpen || term.length < 2) {
      setClientResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api<Customer[]>(`/customers/search?q=${encodeURIComponent(term)}`)
        .then((results) => { if (active) setClientResults(results); })
        .catch(() => { if (active) setClientResults([]); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [clientModalOpen, clientQuery]);

  async function openCash() {
    setOpenError("");
    try {
      await api("/cash/open", { method: "POST", body: JSON.stringify({ openingAmount: decimalFromCents(openingCents), notes: cashRegister }) });
      onOpened();
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Falha ao abrir caixa.");
    }
  }

  const catalogItems = [
    ...(services ?? []).filter((service) => service.active).map((service) => ({ type: "SERVICE" as const, id: service.id, code: serviceCode(service), name: service.name, meta: service.category ?? "Serviço", price: Number(service.price) })),
    ...(products ?? []).filter((product) => product.active).map((product) => ({ type: "PRODUCT" as const, id: product.id, code: productCode(product), name: product.name, meta: [product.category, product.sku ? `SKU ${product.sku}` : "", `Estoque ${product.stock}`].filter(Boolean).join(" · "), price: Number(product.salePrice) }))
  ].filter((item) => {
    const query = itemQuery.trim();
    return /^\d+$/.test(query)
      ? Number(item.code) === Number(query)
      : normalizeOption(`${item.code} ${item.name} ${item.meta}`).includes(normalizeOption(query));
  });

  function addCatalogItem(item: typeof catalogItems[number]) {
    setCart([...cart, { itemType: item.type, serviceId: item.type === "SERVICE" ? item.id : undefined, productId: item.type === "PRODUCT" ? item.id : undefined, description: item.name, quantity: 1, unitPrice: item.price, code: item.code }]);
    setItemOpen(false);
    setItemQuery("");
  }

  const discountPercentNumber = Math.min(Math.max(Number(String(discountPercent || 0).replace(",", ".")), 0), 100);
  const discountRawValue = discountType === "PERCENT" ? cartTotal * discountPercentNumber / 100 : decimalFromCents(discountCents);
  const discountValue = Math.min(cartTotal, Math.max(0, discountRawValue));
  const orderTotal = Math.max(0, cartTotal - discountValue);
  const currentCustomer = appointmentSaleLocked ? loadedSale?.customer ?? selectedCustomer : selectedCustomer;
  const currentPet = appointmentSaleLocked ? loadedSale?.pet ?? selectedPet : selectedPet;
  const paidBefore = Number(loadedSale?.paidAmount ?? 0);
  const currentPendingAmount = Number(Math.max(0, orderTotal - paidBefore).toFixed(2));

  function resetCurrentOrder() {
    setCart([]);
    setManualOrderNumber("");
    setSelectedCustomer(null);
    setSelectedPetId("");
    setDiscountType("VALUE");
    setDiscountCents("0");
    setDiscountPercent("");
    setDiscountModalOpen(false);
    setPaymentModalOpen(false);
    setPayLaterModalOpen(false);
    setQuery("");
  }

  function currentItemsPayload() {
    return cart.map(normalizeSaleItemPayload);
  }

  function discountInputValue() {
    return discountType === "PERCENT" ? discountPercentNumber : decimalFromCents(discountCents);
  }

  function existingPaymentPayload() {
    return (loadedSale?.payments ?? []).map((payment) => ({
      method: payment.method,
      amount: Number(payment.amount),
      cardBrand: payment.cardBrand ?? undefined,
      cardNsu: payment.cardNsu ?? undefined,
      cardAuthorization: payment.cardAuthorization ?? undefined,
      installments: payment.installments ?? undefined,
      pixReference: payment.pixReference ?? undefined,
      cashReceived: payment.cashReceived == null ? undefined : Number(payment.cashReceived),
      changeAmount: payment.changeAmount == null ? undefined : Number(payment.changeAmount)
    }));
  }

  async function saveCurrentOrder(payload: Record<string, unknown>) {
    const body = {
      customerId: currentCustomer?.id,
      petId: currentPet?.id,
      discountType,
      discount: discountInputValue(),
      items: currentItemsPayload(),
      ...payload
    };
    const path = loadedSale?.id ? `/sales/${loadedSale.id}/checkout` : "/sales";
    const method = loadedSale?.id ? "PATCH" : "POST";
    const saved = await api<Sale>(path, { method, body: JSON.stringify(body) });
    resetCurrentOrder();
    onSaved();
    if (saved.status === "PAID" && saved.receipt) setCompletedReceipt({ sale: saved, receipt: saved.receipt });
  }

  function openCustomerFromDeferredFlow() {
    setPayLaterModalOpen(false);
    setPaymentModalOpen(false);
    setClientModalOpen(true);
  }

  function cancelCurrentOrder() {
    if (loadedSale?.appointment?.status === "FINISHED") {
      setFinishedAppointmentCancelOpen(true);
      return;
    }
    setCart([]);
    setManualOrderNumber("");
    setDiscountType("VALUE");
    setDiscountCents("0");
    setDiscountPercent("");
  }

  function openClientSearch() {
    if (!appointmentSaleLocked) setClientModalOpen(true);
  }

  function openPetSearch() {
    if (!appointmentSaleLocked && selectedCustomer) setPetModalOpen(true);
  }

  function orderCodeFromDigits(value: string) {
    return `PD-${String(Number(onlyDigits(value)) || 0).padStart(6, "0")}`;
  }

  function noticeForOrderError(error: unknown, fallbackCode: string, concurrent = false): OrderNotice {
    const apiError = error instanceof ApiError ? error : null;
    const details = (apiError?.details ?? {}) as { orderCode?: string; paidAt?: string; paidAmount?: number; receiptCode?: number; status?: string };
    const code = details.orderCode ?? fallbackCode;
    if (apiError?.code === "ORDER_ALREADY_PAID") {
      const optional = [
        details.paidAt ? `Pagamento: ${dateTimeBR(details.paidAt)}` : "",
        details.receiptCode ? `Comprovante: ${String(details.receiptCode).padStart(6, "0")}` : "",
        details.paidAmount != null ? `Valor pago: ${currency(details.paidAmount)}` : ""
      ].filter(Boolean);
      return {
        title: "Pedido já pago",
        message: concurrent ? "Este pedido já foi pago por outro operador." : `O pedido ${code} já foi recebido e não pode ser aberto novamente no Ponto de Venda.`,
        details: optional
      };
    }
    if (apiError?.code === "ORDER_CANCELLED") {
      return { title: "Pedido cancelado", message: `O pedido ${code} foi cancelado e não pode ser recebido.` };
    }
    if (apiError?.code === "ORDER_NOT_RECEIVABLE" && details.status === "REFUNDED") {
      return { title: "Pedido estornado", message: "O pagamento deste pedido foi estornado. Consulte o histórico de vendas." };
    }
    if (apiError?.code === "ORDER_NOT_FOUND") {
      return { title: "Pedido não encontrado", message: `Não encontramos o pedido ${code}. Confira o número informado e tente novamente.`, notFound: true };
    }
    return { title: "Pedido indisponível", message: apiError?.message ?? "Não foi possível consultar o pedido. Tente novamente." };
  }

  async function findOrderByNumber() {
    if (orderRequestRef.current) return;
    const digits = onlyDigits(manualOrderNumber);
    if (!digits || Number(digits) === 0) {
      setOrderValidation("Digite o número do pedido.");
      orderInputRef.current?.focus();
      return;
    }
    setOrderValidation("");
    setOrderSearching(true);
    orderRequestRef.current = true;
    const code = orderCodeFromDigits(digits);
    try {
      const sale = await api<Sale>(`/sales/by-code/${encodeURIComponent(digits)}/receivable`);
      onOpenSale(sale);
    } catch (error) {
      setOrderNotice(noticeForOrderError(error, code));
    } finally {
      orderRequestRef.current = false;
      setOrderSearching(false);
    }
  }

  async function openOrderFromList(candidate: Sale) {
    if (orderRequestRef.current) return;
    orderRequestRef.current = true;
    setOrderListLoading(true);
    try {
      const sale = await api<Sale>(`/sales/${candidate.id}/receivable`);
      setOrderSearchOpen(false);
      onOpenSale(sale);
    } catch (error) {
      setOrderSearchOpen(false);
      setOrderNotice(noticeForOrderError(error, `PD-${String(candidate.internalCode ?? 0).padStart(6, "0")}`, true));
    } finally {
      orderRequestRef.current = false;
      setOrderListLoading(false);
    }
  }

  function closeOrderNotice() {
    const shouldSelect = orderNotice?.notFound;
    setOrderNotice(null);
    if (shouldSelect) {
      window.setTimeout(() => {
        orderInputRef.current?.focus();
        orderInputRef.current?.select();
      }, 0);
    }
  }

  if (!cashSession) return <div className="panel grid gap-4 p-5 md:grid-cols-[1fr_320px] md:items-start">
    <div><h2 className="text-xl font-semibold">Selecionar Caixa</h2><p className="text-sm text-slate-500">Nenhum caixa está aberto. Escolha o caixa e informe o valor inicial.</p></div>
    <div className="grid gap-3">
      <label className="text-sm font-medium">Caixa<select className="field mt-1" value={cashRegister} onChange={(event) => setCashRegister(event.target.value)}><option>CX - 101</option><option>CX - 102</option></select></label>
      <label className="text-sm font-medium">Valor inicial<input className="field mt-1" inputMode="numeric" value={formatCurrencyInput(openingCents)} onChange={(event) => setOpeningCents(onlyDigits(event.target.value))} /></label>
      {openError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{openError}</p>}
      <button className="btn btn-primary" type="button" onClick={openCash}>Abrir caixa</button>
    </div>
  </div>;

  return <div className="grid gap-4">
    <div className="grid w-full gap-5">
      <div className="grid gap-4">
        <div className="grid gap-4 rounded-lg border border-slate-300 bg-white p-4 text-sm lg:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]">
          <div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Caixa</span><div className="field flex h-12 w-full min-w-[120px] items-center justify-center bg-white text-center text-lg">{cashSession.notes || "CX - 101"}</div></label>
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Data</span><div className="field flex h-12 w-full min-w-[150px] items-center justify-center bg-white text-center text-lg">{dateBR(now.toISOString())}</div></label>
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Hora</span><div className="field flex h-12 w-full min-w-[130px] items-center justify-center bg-white text-center text-lg">{now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div></label>
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Pedido</span><div className="field flex h-12 w-full min-w-[170px] items-center bg-white px-2"><input ref={orderInputRef} className="min-w-0 flex-1 bg-transparent text-center text-lg outline-none" inputMode="numeric" aria-label="Número do pedido" placeholder="000001" value={manualOrderNumber} onChange={(event) => { setManualOrderNumber(onlyDigits(event.target.value, 6)); setOrderValidation(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findOrderByNumber(); } }} disabled={orderSearching} /><button className="flex h-9 w-10 shrink-0 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50" type="button" title="Buscar pedidos pendentes" aria-label="Buscar pedidos pendentes" disabled={orderSearching} onClick={() => { setOrderSearchPage(1); setOrderSearchOpen(true); }}><Search size={22} className="text-slate-900" /></button></div>{orderSearching && <span className="text-xs text-blue-700">Buscando pedido...</span>}{orderValidation && <span className="text-xs text-red-700">{orderValidation}</span>}</label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(160px,1fr)]">
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Usuário</span><div className="field flex h-12 w-full items-center bg-white px-6 text-lg">{session.user.name}</div></label>
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Loja</span><div className="field flex h-12 w-full items-center bg-white px-6 text-lg">01</div></label>
            </div>
            {appointmentSaleLocked ? <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Cliente</span><div className="field flex h-12 w-full items-center gap-3 bg-white px-5 text-lg"><input className="min-w-0 flex-1 cursor-default bg-transparent outline-none" readOnly value={selectedCustomer ? `${customerCode(selectedCustomer)} - ${selectedCustomer.name}` : ""} /><Lock size={22} className="text-slate-500" /></div></label>
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Pet</span><div className="field flex h-12 w-full items-center gap-3 bg-white px-5 text-lg"><input className="min-w-0 flex-1 cursor-default bg-transparent outline-none" readOnly value={loadedSale?.pet?.name ?? selectedPet?.name ?? ""} /><Lock size={22} className="text-slate-500" /></div></label>
              <p className="flex items-center gap-2 text-xs font-medium text-slate-500 md:col-span-2"><Lock size={14} /> Dados vinculados ao atendimento finalizado.</p>
            </div> : <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Cliente</span><div className="field flex h-12 w-full items-center gap-3 bg-white px-5 text-lg"><input className="min-w-0 flex-1 bg-transparent outline-none" readOnly placeholder="Pesquisar cliente por código, nome, CPF ou telefone..." value={selectedCustomer ? `${customerCode(selectedCustomer)} - ${selectedCustomer.name}` : ""} onFocus={() => setClientModalOpen(true)} onClick={() => setClientModalOpen(true)} /><button type="button" onClick={() => setClientModalOpen(true)}><Search size={22} className="text-slate-900" /></button></div></label>
              <label className="grid min-w-0 gap-2"><span className="font-semibold">Pet</span><div className="field flex h-12 w-full items-center gap-3 bg-white px-5 text-lg"><input className="min-w-0 flex-1 bg-transparent outline-none" readOnly placeholder="Pesquisar pet por nome..." value={selectedPet?.name ?? ""} onFocus={() => selectedCustomer && setPetModalOpen(true)} onClick={() => selectedCustomer && setPetModalOpen(true)} /><button type="button" onClick={() => selectedCustomer && setPetModalOpen(true)}><Search size={22} className="text-slate-900" /></button></div></label>
            </div>}
          </div>
          <div className="flex min-h-0 flex-col border-t border-slate-200 pt-4 lg:self-stretch lg:border-l lg:border-t-0 lg:py-0 lg:pl-8">
            <p className="text-lg font-bold">Total</p>
            <div className="mt-3 grid flex-1 min-h-0 w-full place-items-center rounded-md border border-slate-300 px-4 py-6">
              <b className="text-3xl">{currency(orderTotal)}</b>
              {discountValue > 0 && <span className="mt-2 text-sm font-medium text-emerald-700">Desconto: -{currency(discountValue)}</span>}
              {paidBefore > 0 && <div className="mt-3 w-full border-t border-slate-200 pt-3 text-center text-sm"><p>Pago anteriormente: <b>{currency(paidBefore)}</b></p><p className="text-lg text-blue-800">Saldo restante: <b>{currency(currentPendingAmount)}</b></p></div>}
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <section className="overflow-hidden rounded-lg border border-slate-300 bg-white">
            <div className="grid grid-cols-[70px_110px_minmax(240px,1fr)_140px_160px_160px] border-b border-slate-300 bg-slate-50 px-4 py-4 text-base font-bold"><span /><span className="text-center">Código</span><span>Nome</span><span className="text-center">Quantidade</span><span className="text-center">Valor Unitário</span><span className="text-center">Valor total</span></div>
            <div className="divide-y divide-slate-200">
              {Array.from({ length: Math.max(9, cart.length) }).map((_, index) => {
                const item = cart[index];
                return <div className="grid min-h-14 grid-cols-[70px_110px_minmax(240px,1fr)_140px_160px_160px] items-center px-4 py-2 text-base" key={index}>
                  <button className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-blue-700 hover:bg-blue-50" type="button" onClick={() => setItemOpen(true)}><Search size={24} /></button>
                  <span className="text-center">{item?.code ?? ""}</span>
                  <span>{item?.description ?? ""}{item?.coveredByMembership && <span className="badge ml-2 bg-emerald-50 text-emerald-800">Coberto pelo pacote</span>}</span>
                  <span className="text-center">{item ? <input className="field h-10 w-20 py-1 text-center" disabled={item.coveredByMembership} inputMode="numeric" value={item.quantity} onChange={(event) => setCart(cart.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: Math.max(1, Number(onlyDigits(event.target.value) || 1)) } : current))} /> : ""}</span>
                  <span className="text-center">{item ? currency(item.unitPrice) : ""}</span>
                  <span className="text-center">{item ? currency(item.quantity * item.unitPrice) : ""}</span>
                </div>;
              })}
            </div>
          </section>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <button className="btn btn-primary min-h-16 justify-center gap-4 text-lg" type="button" disabled={!cart.length} onClick={() => setPaymentModalOpen(true)}><CreditCard size={28} />Pagamento</button>
          <button className="btn btn-secondary min-h-16 justify-center gap-4 text-lg" type="button" disabled={!cart.length} onClick={() => setDiscountModalOpen(true)}><Tag size={28} />Desconto</button>
          <button className="btn btn-secondary min-h-16 justify-center gap-4 border-red-200 text-lg text-red-700" type="button" onClick={cancelCurrentOrder}><XCircle size={28} />Cancelar</button>
          <button className="btn btn-secondary min-h-16 justify-center gap-4 text-lg text-orange-600" type="button" disabled={!cart.length} onClick={() => setPayLaterModalOpen(true)}><Clock3 size={28} />Pagar depois</button>
        </div>
      </div>
    </div>

    {!!waitingSales.length && <section className="grid gap-3"><h2 className="font-semibold">Aguardando pagamento</h2><DataCards items={waitingSales.map((sale) => ({ title: saleCode(sale), subtitle: `${sale.customer?.name ?? "Consumidor final"}${sale.pet?.name ? ` | ${sale.pet.name}` : ""}`, meta: `Total: ${currency(sale.total)} | ${dateTimeBR(sale.createdAt)}`, status: saleStatusLabels[sale.status], action: <button className="btn btn-primary" type="button" onClick={() => onOpenSale(sale)}>Receber</button> }))} /></section>}
    {finishedAppointmentCancelOpen && <Modal title="Este atendimento já foi realizado" onClose={() => setFinishedAppointmentCancelOpen(false)}>
      <div className="grid gap-4">
        <p className="text-sm text-slate-700">Este pedido pertence a um atendimento concluído. Ele não pode ser descartado, pois o serviço já foi realizado. Você pode voltar ao Caixa ou registrar o pagamento para depois.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-secondary" type="button" onClick={() => setFinishedAppointmentCancelOpen(false)}>Voltar ao Caixa</button>
          <button className="btn btn-primary" type="button" onClick={() => { setFinishedAppointmentCancelOpen(false); setPayLaterModalOpen(true); }}>Pagar depois</button>
        </div>
      </div>
    </Modal>}
    {clientModalOpen && <Modal title="Selecionar cliente" onClose={() => setClientModalOpen(false)}><div className="grid gap-3"><div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search size={18} className="text-slate-500" /><input className="w-full bg-transparent text-sm outline-none" autoFocus placeholder="Buscar por código, nome, CPF, celular ou pet" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} /></div><div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">{clientResults.map((customer) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={customer.id} type="button" onClick={() => { setSelectedCustomer(customer); const pet = customer.pets.find((item) => item.id === customer.matchedPetId) ?? customer.pets.find((item) => item.status === "ACTIVE") ?? null; setSelectedPetId(pet?.id ?? ""); setQuery(`${customerCode(customer)} ${customer.name}`); setClientModalOpen(false); }}><b>{customerCode(customer)} - {customer.name}</b>{customer.matchedPetName && <p className="text-blue-700">Pet encontrado: {customer.matchedPetName}</p>}<p className="text-slate-600">CPF: {formatCpf(customer.cpf)} · Celular: {formatPhone(customer.phone)}</p><p className="text-slate-600">Pets: {customer.pets.map((pet) => pet.name).join(", ") || "-"}</p></button>)}{clientQuery.trim().length < 2 && <p className="p-4 text-sm text-slate-500">Digite ao menos 2 caracteres para buscar.</p>}{clientQuery.trim().length >= 2 && !clientResults.length && <p className="p-4 text-sm text-slate-500">Nenhum cliente encontrado.</p>}</div>{selectedCustomer && <button className="btn btn-secondary justify-self-start" type="button" onClick={() => { setSelectedCustomer(null); setSelectedPetId(""); setQuery(""); setClientModalOpen(false); }}>Limpar cliente</button>}</div></Modal>}
    {discountModalOpen && <DiscountModal subtotal={cartTotal} currentType={discountType} currentCents={discountCents} currentPercent={discountPercent} onClose={() => setDiscountModalOpen(false)} onRemove={() => { setDiscountType("VALUE"); setDiscountCents("0"); setDiscountPercent(""); setDiscountModalOpen(false); }} onApply={(nextType, nextCents, nextPercent) => { setDiscountType(nextType); setDiscountCents(nextCents); setDiscountPercent(nextPercent); setDiscountModalOpen(false); }} />}
    {paymentModalOpen && <PaymentModal sale={loadedSale} customer={currentCustomer ?? null} pet={currentPet ?? null} total={orderTotal} paidBefore={paidBefore} existingPayments={existingPaymentPayload()} onSelectCustomer={openCustomerFromDeferredFlow} onClose={() => setPaymentModalOpen(false)} onConfirm={(payload) => saveCurrentOrder(payload)} />}
    {payLaterModalOpen && <PayLaterModal sale={loadedSale} customer={currentCustomer ?? null} pet={currentPet ?? null} total={orderTotal} paidBefore={paidBefore} pendingAmount={currentPendingAmount} onSelectCustomer={openCustomerFromDeferredFlow} onClose={() => setPayLaterModalOpen(false)} onConfirm={(pendingReason, pendingNotes, expectedPaymentDate) => saveCurrentOrder({ status: "PENDING", payments: existingPaymentPayload(), paymentMethod: existingPaymentPayload()[0]?.method, pendingReason, pendingNotes, expectedPaymentDate })} />}
    {petModalOpen && <Modal title="Selecionar pet" onClose={() => setPetModalOpen(false)}><div className="grid gap-3"><div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search size={18} className="text-slate-500" /><input className="w-full bg-transparent text-sm outline-none" autoFocus placeholder="Pesquisar pet por nome..." value={petQuery} onChange={(event) => setPetQuery(event.target.value)} /></div><div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">{filteredPets.map((pet) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={pet.id} type="button" onClick={() => { setSelectedPetId(pet.id); setPetQuery(""); setPetModalOpen(false); }}><b>{pet.name}</b><p className="text-slate-600">Espécie: {pet.customSpecies || pet.species} · Raça: {pet.breed || "-"}</p></button>)}{!selectedCustomer && <p className="p-4 text-sm text-slate-500">Selecione um cliente antes de buscar o pet.</p>}{selectedCustomer && !filteredPets.length && <p className="p-4 text-sm text-slate-500">Nenhum pet encontrado para este cliente.</p>}</div></div></Modal>}
    {itemOpen && <Modal title="Buscar produto ou serviço" onClose={() => setItemOpen(false)}><div className="grid gap-3"><input className="field" autoFocus placeholder="Código, nome, SKU ou categoria" value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} /><div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">{catalogItems.map((item) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={`${item.type}-${item.id}`} type="button" onClick={() => addCatalogItem(item)}><b>{item.code} — {item.name}</b><p className="text-slate-600">{item.type === "SERVICE" ? "Serviço" : "Produto"} · {item.meta}</p><p className="font-semibold text-blue-700">{currency(item.price)}</p></button>)}{!catalogItems.length && <p className="p-4 text-sm text-slate-500">Nenhum produto ou serviço encontrado.</p>}</div></div></Modal>}
    {orderNotice && <Modal title={orderNotice.title} onClose={closeOrderNotice}>
      <div className="grid gap-4">
        <p className="text-sm text-slate-700">{orderNotice.message}</p>
        {!!orderNotice.details?.length && <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm">{orderNotice.details.map((detail) => <p key={detail}>{detail}</p>)}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          {orderNotice.notFound && <button className="btn btn-secondary" type="button" onClick={closeOrderNotice}>Fechar</button>}
          {orderNotice.notFound && <button className="btn btn-primary" type="button" onClick={() => { setOrderNotice(null); onShortcut("pending"); }}>Ver pedidos pendentes</button>}
          {!orderNotice.notFound && <button className="btn btn-primary" type="button" onClick={closeOrderNotice}>Entendi</button>}
        </div>
      </div>
    </Modal>}
    {orderSearchOpen && <Modal title="Buscar pedido" onClose={() => setOrderSearchOpen(false)}>
      <div className="grid gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search size={18} className="text-slate-500" /><input className="w-full bg-transparent text-sm outline-none" autoFocus placeholder="Buscar por pedido, cliente, pet, CPF ou telefone..." value={orderSearchQuery} onChange={(event) => { setOrderSearchQuery(event.target.value); setOrderSearchPage(1); }} /></div>
        <div className="max-h-[65vh] overflow-y-auto">
          {orderListLoading && <p className="p-5 text-center text-sm text-blue-700">Buscando pedidos...</p>}
          {!orderListLoading && <div className="grid gap-3">{(orderSearchResult?.items ?? []).map((sale) => {
            const paid = Number(sale.paidAmount ?? 0);
            const remaining = Math.max(0, Number(sale.pendingAmount ?? Number(sale.total) - paid));
            const observation = pendingObservation(sale.pendingNotes);
            const detailsExpanded = expandedOrderDetails.has(sale.id);
            const hasLongDetails = observation.length > 100 || (pendingReasonLabels[sale.pendingReason ?? ""] ?? sale.pendingReason ?? "").length > 80;
            return <article className="rounded-lg border border-slate-200 p-4" key={sale.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="grid min-w-0 flex-1 gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><b className="text-lg">PD-{String(sale.internalCode ?? 0).padStart(6, "0")}</b><span className="badge bg-blue-50 text-blue-800">{saleStatusLabels[sale.status]}</span></div>
                  <p><b>{sale.customer?.name ?? "Consumidor final"}</b></p><p>Pet: {sale.pet?.name ?? "-"}</p>
                  <p>Telefone: {sale.customer?.phone ? formatPhone(sale.customer.phone) : "-"}</p><p>Atendimento: {dateTimeBR(sale.createdAt)}</p>
                  <p>Origem: {saleOriginLabels[sale.origin]}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><span>Total: <b>{currency(sale.total)}</b></span><span>Pago: <b>{currency(paid)}</b></span><span>Restante: <b>{currency(remaining)}</b></span></div>
                  <div className="mt-2 grid min-w-0 gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                    <p className="flex items-center gap-2 font-semibold"><Clock3 size={16} aria-hidden="true" />Motivo do pagamento pendente</p>
                    <p className={detailsExpanded ? "whitespace-pre-wrap break-words" : "line-clamp-2 break-words"}>{sale.pendingReason ? pendingReasonLabels[sale.pendingReason] ?? sale.pendingReason : "Motivo não informado"}</p>
                    {observation && <p className={detailsExpanded ? "whitespace-pre-wrap break-words" : "line-clamp-2 break-words"}><b>Observação:</b> {observation}</p>}
                    <p><b>Previsão de pagamento:</b> {expectedPaymentText(sale.expectedPaymentDate)}</p>
                    {detailsExpanded && <><p><b>Pendente desde:</b> {dateTimeBR(sale.pendingSince ?? sale.createdAt)}</p><p><b>Operador:</b> {sale.operatorName ?? "Não informado"}</p></>}
                    {hasLongDetails && <button className="justify-self-start font-semibold underline" type="button" onClick={() => setExpandedOrderDetails((current) => {
                      const next = new Set(current);
                      if (next.has(sale.id)) next.delete(sale.id);
                      else next.add(sale.id);
                      return next;
                    })}>{detailsExpanded ? "Mostrar menos" : "Ver detalhes"}</button>}
                  </div>
                </div>
                <button className="btn btn-primary min-h-11 shrink-0 justify-center" type="button" disabled={orderListLoading} onClick={() => void openOrderFromList(sale)}>Abrir no Caixa</button>
              </div>
            </article>;
          })}</div>}
          {!orderListLoading && !orderSearchResult?.items.length && <p className="p-5 text-center text-sm text-slate-500">Nenhum pedido disponível para cobrança.</p>}
        </div>
        {(orderSearchResult?.totalPages ?? 1) > 1 && <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm"><button className="btn btn-secondary" type="button" disabled={orderSearchPage <= 1 || orderListLoading} onClick={() => setOrderSearchPage((page) => Math.max(1, page - 1))}>Anterior</button><span>Página {orderSearchResult?.page} de {orderSearchResult?.totalPages}</span><button className="btn btn-secondary" type="button" disabled={orderSearchPage >= (orderSearchResult?.totalPages ?? 1) || orderListLoading} onClick={() => setOrderSearchPage((page) => page + 1)}>Próxima</button></div>}
      </div>
    </Modal>}
    {completedReceipt && <ReceiptSuccessModal sale={completedReceipt.sale} receipt={completedReceipt.receipt} onClose={() => setCompletedReceipt(null)} />}
  </div>;
}

function normalizedPercent(value: string) {
  const number = Number(value.replace(",", ".") || 0);
  if (Number.isNaN(number)) return 0;
  return Math.min(Math.max(number, 0), 100);
}

function ReceiptSuccessModal({ sale, receipt, onClose }: { sale: Sale; receipt: SalesReceipt; onClose: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return <Modal title="Pagamento concluído" onClose={onClose}>
    <div className="grid gap-4">
      <div className="rounded-lg bg-emerald-50 p-5 text-center">
        <p className="text-sm font-medium text-emerald-800">Comprovante</p>
        <b className="text-3xl text-emerald-900">{receiptCode(receipt)}</b>
      </div>
      <div className="grid gap-2 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
        <p><b>Pedido:</b> {saleCode(sale)}</p>
        <p><b>Total pago:</b> {currency(receipt.paidAmount)}</p>
        <p><b>Pagamento:</b> {receipt.paymentsSnapshot.map((payment) => paymentMethodLabels[payment.method]).join(" + ")}</p>
        <p><b>Data e hora:</b> {dateTimeBR(receipt.issuedAt)}</p>
      </div>
      {detailsOpen && <div className="grid gap-3 rounded-lg border border-slate-200 p-4 text-sm">
        <p><b>{receipt.companyNameSnapshot}</b>{receipt.companyDocumentSnapshot ? ` · ${receipt.companyDocumentSnapshot}` : ""}</p>
        <p>Cliente: {receipt.customerNameSnapshot ?? "Consumidor final"} · Pet: {receipt.petNameSnapshot ?? "-"}</p>
        {receipt.itemsSnapshot.map((item, index) => <div className="flex justify-between gap-3" key={`${item.description}-${index}`}><span>{item.catalogCode ? String(item.catalogCode).padStart(6, "0") : "-"} · {item.description} · {item.quantity}x</span><b>{currency(item.total)}</b></div>)}
        <div className="border-t border-slate-200 pt-2"><p>Subtotal: {currency(receipt.subtotal)}</p><p>Desconto: {currency(receipt.discount)}</p><p className="font-bold">Total: {currency(receipt.total)}</p></div>
        {receipt.paymentsSnapshot.map((payment, index) => <p key={index}>{paymentMethodLabels[payment.method]}: {currency(payment.amount)}{payment.cardBrand ? ` · ${payment.cardBrand}` : ""}{payment.installments ? ` · ${payment.installments}x` : ""}{payment.cardNsu ? ` · NSU ${payment.cardNsu}` : ""}</p>)}
        <p>Operador: {receipt.operatorNameSnapshot ?? "-"}</p>
      </div>}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-secondary" type="button" onClick={onClose}>Fechar</button>
        <button className="btn btn-secondary" type="button" onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? "Ocultar comprovante" : "Visualizar comprovante"}</button>
        <button className="btn btn-primary" type="button" onClick={() => window.print()}>Imprimir comprovante</button>
      </div>
    </div>
  </Modal>;
}

function buildPendingNotes(notes: string, expectedDate: string) {
  const cleanNotes = notes.trim();
  if (!expectedDate) return cleanNotes;
  return `${cleanNotes}\nPrevisão de pagamento: ${dateBR(`${expectedDate}T00:00:00`)}`;
}

function DiscountModal({ subtotal, currentType, currentCents, currentPercent, onClose, onRemove, onApply }: { subtotal: number; currentType: "VALUE" | "PERCENT"; currentCents: string; currentPercent: string; onClose: () => void; onRemove: () => void; onApply: (type: "VALUE" | "PERCENT", cents: string, percent: string) => void }) {
  const [type, setType] = useState<"VALUE" | "PERCENT">(currentType);
  const [valueCents, setValueCents] = useState(currentCents);
  const [percent, setPercent] = useState(currentPercent);
  const [error, setError] = useState("");
  const percentNumber = normalizedPercent(percent);
  const fixedValue = decimalFromCents(valueCents);
  const discount = type === "PERCENT" ? subtotal * percentNumber / 100 : fixedValue;
  const safeDiscount = Math.min(subtotal, Math.max(0, discount));
  const finalTotal = Math.max(0, subtotal - safeDiscount);
  const hasCurrentDiscount = currentType === "PERCENT" ? normalizedPercent(currentPercent) > 0 : decimalFromCents(currentCents) > 0;

  function applyDiscount() {
    setError("");
    if (type === "PERCENT") {
      const parsed = Number(percent.replace(",", ".") || 0);
      if (Number.isNaN(parsed) || parsed < 0) return setError("Informe uma porcentagem válida.");
      if (parsed > 100) return setError("A porcentagem não pode passar de 100%.");
      onApply("PERCENT", "0", String(parsed).replace(".", ","));
      return;
    }
    if (fixedValue < 0) return setError("O desconto não pode ser negativo.");
    if (fixedValue - subtotal > 0.01) return setError("O desconto não pode ser maior que o subtotal.");
    onApply("VALUE", onlyDigits(valueCents), "");
  }

  return <Modal title="Aplicar desconto" onClose={onClose}>
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <button className={`btn ${type === "PERCENT" ? "btn-primary" : "btn-secondary"}`} type="button" onClick={() => setType("PERCENT")}><Tag size={16} />Porcentagem</button>
        <button className={`btn ${type === "VALUE" ? "btn-primary" : "btn-secondary"}`} type="button" onClick={() => setType("VALUE")}><Tag size={16} />Valor em reais</button>
      </div>
      {type === "PERCENT" ? <label className="text-sm font-medium">Valor do desconto<input className="field mt-1" inputMode="decimal" placeholder="10%" value={percent} onChange={(event) => setPercent(event.target.value.replace(/[^\d,.]/g, ""))} /></label> : <label className="text-sm font-medium">Valor do desconto<input className="field mt-1" inputMode="numeric" value={formatCurrencyInput(valueCents)} onChange={(event) => setValueCents(onlyDigits(event.target.value))} /></label>}
      <div className="rounded-lg bg-slate-50 p-4 text-sm">
        <p className="flex justify-between"><span>Subtotal</span><b>{currency(subtotal)}</b></p>
        <p className="flex justify-between text-emerald-700"><span>Desconto</span><b>-{currency(safeDiscount)}</b></p>
        <p className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base"><span>Total final</span><b>{currency(finalTotal)}</b></p>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {hasCurrentDiscount && <button className="btn btn-secondary mr-auto" type="button" onClick={onRemove}>Remover desconto</button>}
        <button className="btn btn-secondary" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" type="button" onClick={applyDiscount}>Aplicar desconto</button>
      </div>
    </div>
  </Modal>;
}

const posPaymentMethods: { value: PosPaymentMethod; label: string }[] = [
  { value: "CASH", label: "Dinheiro" },
  { value: "PIX", label: "PIX" },
  { value: "DEBIT", label: "Cartão de débito" },
  { value: "CREDIT", label: "Cartão de crédito" }
];
const cardBrands = ["Visa", "Mastercard", "Elo", "Hipercard", "American Express", "Outra"];

function emptyPosPayment(amount: number): PosPaymentForm {
  const amountCents = centsFromCurrency(amount);
  return { method: "PIX", amountCents, cashReceivedCents: amountCents, cardBrand: "", cardNsu: "", cardAuthorization: "", installments: "1" };
}

function legacyMethodFromFinancial(type: FinancialPaymentMethod["type"]): PosPaymentMethod {
  return ({ CASH: "CASH", PIX: "PIX", DEBIT_CARD: "DEBIT", CREDIT_CARD: "CREDIT" } as Partial<Record<FinancialPaymentMethod["type"], PosPaymentMethod>>)[type] ?? "PIX";
}

function PaymentModal({ sale, customer, pet, total, paidBefore, existingPayments, onSelectCustomer, onClose, onConfirm }: { sale: Sale | null; customer: Customer | null; pet: Pet | null; total: number; paidBefore: number; existingPayments: { method: PaymentMethod; amount: number; cardBrand?: string; cardNsu?: string; cardAuthorization?: string; installments?: number | null }[]; onSelectCustomer: () => void; onClose: () => void; onConfirm: (payload: Record<string, unknown>) => Promise<void> }) {
  const { data: financialMethods } = useData<FinancialPaymentMethod[]>("/financial/payment-methods/active");
  const balance = Number(Math.max(0, total - paidBefore).toFixed(2));
  const [rows, setRows] = useState<PosPaymentForm[]>(() => [emptyPosPayment(balance)]);
  const [partialOpen, setPartialOpen] = useState(false);
  const [pendingReason, setPendingReason] = useState("PARTIAL_PAYMENT");
  const [pendingNotes, setPendingNotes] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const newPaid = Number(rows.reduce((sum, row) => sum + decimalFromCents(row.amountCents), 0).toFixed(2));
  const totalPaid = Number((paidBefore + newPaid).toFixed(2));
  const remaining = Number(Math.max(0, total - totalPaid).toFixed(2));
  const overpaid = Number(Math.max(0, totalPaid - total).toFixed(2));
  useEffect(() => {
    if (!financialMethods?.length) return;
    setRows((current) => current.map((row) => {
      if (row.financialPaymentMethodId) return row;
      const configured = financialMethods.find((method) => legacyMethodFromFinancial(method.type) === row.method);
      return configured ? { ...row, financialPaymentMethodId: configured.id } : row;
    }));
  }, [financialMethods]);

  function updateRow(index: number, patch: Partial<PosPaymentForm>) {
    setRows(rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, ...patch };
      if (patch.method === "CASH" && !next.cashReceivedCents) next.cashReceivedCents = next.amountCents;
      if (patch.method !== "CREDIT") next.installments = patch.method === "DEBIT" ? "" : next.installments;
      return next;
    }));
  }

  function removeRow(index: number) {
    if (rows.length === 1) return;
    setRows(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function addRow() {
    const openBalance = Math.max(0, balance - newPaid);
    setRows([...rows, emptyPosPayment(openBalance)]);
  }

  function paymentPayload() {
    return rows
      .map((row) => ({
        method: row.method,
        financialPaymentMethodId: row.financialPaymentMethodId,
        amount: decimalFromCents(row.amountCents),
        cardBrand: row.method === "DEBIT" || row.method === "CREDIT" ? row.cardBrand.trim() : undefined,
        cardNsu: row.method === "PIX" || row.method === "DEBIT" || row.method === "CREDIT" ? row.cardNsu.trim() || undefined : undefined,
        pixReference: row.method === "PIX" ? row.cardNsu.trim() || undefined : undefined,
        cardAuthorization: row.method === "DEBIT" || row.method === "CREDIT" ? row.cardAuthorization.trim() || undefined : undefined,
        installments: row.method === "CREDIT" ? Number(row.installments || 0) : undefined,
        cashReceived: row.method === "CASH" ? decimalFromCents(row.cashReceivedCents) : undefined,
        changeAmount: row.method === "CASH" ? Math.max(0, decimalFromCents(row.cashReceivedCents) - decimalFromCents(row.amountCents)) : undefined
      }))
      .filter((payment) => payment.amount > 0);
  }

  function validateRows(requireFullPayment: boolean) {
    const nextErrors: Record<string, string> = {};
    const payments = paymentPayload();
    if (!payments.length) nextErrors.form = "Adicione ao menos uma forma de pagamento.";
    rows.forEach((row, index) => {
      const amount = decimalFromCents(row.amountCents);
      if (amount <= 0) nextErrors[`amount-${index}`] = "Informe um valor maior que zero.";
      if (row.method === "CASH" && decimalFromCents(row.cashReceivedCents) < amount) nextErrors[`cash-${index}`] = "Valor entregue não pode ser menor que o valor usado.";
      if ((row.method === "DEBIT" || row.method === "CREDIT") && !row.cardBrand.trim()) nextErrors[`brand-${index}`] = "Informe a bandeira.";
      if ((row.method === "DEBIT" || row.method === "CREDIT") && !row.cardNsu.trim()) nextErrors[`nsu-${index}`] = "Informe a NSU do cartão.";
      if (row.method === "CREDIT" && Number(row.installments || 0) <= 0) nextErrors[`installments-${index}`] = "Informe as parcelas.";
    });
    if (overpaid > 0.01) nextErrors.form = "A soma dos pagamentos não pode ser maior que o saldo restante.";
    if (requireFullPayment && remaining > 0.01) nextErrors.form = `Restam ${currency(remaining)} a receber.`;
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function confirmFullPayment() {
    setMessage("");
    if (!validateRows(true) || saving) return;
    setSaving(true);
    try {
      const payments = [...existingPayments, ...paymentPayload()];
      await onConfirm({ status: "PAID", paymentMethod: payments[0]?.method, payments });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao confirmar pagamento.");
      setSaving(false);
    }
  }

  async function confirmPartialPayment() {
    setMessage("");
    if (!customer?.id) {
      setErrors({ form: "Para registrar um pagamento para depois, é necessário vincular um cliente ao pedido." });
      return;
    }
    if (!pendingNotes.trim()) {
      setErrors({ form: "Informe a observação obrigatória." });
      return;
    }
    if (!validateRows(false) || remaining <= 0.01 || saving) return;
    setSaving(true);
    try {
      const payments = [...existingPayments, ...paymentPayload()];
      await onConfirm({ status: "PARTIALLY_PAID", paymentMethod: payments[0]?.method, payments, pendingReason, pendingNotes: buildPendingNotes(pendingNotes, expectedDate), expectedPaymentDate: expectedDate || undefined });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar pagamento parcial.");
      setSaving(false);
    }
  }

  return <Modal title="Receber pagamento" onClose={onClose}>
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-3">
        <p><b>Pedido:</b> {sale?.id ? saleCode(sale) : "Novo pedido"}</p>
        <p><b>Cliente:</b> {customer ? `${customerCode(customer)} - ${customer.name}` : "Consumidor final"}</p>
        <p><b>Pet:</b> {pet?.name ?? "-"}</p>
        <p><b>Total:</b> {currency(total)}</p>
        <p><b>Já pago:</b> {currency(paidBefore)}</p>
        <p><b>Saldo restante:</b> {currency(balance)}</p>
      </div>
      <div className="grid gap-3">
        {rows.map((row, index) => {
          const amount = decimalFromCents(row.amountCents);
          const cashReceived = decimalFromCents(row.cashReceivedCents);
          const change = row.method === "CASH" ? Math.max(0, cashReceived - amount) : 0;
          return <div className="grid gap-3 rounded-lg border border-slate-200 p-3" key={index}>
            <div className="grid gap-3 md:grid-cols-[180px_150px_1fr_44px]">
              <select className="field" value={row.financialPaymentMethodId ?? `legacy:${row.method}`} onChange={(event) => {
                const configured = financialMethods?.find((method) => method.id === event.target.value);
                updateRow(index, configured ? { financialPaymentMethodId: configured.id, method: legacyMethodFromFinancial(configured.type), cardBrand: "", cardNsu: "", installments: "1" } : { financialPaymentMethodId: undefined, method: event.target.value.replace("legacy:", "") as PosPaymentMethod });
              }}>{financialMethods?.length ? financialMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>) : posPaymentMethods.map((method) => <option key={method.value} value={`legacy:${method.value}`}>{method.label}</option>)}</select>
              <input className="field" placeholder="Valor" inputMode="numeric" value={formatCurrencyInput(row.amountCents)} onChange={(event) => updateRow(index, { amountCents: onlyDigits(event.target.value) })} />
              {row.method === "CASH" && <div className="grid gap-2 md:grid-cols-2"><input className="field" placeholder="Valor entregue" inputMode="numeric" value={formatCurrencyInput(row.cashReceivedCents)} onChange={(event) => updateRow(index, { cashReceivedCents: onlyDigits(event.target.value) })} /><p className="self-center text-sm font-medium">Troco: {currency(change)}</p></div>}
              {row.method === "PIX" && <input className="field" placeholder="Código do comprovante PIX" value={row.cardNsu} onChange={(event) => updateRow(index, { cardNsu: event.target.value })} />}
              {(row.method === "DEBIT" || row.method === "CREDIT") && <div className="grid gap-2 md:grid-cols-3"><select className="field" value={row.cardBrand} onChange={(event) => updateRow(index, { cardBrand: event.target.value })}><option value="">Bandeira</option>{(financialMethods?.find((method) => method.id === row.financialPaymentMethodId)?.brands.map((brand) => brand.brandName) ?? cardBrands).map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select>{row.method === "CREDIT" && <select className="field" value={row.installments} onChange={(event) => updateRow(index, { installments: event.target.value })}>{Array.from({ length: financialMethods?.find((method) => method.id === row.financialPaymentMethodId)?.maxInstallments ?? 12 }, (_, optionIndex) => optionIndex + 1).map((installment) => <option key={installment} value={installment}>{installment}x</option>)}</select>}<input className="field" placeholder="NSU" value={row.cardNsu} onChange={(event) => updateRow(index, { cardNsu: event.target.value })} /></div>}
              <button className="btn btn-secondary" type="button" disabled={rows.length === 1} onClick={() => removeRow(index)}><Trash2 size={16} /></button>
            </div>
            {errors[`amount-${index}`] && <p className="text-sm text-red-700">{errors[`amount-${index}`]}</p>}
            {errors[`cash-${index}`] && <p className="text-sm text-red-700">{errors[`cash-${index}`]}</p>}
            {errors[`brand-${index}`] && <p className="text-sm text-red-700">{errors[`brand-${index}`]}</p>}
            {errors[`nsu-${index}`] && <p className="text-sm text-red-700">{errors[`nsu-${index}`]}</p>}
            {errors[`installments-${index}`] && <p className="text-sm text-red-700">{errors[`installments-${index}`]}</p>}
          </div>;
        })}
        <button className="btn btn-secondary justify-self-start" type="button" onClick={addRow}><Plus size={16} />Adicionar outra forma de pagamento</button>
      </div>
      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-3">
        <p><b>Total do pedido:</b> {currency(total)}</p>
        <p><b>Total informado:</b> {currency(newPaid)}</p>
        <p><b>Saldo restante:</b> {currency(remaining)}</p>
      </div>
      {remaining > 0.01 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p><b>Restam {currency(remaining)} a receber.</b></p>
        <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-secondary" type="button" onClick={addRow}>Adicionar outra forma de pagamento</button><button className="btn btn-secondary" type="button" onClick={() => setPartialOpen(true)}>Registrar saldo restante para pagar depois</button></div>
      </div>}
      {partialOpen && <div className="grid gap-3 rounded-lg border border-amber-200 p-3">
        {!customer?.id && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700"><p>Para registrar um pagamento para depois, é necessário vincular um cliente ao pedido.</p><button className="btn btn-secondary mt-2" type="button" onClick={onSelectCustomer}>Selecionar cliente</button></div>}
        <select className="field" value={pendingReason} onChange={(event) => setPendingReason(event.target.value)}>{Object.entries(pendingReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <textarea className="field" placeholder="Observação obrigatória" value={pendingNotes} onChange={(event) => setPendingNotes(event.target.value)} />
        <label className="text-sm font-medium">Data prevista de pagamento<input className="field mt-1" type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></label>
      </div>}
      {errors.form && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</p>}
      {message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-secondary" type="button" onClick={onClose}>Cancelar</button>
        {partialOpen && remaining > 0.01 ? <button className="btn btn-primary" type="button" disabled={saving} onClick={confirmPartialPayment}>{saving ? "Salvando..." : "Confirmar pagamento parcial"}</button> : <button className="btn btn-primary" type="button" disabled={saving || remaining > 0.01} onClick={confirmFullPayment}>{saving ? "Salvando..." : "Confirmar pagamento"}</button>}
      </div>
    </div>
  </Modal>;
}

function PayLaterModal({ sale, customer, pet, total, paidBefore, pendingAmount, onSelectCustomer, onClose, onConfirm }: { sale: Sale | null; customer: Customer | null; pet: Pet | null; total: number; paidBefore: number; pendingAmount: number; onSelectCustomer: () => void; onClose: () => void; onConfirm: (pendingReason: string, pendingNotes: string, expectedPaymentDate?: string) => Promise<void> }) {
  const [pendingReason, setPendingReason] = useState(sale?.pendingReason ?? "PIX_LATER");
  const [pendingNotes, setPendingNotes] = useState(sale?.pendingNotes ?? "");
  const [expectedDate, setExpectedDate] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function savePayLater() {
    setMessage("");
    if (!customer?.id) return setMessage("Para registrar um pagamento para depois, é necessário vincular um cliente ao pedido.");
    if (!pendingNotes.trim()) return setMessage("Informe a observação obrigatória.");
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm(pendingReason, buildPendingNotes(pendingNotes, expectedDate), expectedDate || undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar pagamento para depois.");
      setSaving(false);
    }
  }

  return <Modal title="Registrar pagamento para depois" onClose={onClose}>
    <div className="grid gap-4">
      {!customer?.id ? <div className="grid gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">
        <p>Para registrar um pagamento para depois, é necessário vincular um cliente ao pedido.</p>
        <div className="flex flex-wrap justify-end gap-2"><button className="btn btn-secondary" type="button" onClick={onClose}>Voltar</button><button className="btn btn-primary" type="button" onClick={onSelectCustomer}>Selecionar cliente</button></div>
      </div> : <>
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-3">
          <p><b>Cliente:</b> {customerCode(customer)} - {customer.name}</p>
          <p><b>Pet:</b> {pet?.name ?? "-"}</p>
          <p><b>Pedido:</b> {sale?.id ? saleCode(sale) : "Novo pedido"}</p>
          <p><b>Total:</b> {currency(total)}</p>
          <p><b>Valor já pago:</b> {currency(paidBefore)}</p>
          <p><b>Saldo pendente:</b> {currency(pendingAmount)}</p>
        </div>
        <select className="field" value={pendingReason} onChange={(event) => setPendingReason(event.target.value)}>{Object.entries(pendingReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <textarea className="field" placeholder="Observação obrigatória" value={pendingNotes} onChange={(event) => setPendingNotes(event.target.value)} />
        <label className="text-sm font-medium">Data prevista de pagamento<input className="field mt-1" type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></label>
        {message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancelar</button><button className="btn btn-primary" type="button" disabled={saving} onClick={savePayLater}>{saving ? "Salvando..." : "Confirmar pagar depois"}</button></div>
      </>}
    </div>
  </Modal>;
}

function CashPendingSales({ onOpenInPos }: { onOpenInPos: (sale: Sale) => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [period, setPeriod] = useState("today");
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [operator, setOperator] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expectedFrom, setExpectedFrom] = useState("");
  const [expectedTo, setExpectedTo] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [order, setOrder] = useState("oldest");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams({ q: debouncedQuery, period, order, page: String(page), limit: "15" });
  if (status) params.set("status", status);
  if (reason) params.set("reason", reason);
  if (operator.trim()) params.set("operator", operator.trim());
  if (period === "custom" && from) params.set("from", from);
  if (period === "custom" && to) params.set("to", to);
  if (expectedFrom) params.set("expectedFrom", expectedFrom);
  if (expectedTo) params.set("expectedTo", expectedTo);
  if (minValue) params.set("minValue", minValue.replace(",", "."));
  if (maxValue) params.set("maxValue", maxValue.replace(",", "."));
  if (overdue) params.set("overdue", "true");
  const queryKey = params.toString();
  const { data, error, loading, refreshing, refresh } = useData<ReceivableSalesPage>(`/sales/receivable/search?${queryKey}`);
  const sales = data?.items ?? [];
  function overdueText(sale: Sale) {
    if (!sale.expectedPaymentDate) return "";
    const days = Math.floor((new Date(`${localDateInput()}T12:00:00`).getTime() - new Date(sale.expectedPaymentDate).getTime()) / 86400000);
    return days > 0 ? `Vencido há ${days} dia${days === 1 ? "" : "s"}` : "";
  }
  return <div className="grid gap-4">
    {loading && <p className="text-sm text-slate-500">Carregando pedidos pendentes...</p>}
    {refreshing && <p className="text-sm text-slate-500">Atualizando resultados...</p>}
    {error && <p className="text-sm text-red-600">Não foi possível carregar os pedidos pendentes.</p>}
    <div className="panel flex items-center gap-2 p-3"><Search size={18} className="text-slate-400" /><input className="w-full bg-transparent text-sm outline-none" placeholder="Pedido, cliente, CPF, telefone, pet ou item" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><button className="btn btn-secondary md:hidden" onClick={() => setFiltersOpen(!filtersOpen)}>Filtrar</button></div>
    <div className={`panel gap-3 p-4 ${filtersOpen ? "grid" : "hidden md:grid"} md:grid-cols-4`}>
      <label className="text-sm font-medium">Período<select className="field mt-1" value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }}><option value="today">Hoje</option><option value="week">Esta semana</option><option value="month">Este mês</option><option value="custom">Personalizado</option><option value="all">Todos os pendentes</option></select></label>
      {period === "custom" && <><label className="text-sm font-medium">Data inicial<input className="field mt-1" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label><label className="text-sm font-medium">Data final<input className="field mt-1" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label></>}
      <label className="text-sm font-medium">Status<select className="field mt-1" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Todos</option><option value="PENDING">Pagar depois</option><option value="PARTIALLY_PAID">Parcialmente pago</option><option value="WAITING_PAYMENT">Aguardando pagamento</option></select></label>
      <label className="text-sm font-medium">Motivo<select className="field mt-1" value={reason} onChange={(event) => { setReason(event.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(pendingReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-medium">Operador<input className="field mt-1" value={operator} onChange={(event) => { setOperator(event.target.value); setPage(1); }} /></label>
      <label className="text-sm font-medium">Previsão inicial<input className="field mt-1" type="date" value={expectedFrom} onChange={(event) => { setExpectedFrom(event.target.value); setPage(1); }} /></label>
      <label className="text-sm font-medium">Previsão final<input className="field mt-1" type="date" value={expectedTo} onChange={(event) => { setExpectedTo(event.target.value); setPage(1); }} /></label>
      <label className="text-sm font-medium">Saldo mínimo<input className="field mt-1" inputMode="decimal" value={minValue} onChange={(event) => { setMinValue(event.target.value); setPage(1); }} /></label>
      <label className="text-sm font-medium">Saldo máximo<input className="field mt-1" inputMode="decimal" value={maxValue} onChange={(event) => { setMaxValue(event.target.value); setPage(1); }} /></label>
      <label className="text-sm font-medium">Ordenar<select className="field mt-1" value={order} onChange={(event) => { setOrder(event.target.value); setPage(1); }}><option value="oldest">Mais antigos primeiro</option><option value="newest">Mais recentes primeiro</option><option value="highest">Maior saldo</option><option value="lowest">Menor saldo</option><option value="expected">Previsão mais próxima</option><option value="customer">Cliente</option></select></label>
      <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 p-3 text-sm font-medium"><input type="checkbox" checked={overdue} onChange={(event) => { setOverdue(event.target.checked); setPage(1); }} />Somente vencidos</label>
    </div>
    <div className="panel grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><p><b>Pedidos encontrados:</b> {data?.total ?? 0}</p><p><b>Valor total pendente:</b> {currency(data?.summary?.total ?? 0)}</p><p><b>Valor já recebido:</b> {currency(data?.summary?.paid ?? 0)}</p><p><b>Saldo a receber:</b> {currency(data?.summary?.pending ?? 0)}</p></div>
    <DataCards items={sales.map((sale) => ({
      title: saleCode(sale),
      subtitle: `${sale.customer?.name ?? "Consumidor final"}${sale.pet?.name ? ` | ${sale.pet.name}` : ""}`,
      meta: `Telefone: ${sale.customer?.phone ? formatPhone(sale.customer.phone) : "-"} | Pendente desde: ${dateTimeBR(sale.pendingSince ?? sale.createdAt)} | Total: ${currency(sale.total)} | Pago: ${currency(sale.paidAmount ?? 0)} | Saldo: ${currency(sale.pendingAmount ?? sale.total)} | Motivo: ${sale.pendingReason ? pendingReasonLabels[sale.pendingReason] ?? sale.pendingReason : "-"}${sale.expectedPaymentDate ? ` | Previsão: ${dateBR(sale.expectedPaymentDate)}` : ""}${overdueText(sale) ? ` | ${overdueText(sale)}` : ""}`,
      status: overdueText(sale) || saleStatusLabels[sale.status],
      action: <button className="btn btn-primary min-h-11 w-full justify-center sm:w-auto" onClick={() => onOpenInPos(sale)}>Receber</button>
    }))} />
    {!loading && !sales.length && <p className="text-sm text-slate-500">Nenhum pedido encontrado para os filtros selecionados.</p>}
    <div className="flex items-center justify-between"><button className="btn btn-secondary" disabled={(data?.page ?? 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><span className="text-sm">Página {data?.page ?? 1} de {data?.totalPages ?? 1}</span><button className="btn btn-secondary" disabled={(data?.page ?? 1) >= (data?.totalPages ?? 1)} onClick={() => setPage((current) => current + 1)}>Próxima</button></div>
    <button className="btn btn-secondary justify-self-start" type="button" onClick={refresh}>Atualizar</button>
  </div>;
}

function CashMovements({ cashSession, onRefresh }: { cashSession: CashSession | null; onRefresh: () => void }) {
  const [type, setType] = useState<CashMovementType>("CASH_IN");
  const [amountCents, setAmountCents] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [originAccount, setOriginAccount] = useState("");
  const [destinationAccount, setDestinationAccount] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [message, setMessage] = useState("");
  const { data: summary, refresh } = useData<CashSummary>(cashSession ? `/cash/${cashSession.id}/summary` : "", [cashSession?.id]);
  const needsAdmin = ["CASH_OUT", "EXPENSE", "TRANSFER_OUT", "ADJUSTMENT"].includes(type);

  async function saveMovement() {
    if (!cashSession) return;
    setMessage("");
    try {
      await api(`/cash/${cashSession.id}/movements`, {
        method: "POST",
        body: JSON.stringify({
          type,
          amount: decimalFromCents(amountCents),
          reason,
          notes,
          originAccount: originAccount || undefined,
          destinationAccount: destinationAccount || undefined,
          adminPassword: needsAdmin ? adminPassword : undefined
        })
      });
      setAmountCents("");
      setReason("");
      setNotes("");
      setOriginAccount("");
      setDestinationAccount("");
      setAdminPassword("");
      setMessage("Movimentação registrada.");
      refresh();
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar movimentação.");
    }
  }

  if (!cashSession) return <div className="panel grid gap-3 p-4"><h2 className="font-semibold">Movimentações</h2><p className="text-sm text-slate-500">Abra o caixa para registrar suprimentos, sangrias, despesas e ajustes.</p></div>;

  return <div className="grid gap-4">
    <div className="panel grid gap-2 p-4 md:grid-cols-4">
      <p><b>Caixa:</b> {cashSessionCode(cashSession)}</p>
      <p><b>Suprimentos/entradas:</b> {currency(summary?.cashIn ?? 0)}</p>
      <p><b>Saídas/despesas:</b> {currency(summary?.cashOut ?? 0)}</p>
      <p><b>Dinheiro esperado:</b> {currency(summary?.expectedCash ?? cashSession.openingAmount)}</p>
    </div>
    <div className="panel grid gap-3 p-4">
      <h2 className="font-semibold">Nova movimentação</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <select className="field" value={type} onChange={(event) => setType(event.target.value as CashMovementType)}>{Object.entries(cashMovementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <input className="field" placeholder="Valor" inputMode="numeric" value={formatCurrencyInput(amountCents)} onChange={(event) => setAmountCents(onlyDigits(event.target.value))} />
        <input className="field" placeholder="Motivo" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {(type === "TRANSFER_IN" || type === "TRANSFER_OUT") && <div className="grid gap-3 md:grid-cols-2"><input className="field" placeholder="Conta de origem" value={originAccount} onChange={(event) => setOriginAccount(event.target.value)} /><input className="field" placeholder="Conta de destino" value={destinationAccount} onChange={(event) => setDestinationAccount(event.target.value)} /></div>}
      <textarea className="field" placeholder="Observação" value={notes} onChange={(event) => setNotes(event.target.value)} />
      {needsAdmin && <input className="field" type="password" placeholder="Senha do administrador" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />}
      {message && <p className={`rounded-md px-3 py-2 text-sm ${message.includes("registrada") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message}</p>}
      <button className="btn btn-primary justify-self-start" type="button" onClick={saveMovement}>Registrar movimentação</button>
    </div>
    <DataCards items={(summary?.session.movements ?? []).map((movement) => ({
      title: cashMovementCode(movement),
      subtitle: `${cashMovementLabels[movement.type]} | ${currency(movement.amount)}`,
      meta: `${movement.reason}${movement.operatorName ? ` | Operador: ${movement.operatorName}` : ""} | ${dateTimeBR(movement.createdAt)}`,
      action: movement.notes ? <span className="text-sm text-slate-500">{movement.notes}</span> : undefined
    }))} />
  </div>;
}

function CashPreSales({ onReceive }: { onReceive: (sale: Sale) => void }) {
  const { data: services } = useData<Service[]>("/catalog/services");
  const { data: products } = useData<Product[]>("/catalog/products");
  const { data: preSales, refresh } = useData<PreSale[]>("/cash/pre-sales?status=OPEN");
  const [formOpen, setFormOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [searchTouched, setSearchTouched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [petId, setPetId] = useState("");
  const [items, setItems] = useState<SaleItemForm[]>([]);
  const [discountCents, setDiscountCents] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const activePets = selectedCustomer?.pets?.filter((pet) => pet.status === "ACTIVE") ?? [];
  const selectedPetId = petId || (activePets.length === 1 ? activePets[0].id : "");
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discount = Math.min(subtotal, decimalFromCents(discountCents));
  const total = Math.max(0, subtotal - discount);

  useEffect(() => {
    const searchTerm = customerQuery.trim();
    if (selectedCustomer || searchTerm.length < 2) {
      setCustomerResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api<Customer[]>(`/customers/search?q=${encodeURIComponent(searchTerm)}`)
        .then((results) => { if (active) setCustomerResults(results); })
        .catch(() => { if (active) setCustomerResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerQuery, selectedCustomer]);

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerQuery(`${customerCode(customer)} — ${customer.name}`);
    setCustomerResults([]);
    setSearchTouched(false);
    setPetId(customer.matchedPetId ?? "");
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setPetId("");
  }

  function addService(serviceId: string) {
    const service = services?.find((item) => item.id === serviceId);
    if (!service) return;
    setItems([...items, { itemType: "SERVICE", serviceId: service.id, description: service.name, quantity: 1, unitPrice: Number(service.price), code: serviceCode(service) }]);
  }

  function addProduct(productId: string) {
    const product = products?.find((item) => item.id === productId);
    if (!product) return;
    setItems([...items, { itemType: "PRODUCT", productId: product.id, description: product.name, quantity: 1, unitPrice: Number(product.salePrice), code: productCode(product) }]);
  }

  async function createPreSale() {
    setMessage("");
    if (!items.length) {
      setMessage("Adicione ao menos um produto ou serviço.");
      return;
    }
    try {
      await api("/cash/pre-sales", {
        method: "POST",
        body: JSON.stringify({
          customerId: selectedCustomer?.id,
          petId: selectedPetId || undefined,
          discount,
          expiresAt: expiresAt || undefined,
          notes,
          items: items.map((item) => ({ itemType: item.itemType, serviceId: item.serviceId, productId: item.productId, quantity: item.quantity }))
        })
      });
      setItems([]);
      setDiscountCents("");
      setExpiresAt("");
      setNotes("");
      clearCustomer();
      setFormOpen(false);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar pré-venda.");
    }
  }

  async function convertPreSale(preSale: PreSale) {
    setMessage("");
    try {
      const sale = await api<Sale>(`/cash/pre-sales/${preSale.id}/convert`, { method: "POST" });
      refresh();
      onReceive(sale);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao converter pré-venda.");
    }
  }

  async function cancelPreSale(preSale: PreSale) {
    setMessage("");
    try {
      await api(`/cash/pre-sales/${preSale.id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason: "Cancelada pelo caixa" }) });
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao cancelar pré-venda.");
    }
  }

  return <div className="grid gap-4">
    <div className="flex justify-end"><button className="btn btn-primary" onClick={() => setFormOpen(!formOpen)}><Plus size={16} />Nova pré-venda</button></div>
    {formOpen && <div className="panel grid gap-4 p-4">
      <label className="relative text-sm font-medium">Buscar cliente
        <div className="mt-1 flex gap-2"><input className="field min-h-11 flex-1" placeholder="Digite nome, pet, CPF, celular ou código" value={customerQuery} onFocus={() => setSearchTouched(true)} onChange={(event) => { setSelectedCustomer(null); setCustomerQuery(event.target.value); setSearchTouched(true); setPetId(""); }} />{selectedCustomer && <button className="btn btn-secondary" type="button" onClick={clearCustomer}>Consumidor final</button>}</div>
        {!selectedCustomer && searchTouched && customerQuery.trim().length >= 2 && <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {searching && <p className="p-3 text-sm text-slate-500">Buscando clientes...</p>}
          {!searching && customerResults.map((customer) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={customer.id} type="button" onClick={() => selectCustomer(customer)}>
            <b>{customerCode(customer)} — {customer.name}</b>
            {customer.matchedPetName && <p className="text-blue-700">Pet encontrado: {customer.matchedPetName}</p>}
            <p className="text-slate-600">CPF: {formatCpf(customer.cpf)} · Celular: {formatPhone(customer.phone)}</p>
            <p className="text-slate-600">Pets: {customer.pets.map((pet) => pet.name).join(", ") || "-"}</p>
          </button>)}
          {!searching && !customerResults.length && <div className="p-3 text-sm text-slate-500"><p>Nenhum cliente encontrado.</p><button className="btn btn-secondary mt-2" type="button" onClick={() => setMessage("Acesse Clientes para cadastrar um novo cliente antes da pré-venda.")}>+ Cadastrar novo cliente</button></div>}
        </div>}
      </label>
      {selectedCustomer && activePets.length > 1 && <label className="text-sm font-medium">Pet<select className="field mt-1" value={selectedPetId} onChange={(event) => setPetId(event.target.value)}><option value="">Selecione o pet</option>{activePets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></label>}
      {selectedCustomer && activePets.length === 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Este cliente ainda não possui pet cadastrado.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <select className="field" onChange={(event) => event.target.value && addService(event.target.value)} value=""><option value="">+ Serviço</option>{services?.map((service) => <option key={service.id} value={service.id}>{serviceCode(service)} - {service.name} - {currency(service.price)}</option>)}</select>
        <select className="field" onChange={(event) => event.target.value && addProduct(event.target.value)} value=""><option value="">+ Produto</option>{products?.map((product) => <option key={product.id} value={product.id}>{productCode(product)} - {product.name} - {currency(product.salePrice)}</option>)}</select>
      </div>
      <div className="grid gap-2">{items.map((item, index) => <div className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[1fr_80px_120px_120px_44px] md:items-center" key={`${item.description}-${index}`}><div><b>{item.code ? `${item.code} | ` : ""}{item.description}</b><p className="text-xs text-slate-500">{item.itemType === "SERVICE" ? "Serviço" : "Produto"}</p></div><input className="field" min="1" type="number" value={item.quantity} onChange={(event) => setItems(items.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: Math.max(1, Number(event.target.value || 1)) } : current))} /><span className="text-sm font-medium">{currency(item.unitPrice)}</span><b>{currency(item.quantity * item.unitPrice)}</b><button className="btn btn-secondary" type="button" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button></div>)}{!items.length && <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">Nenhum item adicionado.</p>}</div>
      <div className="grid gap-3 md:grid-cols-3"><input className="field" placeholder="Desconto" inputMode="numeric" value={formatCurrencyInput(discountCents)} onChange={(event) => setDiscountCents(onlyDigits(event.target.value))} /><input className="field" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><textarea className="field md:col-span-1" placeholder="Observação" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3"><p className="text-sm">Subtotal: <b>{currency(subtotal)}</b> · Total: <b>{currency(total)}</b></p><button className="btn btn-primary" type="button" onClick={createPreSale}>Salvar pré-venda</button></div>
      {message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
    </div>}
    <DataCards items={(preSales ?? []).map((preSale) => ({
      title: preSaleCode(preSale),
      subtitle: `${preSale.customer?.name ?? "Consumidor final"}${preSale.pet?.name ? ` | ${preSale.pet.name}` : ""}`,
      meta: `${preSale.items.map((item) => item.description).slice(0, 3).join(", ") || "Pré-venda"} | Total: ${currency(preSale.total)} | Criada em ${dateTimeBR(preSale.createdAt)}`,
      status: preSaleStatusLabels[preSale.status],
      action: <div className="flex flex-wrap gap-2"><button className="btn btn-primary" onClick={() => convertPreSale(preSale)}>Receber</button><button className="btn btn-secondary" onClick={() => cancelPreSale(preSale)}>Cancelar</button></div>
    }))} />
    {!preSales?.length && <p className="text-sm text-slate-500">Nenhuma pré-venda aberta.</p>}
    {!formOpen && message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
  </div>;
}

function CashSessionPanel({ cashSession, onRefresh }: { cashSession: CashSession | null; onRefresh: () => void }) {
  const [openingCents, setOpeningCents] = useState("0");
  const [notes, setNotes] = useState("");
  const [movement, setMovement] = useState<"CASH_IN" | "CASH_OUT" | null>(null);
  const [movementCents, setMovementCents] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movementNotes, setMovementNotes] = useState("");
  const [movementPassword, setMovementPassword] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [countedCents, setCountedCents] = useState("");
  const [differenceReason, setDifferenceReason] = useState("");
  const [closePassword, setClosePassword] = useState("");
  const [message, setMessage] = useState("");
  const { data: summary, refresh: refreshSummary } = useData<CashSummary>(cashSession ? `/cash/${cashSession.id}/summary` : "", [cashSession?.id]);
  const expectedCash = summary?.expectedCash ?? 0;
  const countedCash = decimalFromCents(countedCents);
  const difference = Number((countedCash - expectedCash).toFixed(2));

  async function openCash() {
    setMessage("");
    try {
      await api("/cash/open", { method: "POST", body: JSON.stringify({ openingAmount: decimalFromCents(openingCents), notes }) });
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao abrir caixa.");
    }
  }

  async function saveMovement() {
    if (!cashSession || !movement) return;
    setMessage("");
    try {
      await api(`/cash/${cashSession.id}/movements`, { method: "POST", body: JSON.stringify({ type: movement, amount: decimalFromCents(movementCents), reason: movementReason, notes: movementNotes, adminPassword: movement === "CASH_OUT" ? movementPassword : undefined }) });
      setMovement(null); setMovementCents(""); setMovementReason(""); setMovementNotes(""); setMovementPassword("");
      refreshSummary(); onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar movimentação.");
    }
  }

  async function closeCash() {
    if (!cashSession) return;
    setMessage("");
    try {
      await api(`/cash/${cashSession.id}/close`, { method: "POST", body: JSON.stringify({ countedCashAmount: countedCash, differenceReason, adminPassword: closePassword }) });
      setCloseOpen(false); onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao fechar caixa.");
    }
  }

  if (!cashSession) return <div className="panel grid gap-3 p-4"><h2 className="font-semibold">Abrir Caixa</h2><label className="text-sm font-medium">Valor inicial em dinheiro<input className="field mt-1" inputMode="numeric" value={formatCurrencyInput(openingCents)} onChange={(event) => setOpeningCents(onlyDigits(event.target.value))} /></label><label className="text-sm font-medium">Observação<textarea className="field mt-1" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}<button className="btn btn-primary justify-self-start" onClick={openCash}>Abrir Caixa</button></div>;

  return <div className="grid gap-4">
    <div className="panel grid gap-2 p-4 md:grid-cols-3"><p><b>Sessão:</b> {cashSessionCode(cashSession)}</p><p><b>Aberto desde:</b> {dateTimeBR(cashSession.openedAt)}</p><p><b>Operador:</b> {cashSession.openedByName ?? "-"}</p><p><b>Valor inicial:</b> {currency(cashSession.openingAmount)}</p><p><b>Sangrias:</b> {currency(summary?.cashOut ?? 0)}</p><p><b>Suprimentos:</b> {currency(summary?.cashIn ?? 0)}</p></div>
    <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => setMovement("CASH_OUT")}>Sangria</button><button className="btn btn-secondary" onClick={() => setMovement("CASH_IN")}>Suprimento</button><button className="btn btn-primary" onClick={() => setCloseOpen(true)}>Fechar Caixa</button></div>
    {movement && <div className="panel grid gap-3 p-4"><h3 className="font-semibold">{movement === "CASH_OUT" ? "Sangria" : "Suprimento"}</h3><input className="field" placeholder="Valor" value={formatCurrencyInput(movementCents)} onChange={(event) => setMovementCents(onlyDigits(event.target.value))} /><input className="field" placeholder="Motivo" value={movementReason} onChange={(event) => setMovementReason(event.target.value)} /><textarea className="field" placeholder="Observação" value={movementNotes} onChange={(event) => setMovementNotes(event.target.value)} />{movement === "CASH_OUT" && <input className="field" type="password" placeholder="Senha do administrador" value={movementPassword} onChange={(event) => setMovementPassword(event.target.value)} />}<button className="btn btn-primary justify-self-start" onClick={saveMovement}>Registrar</button></div>}
    {closeOpen && <div className="panel grid gap-3 p-4"><h3 className="font-semibold">Fechamento de Caixa</h3><div className="grid gap-2 text-sm md:grid-cols-3">{Object.entries(paymentMethodLabels).map(([method, label]) => <p key={method}><b>{label}:</b> {currency(summary?.totalsByMethod?.[method as PaymentMethod] ?? 0)}</p>)}<p><b>Pendentes:</b> {currency(summary?.pendingTotal ?? 0)}</p><p><b>Cancelados:</b> {currency(summary?.cancelledTotal ?? 0)}</p><p><b>Total recebido:</b> {currency(summary?.totalReceived ?? 0)}</p><p><b>Dinheiro esperado:</b> {currency(expectedCash)}</p></div><input className="field" placeholder="Valor contado em dinheiro" value={formatCurrencyInput(countedCents)} onChange={(event) => setCountedCents(onlyDigits(event.target.value))} /><p className="text-sm"><b>Diferença:</b> {currency(difference)} {difference > 0 ? "(sobra)" : difference < 0 ? "(falta)" : "(sem diferença)"}</p>{difference !== 0 && <textarea className="field" placeholder="Motivo obrigatório da diferença" value={differenceReason} onChange={(event) => setDifferenceReason(event.target.value)} />}<input className="field" type="password" placeholder="Senha do administrador" value={closePassword} onChange={(event) => setClosePassword(event.target.value)} /><button className="btn btn-primary justify-self-start" onClick={closeCash}>Fechar Caixa</button></div>}
    {message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
  </div>;
}

function cashPeriodRange(period: string, customFrom: string, customTo: string) {
  const today = localDateInput();
  const date = new Date(`${today}T00:00:00`);
  if (period === "yesterday") {
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const value = localDateInput(yesterday);
    return { from: value, to: value };
  }
  if (period === "week") {
    const from = new Date(date);
    from.setDate(from.getDate() - 7);
    return { from: localDateInput(from), to: today };
  }
  if (period === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (period === "custom") return { from: customFrom, to: customTo };
  return { from: today, to: today };
}

function CashSalesHistory() {
  const [period, setPeriod] = useState("today");
  const [customFrom, setCustomFrom] = useState(localDateInput());
  const [customTo, setCustomTo] = useState(localDateInput());
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [query, setQuery] = useState("");
  const [operator, setOperator] = useState("");
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const range = cashPeriodRange(period, customFrom, customTo);
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (status) params.set("status", status);
  if (paymentMethod) params.set("paymentMethod", paymentMethod);
  if (query.trim()) params.set("q", query.trim());
  if (operator.trim()) params.set("operator", operator.trim());
  const { data: sales, refresh } = useData<Sale[]>(`/sales?${params.toString()}`, [period, customFrom, customTo, status, paymentMethod, query, operator]);
  return <div className="grid gap-4">
    <div className="panel grid gap-3 p-3 md:grid-cols-4"><select className="field" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="week">Semana</option><option value="month">Mês</option><option value="custom">Personalizado</option></select>{period === "custom" && <><input className="field" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /><input className="field" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></>}<select className="field" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos os status</option>{Object.entries(saleStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="field" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Todas as formas</option>{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="field" placeholder="Cliente, pet ou código" value={query} onChange={(event) => setQuery(event.target.value)} /><input className="field" placeholder="Operador" value={operator} onChange={(event) => setOperator(event.target.value)} /></div>
    <DataCards items={(sales ?? []).map((sale) => ({ title: saleCode(sale), subtitle: `${dateTimeBR(sale.createdAt)} | ${sale.customer?.name ?? "Consumidor final"}${sale.pet?.name ? ` | ${sale.pet.name}` : ""}`, meta: `Total: ${currency(sale.total)} | ${sale.paymentMethod ? paymentMethodLabels[sale.paymentMethod] : "-"} | Operador: ${sale.operatorName ?? "-"}`, status: saleStatusLabels[sale.status], action: <button className="btn btn-secondary" onClick={() => setSelectedSale(sale)}>Visualizar</button> }))} />
    {selectedSale && <SaleReceiveModal sale={selectedSale} session={{ user: { name: selectedSale.operatorName ?? "-", role: "EMPLOYEE", email: "", id: "" }, company: { id: "", name: "" }, token: "" } as Session} cashSession={null} onClose={() => setSelectedSale(null)} onSaved={() => { setSelectedSale(null); refresh(); }} />}
  </div>;
}

function CashReports({ isAdmin }: { isAdmin: boolean }) {
  const [period, setPeriod] = useState("today");
  const [customFrom, setCustomFrom] = useState(localDateInput());
  const [customTo, setCustomTo] = useState(localDateInput());
  const range = cashPeriodRange(period, customFrom, customTo);
  const { data } = useData<CashReport>(isAdmin ? `/cash/reports/summary?from=${range.from}&to=${range.to}` : "", [isAdmin, period, customFrom, customTo]);
  const paymentDetails = data?.paymentDetails ?? [];
  const summaryCards = [
    { label: "PIX", value: data?.totalsByMethod?.PIX ?? 0 },
    { label: "Dinheiro", value: data?.totalsByMethod?.CASH ?? 0 },
    { label: "Cartão Débito", value: data?.totalsByMethod?.DEBIT ?? 0 },
    { label: "Cartão Crédito", value: data?.totalsByMethod?.CREDIT ?? 0 },
    { label: "Transferência", value: data?.totalsByMethod?.TRANSFER ?? 0 },
    { label: "Cancelados", value: data?.cancelledTotal ?? 0 },
    { label: "Desconto", value: data?.discountsTotal ?? 0 },
    { label: "Total", value: data?.totalReceived ?? 0 }
  ];
  if (!isAdmin) return <div className="panel p-4 text-sm text-slate-600">Relatórios são visíveis apenas para administradores.</div>;
  return <div className="grid gap-4">
    <div className="panel grid gap-3 p-3 md:grid-cols-3"><select className="field" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="week">Semana</option><option value="month">Mês</option><option value="custom">Personalizado</option></select>{period === "custom" && <><input className="field" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /><input className="field" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></>}</div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">{summaryCards.map((card) => <div className="panel min-w-0 p-4" key={card.label}><p className="text-sm font-medium text-slate-500">{card.label}</p><b className="mt-1 block whitespace-nowrap text-lg">{currency(card.value)}</b></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">{(["DEBIT", "CREDIT", "PIX", "CASH"] as PaymentMethod[]).map((method) => <PaymentReportGroup key={method} method={method} payments={paymentDetails.filter((payment) => payment.method === method)} />)}</div>
    <div className="grid gap-4 lg:grid-cols-2"><ReportList title="Vendas por operador" items={data?.byOperator ?? []} /><ReportList title="Vendas por serviço" items={data?.byService ?? []} /><ReportList title="Vendas por produto" items={data?.byProduct ?? []} /><ReportList title="Horários das vendas" items={(data?.byHour ?? []).map((item) => ({ name: `${item.hour}h`, total: item.total }))} /></div>
  </div>;
}

function PaymentReportGroup({ method, payments }: { method: PaymentMethod; payments: CashPaymentDetail[] }) {
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  return <section className="panel overflow-hidden">
    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-3"><div><h3 className="font-semibold">{paymentMethodLabels[method]}</h3><p className="text-xs text-slate-500">{payments.length} transação(ões)</p></div><b>{currency(total)}</b></div>
    <div className="divide-y divide-slate-100">
      {payments.map((payment) => <div className="grid gap-1 p-3 text-sm" key={payment.id}>
        <div className="flex flex-wrap justify-between gap-2"><b>{dateTimeBR(payment.paidAt)} · PD-{String(payment.saleCode ?? 0).padStart(5, "0")}</b><b>{currency(payment.amount)}</b></div>
        <p>Comprovante: {payment.receiptCode ? `CV-${String(payment.receiptCode).padStart(6, "0")}` : "-"}</p>
        <p>{payment.customerName}{payment.petName ? ` · ${payment.petName}` : ""} · Operador: {payment.operatorName}</p>
        {(method === "DEBIT" || method === "CREDIT") && <p>{payment.cardBrand ?? "Sem bandeira"}{method === "CREDIT" ? ` · ${payment.installments ?? 0}x` : ""} · NSU {payment.cardNsu ?? "-"}</p>}
        {method === "PIX" && <p>Comprovante: {payment.pixReference ?? payment.cardNsu ?? "-"}</p>}
        {method === "CASH" && <p>Venda: {currency(payment.amount)} · Recebido: {currency(payment.cashReceived ?? payment.amount)} · Troco: {currency(payment.changeAmount ?? 0)}</p>}
      </div>)}
      {!payments.length && <p className="p-3 text-sm text-slate-500">Nenhum recebimento no período.</p>}
    </div>
  </section>;
}

function ReportList({ title, items }: { title: string; items: { name: string; total: number }[] }) {
  return <div className="panel p-4"><h3 className="mb-3 font-semibold">{title}</h3><div className="grid gap-2 text-sm">{items.slice(0, 8).map((item) => <div className="flex justify-between gap-3" key={item.name}><span>{item.name}</span><b>{currency(item.total)}</b></div>)}{!items.length && <p className="text-slate-500">Sem dados no período.</p>}</div></div>;
}

function SaleReceiveModal({ sale, session, cashSession, onClose, onSaved }: { sale?: Sale; session: Session; cashSession: CashSession | null; onClose: () => void; onSaved: () => void }) {
  const { data: services } = useData<Service[]>("/catalog/services");
  const { data: products } = useData<Product[]>("/catalog/products");
  const { data: financialMethods } = useData<FinancialPaymentMethod[]>("/financial/payment-methods/active");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(sale?.customer ?? null);
  const [customerQuery, setCustomerQuery] = useState(sale?.customer ? `${customerCode(sale.customer)} — ${sale.customer.name}` : "");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [searchTouched, setSearchTouched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [petId, setPetId] = useState(sale?.pet?.id ?? "");
  const [items, setItems] = useState<SaleItemForm[]>(() => sale?.items.map((item) => ({ itemType: item.itemType, serviceId: item.serviceId ?? item.service?.id, productId: item.productId ?? item.product?.id, description: item.description, quantity: item.quantity, unitPrice: Number(item.unitPrice), code: item.product ? productCode(item.product) : item.service ? serviceCode(item.service) : undefined })) ?? []);
  const [discountType, setDiscountType] = useState<"VALUE" | "PERCENT">(sale?.discountType ?? "VALUE");
  const [discountCents, setDiscountCents] = useState(centsFromCurrency(sale?.discount ?? 0));
  const [discountPercent, setDiscountPercent] = useState(sale?.discountPercent ? String(sale.discountPercent) : "");
  const [paymentRows, setPaymentRows] = useState<PaymentForm[]>(() => sale?.payments?.length
    ? sale.payments.map((payment) => ({
      method: payment.method,
      amountCents: centsFromCurrency(payment.amount),
      cardBrand: payment.cardBrand ?? "",
      cardNsu: payment.cardNsu ?? "",
      cardAuthorization: payment.cardAuthorization ?? "",
      installments: payment.installments ? String(payment.installments) : ""
    }))
    : [{ method: sale?.paymentMethod ?? "PIX", amountCents: sale?.status === "PAID" ? centsFromCurrency(sale.total) : "", cardBrand: sale?.cardBrand ?? "", cardNsu: sale?.cardNsu ?? "", cardAuthorization: sale?.cardAuthorization ?? "", installments: "" }]);
  const [pendingOpen, setPendingOpen] = useState(sale?.status === "PENDING" || sale?.status === "PARTIALLY_PAID");
  const [pendingReason, setPendingReason] = useState(sale?.pendingReason ?? "PIX_LATER");
  const [pendingNotes, setPendingNotes] = useState(sale?.pendingNotes ?? "");
  const [adminPassword, setAdminPassword] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPassword, setCancelPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const checkoutIdempotencyKey = useRef<string | null>(null);
  const activePets = selectedCustomer?.pets?.filter((pet) => pet.status === "ACTIVE") ?? [];
  const selectedPetId = petId || (activePets.length === 1 ? activePets[0].id : "");
  const membership = selectedCustomer?.memberships?.find((membershipItem) => membershipItem.pet.id === selectedPetId && membershipItem.status === "ACTIVE" && membershipItem.remainingUses > 0 && new Date(membershipItem.endDate) >= new Date());
  const canEditItems = !sale || sale.status === "WAITING_PAYMENT";
  const readOnly = sale?.status === "PAID" || sale?.status === "CANCELLED";
  const appointmentSaleLocked = isFinalizedAppointmentSale(sale);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountValue = discountType === "PERCENT" ? subtotal * Math.min(Number(discountPercent || 0), 100) / 100 : decimalFromCents(discountCents);
  const safeDiscount = Math.min(subtotal, Math.max(0, discountValue));
  const total = Math.max(0, subtotal - safeDiscount);
  const highDiscount = subtotal > 0 && safeDiscount / subtotal > 0.1;
  const paidEntered = Math.min(total, paymentRows.reduce((sum, payment) => sum + decimalFromCents(payment.amountCents), 0));
  const pendingPreview = Number(Math.max(0, total - paidEntered).toFixed(2));
  const primaryPaymentMethod = paymentRows[0]?.method ?? "PIX";
  useEffect(() => {
    if (!financialMethods?.length) return;
    const methodMap: Record<FinancialPaymentMethod["type"], PaymentMethod> = { CASH: "CASH", PIX: "PIX", DEBIT_CARD: "DEBIT", CREDIT_CARD: "CREDIT", BANK_TRANSFER: "TRANSFER", OTHER: "OTHER" };
    setPaymentRows((current) => current.map((row) => {
      if (row.financialPaymentMethodId) return row;
      const configured = financialMethods.find((method) => methodMap[method.type] === row.method);
      return configured ? { ...row, financialPaymentMethodId: configured.id } : row;
    }));
  }, [financialMethods]);

  useEffect(() => {
    const searchTerm = customerQuery.trim();
    if (selectedCustomer || searchTerm.length < 2) {
      setCustomerResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api<Customer[]>(`/customers/search?q=${encodeURIComponent(searchTerm)}`)
        .then((results) => { if (active) setCustomerResults(results); })
        .catch(() => { if (active) setCustomerResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerQuery, selectedCustomer]);

  useEffect(() => {
    if (!selectedCustomer || sale?.pet?.id) return;
    const matchedPet = activePets.find((pet) => pet.id === selectedCustomer.matchedPetId);
    if (matchedPet) setPetId(matchedPet.id);
    else if (activePets.length === 1) setPetId(activePets[0].id);
  }, [selectedCustomer?.id]);

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerQuery(`${customerCode(customer)} — ${customer.name}`);
    setCustomerResults([]);
    setSearchTouched(false);
    setPetId(customer.matchedPetId ?? "");
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setPetId("");
  }

  function addService(serviceId: string) {
    const service = services?.find((item) => item.id === serviceId);
    if (!service) return;
    setItems([...items, { itemType: "SERVICE", serviceId: service.id, description: service.name, quantity: 1, unitPrice: Number(service.price), code: serviceCode(service) }]);
  }

  function addProduct(productId: string) {
    const product = products?.find((item) => item.id === productId);
    if (!product) return;
    setItems([...items, { itemType: "PRODUCT", productId: product.id, description: product.name, quantity: 1, unitPrice: Number(product.salePrice), code: productCode(product) }]);
  }

  function updatePaymentRow(index: number, patch: Partial<PaymentForm>) {
    setPaymentRows(paymentRows.map((payment, paymentIndex) => paymentIndex === index ? { ...payment, ...patch } : payment));
  }

  function addPaymentRow() {
    const configured = financialMethods?.[0];
    const methodMap: Record<FinancialPaymentMethod["type"], PaymentMethod> = { CASH: "CASH", PIX: "PIX", DEBIT_CARD: "DEBIT", CREDIT_CARD: "CREDIT", BANK_TRANSFER: "TRANSFER", OTHER: "OTHER" };
    setPaymentRows([...paymentRows, { method: configured ? methodMap[configured.type] : "PIX", financialPaymentMethodId: configured?.id, amountCents: "", cardBrand: "", cardNsu: "", cardAuthorization: "", installments: "" }]);
  }

  function removePaymentRow(index: number) {
    setPaymentRows(paymentRows.filter((_, paymentIndex) => paymentIndex !== index));
  }

  function normalizedPayments(status: "PAID" | "PARTIALLY_PAID" | "PENDING") {
    const payments = paymentRows
      .map((payment) => ({ ...payment, amount: decimalFromCents(payment.amountCents) }))
      .filter((payment) => payment.amount > 0);
    if (status === "PAID" && !payments.length) {
      const first = paymentRows[0] ?? { method: "PIX", amountCents: "", cardBrand: "", cardNsu: "", cardAuthorization: "", installments: "" };
      return [{ ...first, amount: total }];
    }
    return payments;
  }

  async function saveSale(status: "PAID" | "PARTIALLY_PAID" | "PENDING") {
    if (saving) return;
    setMessage("");
    if (!items.length) {
      setMessage("Adicione ao menos um produto ou serviço.");
      return;
    }
    if (!cashSession) {
      setMessage("Abra o caixa antes de finalizar vendas.");
      return;
    }
    if (status !== "PAID" && (!pendingReason || !pendingNotes.trim())) {
      setMessage("Informe o motivo e a observação do pagamento pendente.");
      return;
    }
    if (highDiscount && canEditItems && !adminPassword) {
      setMessage("Desconto acima de 10% exige senha do administrador.");
      return;
    }
    const invalidCard = paymentRows.find((payment) =>
      (payment.method === "DEBIT" || payment.method === "CREDIT") &&
      (!payment.cardBrand.trim() || !payment.cardNsu.trim() || (payment.method === "CREDIT" && Number(payment.installments || 0) < 1))
    );
    if (invalidCard) {
      if (!invalidCard.cardBrand.trim()) setMessage("Selecione a bandeira do cartão.");
      else if (!invalidCard.cardNsu.trim()) setMessage("Informe a NSU do cartão para concluir o pagamento.");
      else setMessage("Selecione a quantidade de parcelas.");
      return;
    }
    try {
      setSaving(true);
      checkoutIdempotencyKey.current ??= crypto.randomUUID();
      const payments = normalizedPayments(status);
      const body = {
        customerId: selectedCustomer?.id,
        petId: selectedPetId || undefined,
        status,
        paymentMethod: payments[0]?.method,
        payments: payments.map((payment) => ({
          method: payment.method,
          financialPaymentMethodId: payment.financialPaymentMethodId,
          amount: payment.amount,
          cardBrand: payment.method === "DEBIT" || payment.method === "CREDIT" ? payment.cardBrand : undefined,
          cardNsu: payment.method === "DEBIT" || payment.method === "CREDIT" ? payment.cardNsu : undefined,
          cardAuthorization: payment.method === "DEBIT" || payment.method === "CREDIT" ? payment.cardAuthorization : undefined,
          installments: payment.installments ? Number(payment.installments) : undefined
        })),
        discountType,
        discount: discountType === "PERCENT" ? Number(discountPercent || 0) : decimalFromCents(discountCents),
        pendingReason: status !== "PAID" ? pendingReason : undefined,
        pendingNotes: status !== "PAID" ? pendingNotes : undefined,
        adminPassword: highDiscount && canEditItems ? adminPassword : undefined,
        membershipId: membership?.id,
        items: items.map(normalizeSaleItemPayload)
      };
      await api(sale?.id ? `/sales/${sale.id}/checkout` : "/sales", {
        method: sale?.id ? "PATCH" : "POST",
        headers: { "Idempotency-Key": checkoutIdempotencyKey.current },
        body: JSON.stringify(body)
      });
      checkoutIdempotencyKey.current = null;
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir esta operação. Verifique os dados do pedido e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelSale() {
    setMessage("");
    if (!sale) return;
    if (!cancelReason.trim() || !cancelPassword) {
      setMessage("Informe motivo e senha do administrador para cancelar.");
      return;
    }
    try {
      await api(`/sales/${sale.id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason: cancelReason, adminPassword: cancelPassword }) });
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao cancelar venda.");
    }
  }

  const title = sale ? `Receber venda ${saleCode(sale)}` : "Nova venda";
  return <Modal title={title} onClose={onClose}><div className="grid gap-4">
    <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-2">
      <p><b>Cliente:</b> {selectedCustomer ? `${customerCode(selectedCustomer)} - ${selectedCustomer.name}` : "Consumidor final"}</p>
      <p><b>Pet:</b> {sale?.pet?.name ?? activePets.find((pet) => pet.id === selectedPetId)?.name ?? "-"}</p>
      <p><b>Origem:</b> {sale ? saleOriginLabels[sale.origin] : "Venda direta"}</p>
      <p><b>Operador:</b> {sale?.operatorName ?? session.user.name}</p>
      <p><b>Data/hora:</b> {sale ? dateTimeBR(sale.createdAt) : dateTimeBR(new Date().toISOString())}</p>
      <p><b>Status:</b> {sale ? saleStatusLabels[sale.status] : "Nova venda"}</p>
    </div>
    {appointmentSaleLocked && <p className="flex items-center gap-2 text-xs font-medium text-slate-500"><Lock size={14} /> Cliente e pet vinculados ao atendimento finalizado.</p>}

    {!appointmentSaleLocked && !readOnly && <label className="relative text-sm font-medium">Buscar cliente
      <div className="mt-1 flex gap-2">
        <input className="field min-h-11 flex-1" placeholder="Digite nome, pet, CPF, celular ou código" value={customerQuery} onFocus={() => setSearchTouched(true)} onChange={(event) => { setSelectedCustomer(null); setCustomerQuery(event.target.value); setSearchTouched(true); setPetId(""); }} />
        {selectedCustomer && <button className="btn btn-secondary" type="button" onClick={clearCustomer}>Consumidor final</button>}
      </div>
      {!selectedCustomer && searchTouched && customerQuery.trim().length >= 2 && <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
        {searching && <p className="p-3 text-sm text-slate-500">Buscando clientes...</p>}
        {!searching && customerResults.map((customer) => <button className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" key={customer.id} type="button" onClick={() => selectCustomer(customer)}>
          <b>{customerCode(customer)} — {customer.name}</b>
          {customer.matchedPetName && <p className="text-blue-700">Pet encontrado: {customer.matchedPetName}</p>}
          <p className="text-slate-600">CPF: {formatCpf(customer.cpf)} · Celular: {formatPhone(customer.phone)}</p>
          <p className="text-slate-600">Pets: {customer.pets.map((pet) => pet.name).join(", ") || "-"}</p>
        </button>)}
        {!searching && !customerResults.length && <p className="p-3 text-sm text-slate-500">Nenhum cliente encontrado. A venda pode seguir como Consumidor final.</p>}
      </div>}
    </label>}

    {selectedCustomer && activePets.length > 1 && !appointmentSaleLocked && !readOnly && <label className="text-sm font-medium">Pet<select className="field mt-1" value={selectedPetId} onChange={(event) => setPetId(event.target.value)}><option value="">Selecione o pet</option>{activePets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></label>}
    {selectedCustomer && activePets.length === 0 && !readOnly && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Este cliente ainda não possui pet cadastrado. Use Consumidor final ou cadastre um pet antes.</p>}
    {membership && <PackageCard membership={membership} />}

    {canEditItems && <div className="panel grid gap-3 p-3 md:grid-cols-2">
      <select className="field" onChange={(event) => event.target.value && addService(event.target.value)} value=""><option value="">+ Serviço</option>{services?.map((service) => <option key={service.id} value={service.id}>{serviceCode(service)} - {service.name} - {currency(service.price)}</option>)}</select>
      <select className="field" onChange={(event) => event.target.value && addProduct(event.target.value)} value=""><option value="">+ Produto</option>{products?.map((product) => <option key={product.id} value={product.id}>{productCode(product)} - {product.name} - {currency(product.salePrice)}</option>)}</select>
    </div>}

    <div className="grid gap-2">
      <div className="hidden rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 md:grid md:grid-cols-[1fr_80px_120px_120px_44px]"><span>Item</span><span>Qtd</span><span>Unitário</span><span>Total</span><span /></div>
      {items.map((item, index) => <div className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[1fr_80px_120px_120px_44px] md:items-center" key={`${item.description}-${index}`}>
        <div><b>{item.code ? `${item.code} | ` : ""}{item.description}</b><p className="text-xs text-slate-500">{item.itemType === "SERVICE" ? "Serviço" : "Produto"}</p></div>
        <input className="field" disabled={!canEditItems} min="1" type="number" value={item.quantity} onChange={(event) => setItems(items.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: Math.max(1, Number(event.target.value || 1)) } : current))} />
        <span className="text-sm font-medium">{currency(item.unitPrice)}</span>
        <b>{currency(item.quantity * item.unitPrice)}</b>
        {canEditItems && <button className="btn btn-secondary" type="button" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button>}
      </div>)}
      {!items.length && <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">Nenhum item adicionado.</p>}
    </div>

    <div className="panel grid gap-3 p-4">
      <div className="flex justify-between text-sm"><span>Subtotal</span><b>{currency(subtotal)}</b></div>
      <div className="grid gap-3 md:grid-cols-[160px_1fr]">
        <select className="field" disabled={!canEditItems} value={discountType} onChange={(event) => setDiscountType(event.target.value as "VALUE" | "PERCENT")}><option value="VALUE">Desconto R$</option><option value="PERCENT">Desconto %</option></select>
        {discountType === "VALUE" ? <input className="field" disabled={!canEditItems} inputMode="numeric" value={formatCurrencyInput(discountCents)} onChange={(event) => setDiscountCents(onlyDigits(event.target.value))} /> : <input className="field" disabled={!canEditItems} type="number" min="0" max="100" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} />}
      </div>
      {highDiscount && canEditItems && <label className="text-sm font-medium">Senha do administrador para desconto acima de 10%<input className="field mt-1" type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></label>}
      <div className="flex justify-between border-t border-slate-200 pt-3"><span>Total</span><b className="text-xl">{currency(total)}</b></div>
      {!readOnly && <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Pagamentos</h3><button className="btn btn-secondary" type="button" onClick={addPaymentRow}><Plus size={16} />Adicionar forma</button></div>
        {paymentRows.map((payment, index) => <div className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[160px_160px_1fr_44px]" key={index}>
          <select className="field" value={payment.financialPaymentMethodId ?? `legacy:${payment.method}`} onChange={(event) => {
            const configured = financialMethods?.find((method) => method.id === event.target.value);
            const methodMap: Record<FinancialPaymentMethod["type"], PaymentMethod> = { CASH: "CASH", PIX: "PIX", DEBIT_CARD: "DEBIT", CREDIT_CARD: "CREDIT", BANK_TRANSFER: "TRANSFER", OTHER: "OTHER" };
            updatePaymentRow(index, configured ? { financialPaymentMethodId: configured.id, method: methodMap[configured.type], cardBrand: "", installments: "" } : { financialPaymentMethodId: undefined, method: event.target.value.replace("legacy:", "") as PaymentMethod });
          }}>{financialMethods?.length ? financialMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>) : Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={`legacy:${value}`}>{label}</option>)}</select>
          <input className="field" placeholder="Valor" inputMode="numeric" value={formatCurrencyInput(payment.amountCents)} onChange={(event) => updatePaymentRow(index, { amountCents: onlyDigits(event.target.value) })} />
          {(payment.method === "DEBIT" || payment.method === "CREDIT") ? <div className="grid gap-2 md:grid-cols-3"><input className="field" placeholder="Bandeira" value={payment.cardBrand} onChange={(event) => updatePaymentRow(index, { cardBrand: event.target.value })} /><input className="field" placeholder="NSU" value={payment.cardNsu} onChange={(event) => updatePaymentRow(index, { cardNsu: event.target.value })} /><input className="field" placeholder="Parcelas" inputMode="numeric" value={payment.installments} onChange={(event) => updatePaymentRow(index, { installments: onlyDigits(event.target.value, 2) })} /></div> : <p className="self-center text-xs text-slate-500">Use mais de uma linha para pagamento misto.</p>}
          <button className="btn btn-secondary" type="button" disabled={paymentRows.length === 1} onClick={() => removePaymentRow(index)}><Trash2 size={16} /></button>
        </div>)}
        <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm md:grid-cols-3"><p><b>Pago informado:</b> {currency(paidEntered)}</p><p><b>Saldo pendente:</b> {currency(pendingPreview)}</p><p><b>Forma principal:</b> {paymentMethodLabels[primaryPaymentMethod]}</p></div>
      </div>}
    </div>

    {pendingOpen && !readOnly && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <h3 className="mb-2 font-semibold text-amber-900">Registrar pagamento para depois</h3>
      <div className="grid gap-3"><select className="field" value={pendingReason} onChange={(event) => setPendingReason(event.target.value)}>{Object.entries(pendingReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea className="field" required placeholder="Observação obrigatória" value={pendingNotes} onChange={(event) => setPendingNotes(event.target.value)} /></div>
    </div>}

    {cancelOpen && sale && <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <h3 className="mb-2 font-semibold text-red-900">Cancelar venda</h3>
      <div className="grid gap-3"><textarea className="field" placeholder="Motivo obrigatório" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /><input className="field" type="password" placeholder="Senha do administrador" value={cancelPassword} onChange={(event) => setCancelPassword(event.target.value)} /><button className="btn btn-primary justify-self-start" type="button" onClick={cancelSale}>Confirmar cancelamento</button></div>
    </div>}

    {message && <p className={`rounded-md px-3 py-2 text-sm ${message.includes("Falha") || message.includes("exige") || message.includes("Informe") || message.includes("insuficiente") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{message}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button className="btn btn-secondary" type="button" onClick={onClose}>Fechar</button>
      {sale?.id && sale.status !== "CANCELLED" && <button className="btn btn-secondary" type="button" onClick={() => setCancelOpen(!cancelOpen)}>Cancelar venda</button>}
      {!readOnly && <button className="btn btn-secondary" disabled={saving} type="button" onClick={() => pendingOpen ? saveSale(paidEntered > 0 ? "PARTIALLY_PAID" : "PENDING") : setPendingOpen(true)}>{pendingOpen ? "Confirmar pagamento para depois" : "Pagar depois"}</button>}
      {!readOnly && <button className="btn btn-primary" disabled={saving} type="button" onClick={() => saveSale("PAID")}>{saving ? "Processando..." : <>Finalizar venda{primaryPaymentMethod === "PIX" ? " no PIX" : ""}</>}</button>}
    </div>
  </div></Modal>;
}

function PackageCard({ membership }: { membership: Membership }) {
  const vencido = new Date(membership.endDate) < new Date();
  const semSaldo = membership.remainingUses <= 0;
  const status = semSaldo ? "Sem saldo" : vencido ? "Vencido" : membership.status === "ACTIVE" ? "Ativo" : membership.status;
  return <div className={`rounded-md border p-3 text-sm ${semSaldo || vencido ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><b>Pacote: {membership.plan.name}</b><p>Serviço: {membership.plan.service?.name}</p><p>Saldo restante: {membership.remainingUses} de {membership.totalUses} usos</p><p>Usado: {membership.usedUses} | Vencimento: {dateBR(membership.endDate)}</p><p>Status: {status}</p>{semSaldo && <p className="mt-2 font-medium">Pacote sem saldo. É necessário renovar antes de usar como pacote.</p>}</div>;
}

function InfoGrid({ fields }: { fields: (string | undefined | null)[][] }) {
  return <div className="grid gap-2 text-sm md:grid-cols-2">{fields.map(([label, value]) => <p key={String(label)}><b>{label}:</b> {value || "-"}</p>)}</div>;
}

const financialAccountTypeLabels: Record<FinancialAccount["type"], string> = { CASH_DRAWER: "Caixa físico", CHECKING_ACCOUNT: "Conta corrente", SAVINGS_ACCOUNT: "Conta poupança", DIGITAL_ACCOUNT: "Conta digital", PAYMENT_WALLET: "Carteira de pagamento", OTHER: "Outros" };
const financialPaymentTypeLabels: Record<FinancialPaymentMethod["type"], string> = { CASH: "Dinheiro", PIX: "PIX", DEBIT_CARD: "Cartão de débito", CREDIT_CARD: "Cartão de crédito", BANK_TRANSFER: "Transferência", OTHER: "Outro" };

function FinancialModule({ sectionPage }: { sectionPage: string }) {
  const { data: accounts, refresh: refreshAccounts } = useData<FinancialAccount[]>("/financial/accounts");
  const { data: methods, refresh: refreshMethods } = useData<FinancialPaymentMethod[]>("/financial/payment-methods");
  const [accountOpen, setAccountOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [ruleMethod, setRuleMethod] = useState<FinancialPaymentMethod | null>(null);
  if (sectionPage === "financial:accounts") return <Page title="Contas financeiras" action={<button className="btn btn-primary" onClick={() => setAccountOpen(true)}><Plus size={16} />Nova conta</button>}>
    <DataCards items={(accounts ?? []).map((account) => ({ title: account.name, subtitle: `${financialAccountTypeLabels[account.type]}${account.institutionName ? ` · ${account.institutionName}` : ""}`, meta: `Saldo inicial: ${currency(account.openingBalance)} | Saldo calculado: ${currency(account.calculatedBalance ?? account.openingBalance)}${account.isPrimary ? " | Conta principal" : ""}`, status: account.active ? "Ativa" : "Inativa", action: account.active ? <button className="btn btn-secondary" onClick={async () => { await api(`/financial/accounts/${account.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) }); refreshAccounts(); }}>Inativar</button> : undefined }))} />
    {accountOpen && <FinancialAccountModal onClose={() => setAccountOpen(false)} onSaved={() => { setAccountOpen(false); refreshAccounts(); }} />}
  </Page>;
  if (sectionPage === "financial:methods") return <Page title="Formas de recebimento" action={<button className="btn btn-primary" disabled={!accounts?.some((account) => account.active)} onClick={() => setMethodOpen(true)}><Plus size={16} />Nova forma</button>}>
    {!accounts?.some((account) => account.active) && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Cadastre uma conta financeira ativa antes de criar formas de recebimento.</p>}
    <DataCards items={(methods ?? []).map((method) => ({ title: method.name, subtitle: `${financialPaymentTypeLabels[method.type]} · ${method.institutionName ?? "Sem instituição"} · Destino: ${method.destinationAccount.name}`, meta: `Taxa padrão: ${Number(method.defaultFeePercentage).toLocaleString("pt-BR")}% + ${currency(method.fixedFee)} | Prazo: ${method.settlementDays} dia(s) | ${method.feeRules.length} regra(s) vigente(s)`, status: method.active ? "Ativa" : "Inativa", action: <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => setRuleMethod(method)}>Nova regra de taxa</button>{method.active && <button className="btn btn-secondary" onClick={async () => { await api(`/financial/payment-methods/${method.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) }); refreshMethods(); }}>Inativar</button>}</div> }))} />
    {methodOpen && <FinancialMethodModal accounts={(accounts ?? []).filter((account) => account.active)} onClose={() => setMethodOpen(false)} onSaved={() => { setMethodOpen(false); refreshMethods(); }} />}
    {ruleMethod && <FinancialFeeRuleModal method={ruleMethod} onClose={() => setRuleMethod(null)} onSaved={() => { setRuleMethod(null); refreshMethods(); }} />}
  </Page>;
  if (sectionPage !== "financial") return <Page title="Financeiro"><div className="panel p-6"><h2 className="font-semibold">Disponível nas próximas fases</h2><p className="mt-2 text-sm text-slate-600">Esta área será ativada incrementalmente após a validação das contas, formas de recebimento, taxas e snapshots da Fase 1.</p></div></Page>;
  return <Page title="Financeiro — Visão geral"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="panel p-4"><p className="text-sm text-slate-500">Contas financeiras</p><b className="text-2xl">{accounts?.length ?? 0}</b></div><div className="panel p-4"><p className="text-sm text-slate-500">Formas ativas</p><b className="text-2xl">{methods?.filter((method) => method.active).length ?? 0}</b></div><div className="panel p-4"><p className="text-sm text-slate-500">Regras de taxa</p><b className="text-2xl">{methods?.reduce((sum, method) => sum + method.feeRules.length, 0) ?? 0}</b></div></div></Page>;
}

function FinancialAccountModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", type: "CASH_DRAWER", institutionName: "", agency: "", accountNumber: "", internalIdentifier: "", openingBalance: "0", openingBalanceDate: localDateInput(), isPrimary: false, active: true, notes: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { await api("/financial/accounts", { method: "POST", body: JSON.stringify({ ...form, openingBalance: Number(form.openingBalance.replace(",", ".")) }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar a conta."); } finally { setSaving(false); } }
  return <Modal title="Nova conta financeira" onClose={onClose}><form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}><input className="field" required placeholder="Nome da conta" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(financialAccountTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{form.type !== "CASH_DRAWER" && <><input className="field" placeholder="Instituição ou banco" value={form.institutionName} onChange={(e) => setForm({ ...form, institutionName: e.target.value })} /><input className="field" placeholder="Agência (opcional)" value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} /><input className="field" placeholder="Número da conta (opcional)" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} /></>}<input className="field" placeholder="Identificação interna" value={form.internalIdentifier} onChange={(e) => setForm({ ...form, internalIdentifier: e.target.value })} /><input className="field" inputMode="decimal" placeholder="Saldo inicial" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} /><input className="field" type="date" value={form.openingBalanceDate} onChange={(e) => setForm({ ...form, openingBalanceDate: e.target.value })} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />Conta principal</label><textarea className="field sm:col-span-2" placeholder="Observações" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />{error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}<button className="btn btn-primary justify-self-end sm:col-span-2" disabled={saving}>{saving ? "Salvando..." : "Salvar conta"}</button></form></Modal>;
}

function FinancialMethodModal({ accounts, onClose, onSaved }: { accounts: FinancialAccount[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", type: "PIX", institutionName: "", destinationAccountId: accounts[0]?.id ?? "", defaultFeePercentage: "0", fixedFee: "0", settlementDays: "0", settlementDayType: "CALENDAR", maxInstallments: "1", requiresNsu: false, requiresReceiptCode: false, active: true, notes: "", brands: "Visa, Mastercard, Elo" });
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); setError(""); try { await api("/financial/payment-methods", { method: "POST", body: JSON.stringify({ ...form, defaultFeePercentage: Number(form.defaultFeePercentage.replace(",", ".")), fixedFee: Number(form.fixedFee.replace(",", ".")), settlementDays: Number(form.settlementDays), maxInstallments: Number(form.maxInstallments), brands: ["DEBIT_CARD", "CREDIT_CARD"].includes(form.type) ? form.brands.split(",").map((item) => item.trim()).filter(Boolean) : [] }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar a forma."); } }
  return <Modal title="Nova forma de recebimento" onClose={onClose}><form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}><input className="field" required placeholder="Nome de identificação" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, requiresNsu: ["DEBIT_CARD", "CREDIT_CARD"].includes(e.target.value) })}>{Object.entries(financialPaymentTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input className="field" placeholder="Instituição/maquininha" value={form.institutionName} onChange={(e) => setForm({ ...form, institutionName: e.target.value })} /><select className="field" required value={form.destinationAccountId} onChange={(e) => setForm({ ...form, destinationAccountId: e.target.value })}>{accounts.filter((account) => form.type !== "CASH" || account.type === "CASH_DRAWER").map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select>{form.type !== "CASH" && <><input className="field" inputMode="decimal" placeholder="Taxa percentual" value={form.defaultFeePercentage} onChange={(e) => setForm({ ...form, defaultFeePercentage: e.target.value })} /><input className="field" inputMode="decimal" placeholder="Taxa fixa" value={form.fixedFee} onChange={(e) => setForm({ ...form, fixedFee: e.target.value })} /><input className="field" inputMode="numeric" placeholder="Prazo em dias" value={form.settlementDays} onChange={(e) => setForm({ ...form, settlementDays: onlyDigits(e.target.value) })} /><select className="field" value={form.settlementDayType} onChange={(e) => setForm({ ...form, settlementDayType: e.target.value })}><option value="CALENDAR">Dias corridos</option><option value="BUSINESS">Dias úteis</option></select></>}{form.type === "CREDIT_CARD" && <input className="field" inputMode="numeric" placeholder="Máximo de parcelas" value={form.maxInstallments} onChange={(e) => setForm({ ...form, maxInstallments: onlyDigits(e.target.value, 2) })} />}{["DEBIT_CARD", "CREDIT_CARD"].includes(form.type) && <input className="field" placeholder="Bandeiras separadas por vírgula" value={form.brands} onChange={(e) => setForm({ ...form, brands: e.target.value })} />}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresNsu} onChange={(e) => setForm({ ...form, requiresNsu: e.target.checked })} />NSU obrigatória</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresReceiptCode} onChange={(e) => setForm({ ...form, requiresReceiptCode: e.target.checked })} />Comprovante obrigatório</label>{error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}<button className="btn btn-primary justify-self-end sm:col-span-2">Salvar forma</button></form></Modal>;
}

function FinancialFeeRuleModal({ method, onClose, onSaved }: { method: FinancialPaymentMethod; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ installments: "1", feePercentage: String(method.defaultFeePercentage), fixedFee: String(method.fixedFee), settlementDays: String(method.settlementDays), settlementDayType: method.settlementDayType, effectiveFrom: localDateInput() });
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); try { await api(`/financial/payment-methods/${method.id}/fee-rules`, { method: "POST", body: JSON.stringify({ ...form, installments: method.type === "CREDIT_CARD" ? Number(form.installments) : undefined, feePercentage: Number(form.feePercentage.replace(",", ".")), fixedFee: Number(form.fixedFee.replace(",", ".")), settlementDays: Number(form.settlementDays) }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar a regra."); } }
  return <Modal title={`Nova regra — ${method.name}`} onClose={onClose}><form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>{method.type === "CREDIT_CARD" && <input className="field" inputMode="numeric" placeholder="Parcelas" value={form.installments} onChange={(e) => setForm({ ...form, installments: onlyDigits(e.target.value, 2) })} />}<input className="field" inputMode="decimal" placeholder="Taxa percentual" value={form.feePercentage} onChange={(e) => setForm({ ...form, feePercentage: e.target.value })} /><input className="field" inputMode="decimal" placeholder="Taxa fixa" value={form.fixedFee} onChange={(e) => setForm({ ...form, fixedFee: e.target.value })} /><input className="field" inputMode="numeric" placeholder="Prazo em dias" value={form.settlementDays} onChange={(e) => setForm({ ...form, settlementDays: onlyDigits(e.target.value) })} /><input className="field" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />{error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}<button className="btn btn-primary justify-self-end sm:col-span-2">Salvar nova vigência</button></form></Modal>;
}

function Page({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h1 className="text-2xl font-semibold">{title}</h1>{action}</div>{children}</>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset><legend className="mb-2 text-sm font-semibold">{title}</legend><div className="grid gap-3 md:grid-cols-2">{children}</div></fieldset>;
}

function DataCards({ items }: { items: { title: string; subtitle?: string; meta?: string; status?: string; action?: React.ReactNode }[] }) {
  return <div className="grid gap-3">{items.map((item, index) => <div className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between" key={`${item.title}-${index}`}><div><div className="flex flex-wrap items-center gap-2"><strong>{item.title}</strong>{item.status && <span className="badge bg-slate-100 text-slate-700">{item.status}</span>}</div><p className="text-sm text-slate-500">{item.subtitle}</p><p className="text-sm text-slate-500">{item.meta}</p></div>{item.action}</div>)}</div>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const saved = localStorage.getItem("ceo-pet-session");
    if (!saved) return null;
    try {
      return JSON.parse(saved) as Session;
    } catch {
      localStorage.removeItem("ceo-pet-session");
      return null;
    }
  });
  const [page, setPage] = useState(() => new URLSearchParams(window.location.search).get("pedido") ? "checkout" : "dashboard");
  const [checkoutDraft, setCheckoutDraft] = useState<Appointment | null>(null);
  const [checkoutSaleId, setCheckoutSaleId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("pedido"));
  const [connectionState, setConnectionState] = useState<ConnectionState>("UNKNOWN");
  const [connectionFailure, setConnectionFailure] = useState<ConnectionFailure | null>(null);
  const [retryingConnection, setRetryingConnection] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const connectionCheckInFlight = useRef<Promise<ConnectionFailure | null> | null>(null);
  const connectionStateRef = useRef<ConnectionState>("UNKNOWN");
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);
  useEffect(() => {
    function expireSession() {
      setSession(null);
      setCheckoutDraft(null);
      setCheckoutSaleId(null);
      setPage("dashboard");
    }
    window.addEventListener("ceo-pet-auth-expired", expireSession);
    return () => window.removeEventListener("ceo-pet-auth-expired", expireSession);
  }, []);
  useEffect(() => {
    if (!session) return;
    const refreshCount = () => void pendingOperations(session.company.id, session.user.id).then((items) => setPendingSyncCount(items.length));
    refreshCount();
    window.addEventListener("ceo-pet-sync-changed", refreshCount);
    const timer = window.setInterval(() => { if (pendingSyncCount > 0) void retryConnection(); }, 300000);
    return () => {
      window.removeEventListener("ceo-pet-sync-changed", refreshCount);
      window.clearInterval(timer);
    };
  }, [session?.company.id, session?.user.id, pendingSyncCount]);
  async function monitorConnection(syncAfterRecovery = false) {
    if (!navigator.onLine) {
      setConnectionFailure("api");
      setConnectionState("OFFLINE");
      return "api" as ConnectionFailure;
    }
    if (connectionCheckInFlight.current) return connectionCheckInFlight.current;
    if (syncAfterRecovery) setConnectionState("SYNCING");
    else setConnectionState((current) => current === "UNKNOWN" ? "CHECKING" : current);
    const check = checkConnection(2);
    connectionCheckInFlight.current = check;
    const failure = await check;
    connectionCheckInFlight.current = null;
    setConnectionFailure(failure);
    if (failure) {
      setConnectionState("OFFLINE");
    } else {
      if (syncAfterRecovery) window.dispatchEvent(new Event("ceo-pet-retry"));
      setConnectionState("ONLINE");
    }
    return failure;
  }
  useEffect(() => {
    const wentOffline = () => {
      setConnectionFailure("api");
      setConnectionState("OFFLINE");
    };
    const cameOnline = () => void monitorConnection(true);
    const apiFailed = () => void monitorConnection(false);
    window.addEventListener("offline", wentOffline);
    window.addEventListener("online", cameOnline);
    window.addEventListener("ceo-pet-network-failure", apiFailed);
    void monitorConnection(false);
    const heartbeat = window.setInterval(() => void monitorConnection(connectionStateRef.current === "OFFLINE"), 30000);
    return () => {
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("online", cameOnline);
      window.removeEventListener("ceo-pet-network-failure", apiFailed);
      window.clearInterval(heartbeat);
    };
  }, []);
  async function retryConnection() {
    setRetryingConnection(true);
    await monitorConnection(connectionState === "OFFLINE");
    setRetryingConnection(false);
  }
  const screen = useMemo(() => {
    if (page.startsWith("checkout")) return <Checkout draft={checkoutDraft} chargeSaleId={checkoutSaleId} onClearDraft={() => setCheckoutDraft(null)} session={session as Session} sectionPage={page} />;
    if (page.startsWith("financial")) return session?.user.role === "ADMIN"
      ? <FinancialModule sectionPage={page} />
      : <Page title="Acesso negado"><p className="panel p-4 text-sm text-red-700">Você não possui permissão para acessar o Financeiro.</p></Page>;
    return ({
      dashboard: <Dashboard />,
      customers: <Customers />,
      memberships: <Memberships onCreateCustomer={() => setPage("customers")} />,
      appointments: <Appointments onRenewMembership={() => setPage("memberships")} onCharge={(appointment) => { const saleId = appointment.sales?.[0]?.id ?? null; setCheckoutDraft(appointment); setCheckoutSaleId(saleId); if (saleId) window.history.replaceState(null, "", `${window.location.pathname}?pedido=${saleId}`); setPage("checkout"); }} />,
      products: <Catalog isAdmin={session?.user.role === "ADMIN"} />
    })[page] ?? <Dashboard />;
  }, [page, checkoutDraft, checkoutSaleId, session?.user.role]);

  if (!session) return <Login onSession={setSession} />;
  return <Layout session={session} active={page} onNavigate={setPage} onLogout={() => { localStorage.removeItem("ceo-pet-session"); setSession(null); }}>
    <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${connectionState === "OFFLINE" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
      <span>{connectionState === "OFFLINE"
        ? pendingSyncCount ? `Offline — ${pendingSyncCount} alterações aguardando envio neste dispositivo` : "Offline — utilizando dados locais."
        : connectionState === "SYNCING" ? "Sincronizando..."
        : connectionState === "UNKNOWN" || connectionState === "CHECKING" ? "Verificando conexão..."
        : pendingSyncCount ? `${pendingSyncCount} alterações aguardando envio` : "Online — tudo sincronizado"}</span>
      <button className="font-semibold underline disabled:opacity-50" disabled={retryingConnection} onClick={retryConnection}>{retryingConnection ? "Sincronizando..." : "Sincronizar agora"}</button>
    </div>
    {connectionState === "OFFLINE" && connectionFailure && <div className="mb-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <span>{connectionFailure === "api" ? "Não foi possível acessar o servidor do sistema. Verifique se a API está aberta e tente novamente." : "Não foi possível acessar o banco de dados. Tente novamente em alguns instantes."}</span>
      <button className="btn btn-secondary shrink-0 justify-center" disabled={retryingConnection} onClick={retryConnection}>{retryingConnection ? "Verificando..." : "Tentar novamente"}</button>
    </div>}
    {screen}
  </Layout>;
}
