import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

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

export function companyId(req: Request) {
  if (!req.user?.companyId) throw new Error("Empresa nao autenticada");
  return req.user.companyId;
}
