do $$ begin
  create type "MembershipUsageStatus" as enum ('RESERVED', 'CONSUMED', 'RELEASED');
exception when duplicate_object then null;
end $$;

alter type "MembershipStatus" add value if not exists 'PENDING_PAYMENT';
alter type "MembershipStatus" add value if not exists 'INACTIVE';

do $$ begin
  create type "AppointmentPaymentMode" as enum ('AVULSO', 'PACKAGE');
exception when duplicate_object then null;
end $$;

alter type "AppointmentPaymentMode" add value if not exists 'RENEWAL_AT_CHECKOUT';

do $$ begin
  create type "MembershipRenewalStatus" as enum ('PENDING_PAYMENT', 'PAID', 'CANCELLED');
exception when duplicate_object then null;
end $$;

alter table "Appointment"
  add column if not exists "paymentMode" "AppointmentPaymentMode" not null default 'AVULSO',
  add column if not exists "membershipId" text;

alter table "SaleItem"
  add column if not exists "coveredByMembership" boolean not null default false;

create table if not exists "MembershipUsage" (
  "id" text primary key,
  "companyId" text not null,
  "membershipId" text not null,
  "appointmentId" text not null,
  "petId" text not null,
  "serviceId" text not null,
  "status" "MembershipUsageStatus" not null default 'RESERVED',
  "quantity" integer not null default 1,
  "usageNumber" integer,
  "balanceBefore" integer not null,
  "balanceAfter" integer,
  "operatorId" text,
  "reservedAt" timestamp(3) not null default current_timestamp,
  "consumedAt" timestamp(3),
  "releasedAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  constraint "MembershipUsage_membershipId_fkey" foreign key ("membershipId") references "CustomerMembership"("id") on delete restrict on update cascade,
  constraint "MembershipUsage_appointmentId_fkey" foreign key ("appointmentId") references "Appointment"("id") on delete restrict on update cascade
);

do $$ begin
  alter table "Appointment" add constraint "Appointment_membershipId_fkey"
    foreign key ("membershipId") references "CustomerMembership"("id") on delete set null on update cascade;
exception when duplicate_object then null;
end $$;

create unique index if not exists "MembershipUsage_appointmentId_key" on "MembershipUsage"("appointmentId");
create unique index if not exists "MembershipUsage_membershipId_appointmentId_key" on "MembershipUsage"("membershipId", "appointmentId");
create index if not exists "MembershipUsage_companyId_membershipId_status_idx" on "MembershipUsage"("companyId", "membershipId", "status");
create index if not exists "MembershipUsage_companyId_petId_idx" on "MembershipUsage"("companyId", "petId");
create index if not exists "Appointment_companyId_membershipId_idx" on "Appointment"("companyId", "membershipId");

create table if not exists "MembershipRenewal" (
  "id" text primary key,
  "companyId" text not null,
  "customerId" text not null,
  "petId" text not null,
  "planId" text not null,
  "appointmentId" text not null,
  "membershipId" text,
  "status" "MembershipRenewalStatus" not null default 'PENDING_PAYMENT',
  "priceSnapshot" decimal(10,2) not null,
  "createdById" text,
  "paidAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  constraint "MembershipRenewal_planId_fkey" foreign key ("planId") references "MembershipPlan"("id") on delete restrict on update cascade,
  constraint "MembershipRenewal_appointmentId_fkey" foreign key ("appointmentId") references "Appointment"("id") on delete restrict on update cascade,
  constraint "MembershipRenewal_membershipId_fkey" foreign key ("membershipId") references "CustomerMembership"("id") on delete set null on update cascade
);

create unique index if not exists "MembershipRenewal_appointmentId_key" on "MembershipRenewal"("appointmentId");
create index if not exists "MembershipRenewal_companyId_customerId_petId_status_idx" on "MembershipRenewal"("companyId", "customerId", "petId", "status");
create index if not exists "MembershipRenewal_companyId_planId_idx" on "MembershipRenewal"("companyId", "planId");

create table if not exists "AppointmentExtraService" (
  "id" text primary key,
  "companyId" text not null,
  "appointmentId" text not null,
  "serviceId" text not null,
  "nameSnapshot" text not null,
  "priceSnapshot" decimal(10,2) not null,
  "createdAt" timestamp(3) not null default current_timestamp,
  constraint "AppointmentExtraService_appointmentId_fkey" foreign key ("appointmentId") references "Appointment"("id") on delete cascade on update cascade,
  constraint "AppointmentExtraService_serviceId_fkey" foreign key ("serviceId") references "Service"("id") on delete restrict on update cascade
);

create unique index if not exists "AppointmentExtraService_appointmentId_serviceId_key" on "AppointmentExtraService"("appointmentId", "serviceId");
create index if not exists "AppointmentExtraService_companyId_appointmentId_idx" on "AppointmentExtraService"("companyId", "appointmentId");
