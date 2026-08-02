import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  const company = await prisma.company.upsert({
    where: { id: "seed-company" },
    update: {},
    create: {
      id: "seed-company",
      name: "Pet Shop Modelo",
      document: "00.000.000/0001-00"
    }
  });

  await prisma.user.upsert({
    where: { email: "admin@ceopet.ai" },
    update: {},
    create: {
      companyId: company.id,
      name: "Admin CEO Pet",
      email: "admin@ceopet.ai",
      passwordHash,
      role: "ADMIN"
    }
  });

  const bath = await prisma.service.upsert({
    where: { id: "seed-service-bath" },
    update: {},
    create: {
      id: "seed-service-bath",
      companyId: company.id,
      name: "Banho",
      price: 60,
      estimatedMinutes: 60
    }
  });

  for (const service of [
    { id: "seed-service-hygienic-grooming", name: "Tosa higiênica", price: 45, estimatedMinutes: 40 },
    { id: "seed-service-full-grooming", name: "Tosa completa", price: 90, estimatedMinutes: 90 },
    { id: "seed-service-hydration", name: "Hidratação", price: 70, estimatedMinutes: 50 },
    { id: "seed-service-nail-cut", name: "Corte de unha", price: 25, estimatedMinutes: 15 }
  ]) {
    await prisma.service.upsert({
      where: { id: service.id },
      update: { name: service.name },
      create: { ...service, companyId: company.id }
    });
  }

  await prisma.membershipPlan.upsert({
    where: { id: "seed-plan-4-baths" },
    update: {},
    create: {
      id: "seed-plan-4-baths",
      companyId: company.id,
      name: "Pacote 4 Banhos Mensais",
      serviceId: bath.id,
      usageQuantity: 4,
      validityDays: 30,
      suggestedFrequencyDays: 7,
      price: 200
    }
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
