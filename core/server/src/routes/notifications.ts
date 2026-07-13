import { Router } from "express";
import { notificationService } from "../lib/notification-service.js";
import { db, notificationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

// GET /api/notifications — returns all unread + recent read notifications
// unreadCount is computed from the full table (not just the slice returned)
router.get("/notifications", async (_req, res) => {
  try {
    // All unread notifications, newest first
    const unread = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.read, false))
      .orderBy(desc(notificationsTable.createdAt));

    // Last 50 read notifications for history
    const recent = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.read, true))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);

    const unreadCount = unread.length;

    // Globally sorted newest-first across both buckets
    const notifications = [...unread, ...recent].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    res.json({ notifications, unread, recent, unreadCount, total: notifications.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list notifications" });
  }
});

// PATCH /api/notifications/:id/read — mark one notification as read
router.patch("/notifications/:id/read", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const ok = await notificationService.markRead(id);
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to mark read" });
  }
});

// POST /api/notifications/read-all — mark all notifications as read
router.post("/notifications/read-all", async (_req, res) => {
  try {
    await notificationService.markAllRead();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

// DELETE /api/notifications — clear all notifications
router.delete("/notifications", async (_req, res) => {
  try {
    await notificationService.clearAll();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

export default router;
