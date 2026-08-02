import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const optionalText = z.string().trim().optional().transform((value) => value || undefined);
  const body = z.object({
    legalName: z.string().trim().min(2),
    tradeName: z.string().trim().min(2),
    cnpj: z.string().regex(/^\d{14}$/),
    stateRegistration: optionalText,
    municipalRegistration: optionalText,
    taxRegime: z.enum(["MEI", "SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"]),
    zipCode: z.string().regex(/^\d{8}$/),
    street: z.string().trim().min(2),
    number: z.string().trim().min(1),
    complement: optionalText,
    neighborhood: z.string().trim().min(2),
    city: z.string().trim().min(2),
    state: z.string().trim().length(2),
    country: z.string().trim().min(2).default("Brasil"),
    landline: optionalText,
    mobile: z.string().regex(/^\d{10,11}$/),
    site: optionalText,
    instagram: optionalText,
    facebook: optionalText,
    responsibleName: z.string().trim().min(2),
    responsibleCpf: z.string().regex(/^\d{11}$/),
    responsibleRole: z.string().trim().min(2),
    responsibleEmail: z.string().email(),
    responsibleMobile: z.string().regex(/^\d{10,11}$/),
    email: z.string().email(),
    password: z.string().min(6)
  }).parse(req.body);

  const passwordHash = await bcrypt.hash(body.password, 10);
  const company = await prisma.company.create({
    data: {
      name: body.tradeName,
      document: body.cnpj,
      legalName: body.legalName,
      tradeName: body.tradeName,
      stateRegistration: body.stateRegistration,
      municipalRegistration: body.municipalRegistration,
      taxRegime: body.taxRegime,
      zipCode: body.zipCode,
      street: body.street,
      number: body.number,
      complement: body.complement,
      neighborhood: body.neighborhood,
      city: body.city,
      state: body.state.toUpperCase(),
      country: body.country,
      landline: body.landline,
      mobile: body.mobile,
      site: body.site,
      instagram: body.instagram,
      facebook: body.facebook,
      responsibleName: body.responsibleName,
      responsibleCpf: body.responsibleCpf,
      responsibleRole: body.responsibleRole,
      responsibleEmail: body.responsibleEmail,
      responsibleMobile: body.responsibleMobile,
      users: {
        create: {
          name: body.responsibleName,
          email: body.email,
          passwordHash,
          role: "ADMIN"
        }
      }
    },
    include: { users: true }
  });

  const user = company.users[0];
  const token = jwt.sign({ userId: user.id, companyId: company.id, role: user.role }, process.env.JWT_SECRET ?? "dev-secret", { expiresIn: "7d" });
  res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, company });
});

authRouter.post("/login", async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email }, include: { company: true } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return res.status(401).json({ message: "E-mail ou senha inválidos" });
  }

  const token = jwt.sign({ userId: user.id, companyId: user.companyId, role: user.role }, process.env.JWT_SECRET ?? "dev-secret", { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, company: user.company });
});
