import { Router } from "express";
import { companyId } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", async (req, res) => {
  const items = await prisma.systemNotification.findMany({ where: { companyId: companyId(req) }, orderBy: { createdAt: "desc" }, take: 30 });
  res.json({ items, unread: items.filter((item) => !item.readAt).length });
});

notificationsRouter.patch("/:id/read", async (req, res) => {
  const updated = await prisma.systemNotification.updateMany({ where: { id: req.params.id, companyId: companyId(req) }, data: { readAt: new Date() } });
  if (!updated.count) return res.status(404).json({ message: "Notificação não encontrada." });
  res.json({ ok: true });
});

notificationsRouter.patch("/read-all", async (req, res) => {
  await prisma.systemNotification.updateMany({ where: { companyId: companyId(req), readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
