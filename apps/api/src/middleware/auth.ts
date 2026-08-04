import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

type TokenPayload = {
  userId: string;
  companyId: string;
  role: "ADMIN" | "EMPLOYEE";
};

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Token ausente" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET ?? "dev-secret") as TokenPayload;
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalido" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ message: "Apenas administradores podem executar esta acao" });
  }
  return next();
}

export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.userId) return res.status(401).json({ message: "Usuário não autenticado." });
    const user = await prisma.user.findFirst({ where: { id: req.user.userId, companyId: req.user.companyId }, select: { role: true, active: true, permissions: true } });
    if (!user?.active) return res.status(403).json({ message: "Este acesso está desativado." });
    if (user.role === "ADMIN" || user.permissions.includes(permission) || user.permissions.some((item) => item.startsWith(`${permission}:`))) return next();
    return res.status(403).json({ message: "Você não possui permissão para acessar esta função." });
  };
}

export function companyId(req: Request) {
  if (!req.user?.companyId) throw new Error("Empresa nao autenticada");
  return req.user.companyId;
}
