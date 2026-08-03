import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";

export const authRouter = Router();

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function sendPasswordResetEmail(email: string, resetUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) throw new Error("PASSWORD_EMAIL_NOT_CONFIGURED");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Redefinição de senha — CEO Pet AI",
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a"><h2>Redefinir sua senha</h2><p>Recebemos uma solicitação para alterar a senha de acesso ao CEO Pet AI.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2554d9;color:#fff;text-decoration:none;border-radius:6px">Criar nova senha</a></p><p>Este link é válido por 1 hora e só pode ser usado uma vez.</p><p>Se você não fez esta solicitação, ignore este e-mail.</p></div>`
    })
  });
  if (!response.ok) throw new Error("PASSWORD_EMAIL_SEND_FAILED");
}

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
    email: z.string().email().transform(normalizeEmail),
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
  const body = z.object({ email: z.string().email().transform(normalizeEmail), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email }, include: { company: true } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return res.status(401).json({ message: "E-mail ou senha inválidos" });
  }

  const token = jwt.sign({ userId: user.id, companyId: user.companyId, role: user.role }, process.env.JWT_SECRET ?? "dev-secret", { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, company: user.company });
});

authRouter.post("/forgot-password", async (req, res) => {
  const { email } = z.object({ email: z.string().email().transform(normalizeEmail) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });

  // A resposta é sempre igual para não revelar quais e-mails estão cadastrados.
  if (!user) return res.json({ message: "Se o e-mail estiver cadastrado, você receberá o link para criar uma nova senha." });

  const rawToken = randomBytes(32).toString("hex");
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 60 * 60 * 1000) }
    })
  ]);

  const appUrl = (process.env.APP_URL || process.env.WEB_ORIGIN || "http://localhost:5173").split(",")[0].replace(/\/$/, "");
  try {
    await sendPasswordResetEmail(user.email, `${appUrl}/?resetToken=${encodeURIComponent(rawToken)}`);
  } catch (error) {
    console.error("PASSWORD_RESET_EMAIL_ERROR", { message: error instanceof Error ? error.message : String(error) });
    return res.status(503).json({ code: "PASSWORD_EMAIL_UNAVAILABLE", message: "O envio de e-mail ainda não está configurado. Tente novamente mais tarde." });
  }
  return res.json({ message: "Se o e-mail estiver cadastrado, você receberá o link para criar uma nova senha." });
});

authRouter.post("/reset-password", async (req, res) => {
  const body = z.object({ token: z.string().min(32), password: z.string().min(6) }).parse(req.body);
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(body.token) } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) {
    return res.status(400).json({ message: "Este link é inválido ou expirou. Solicite um novo link." });
  }
  const passwordHash = await bcrypt.hash(body.password, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } })
  ]);
  return res.json({ message: "Senha alterada com sucesso. Você já pode entrar no sistema." });
});
