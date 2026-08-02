import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const body = z.object({
    companyName: z.string().min(2),
    document: z.string().optional(),
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6)
  }).parse(req.body);

  const passwordHash = await bcrypt.hash(body.password, 10);
  const company = await prisma.company.create({
    data: {
      name: body.companyName,
      document: body.document,
      users: {
        create: {
          name: body.name,
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
