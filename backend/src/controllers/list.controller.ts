import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

interface AuthReq extends Request { user?: { user_id: number; role: string } }

// ── training_topic sync helpers ───────────────────────────────────────────────

/**
 * Ensures a topics row exists for a training_topic list item.
 * Returns the topics.id. Stores it as item_key on the list_items row.
 */
async function syncTopicCreate(listItemId: number, label: string, category: string | null): Promise<void> {
  // Find or create the topics row by label
  const existing = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM topics WHERE topic_name = ${label.trim()} LIMIT 1`
  );
  let topicId: number;
  if (existing.length > 0) {
    topicId = existing[0].id;
    await prisma.$executeRaw(
      Prisma.sql`UPDATE topics SET category = ${category || null}, is_active = 1, updated_at = NOW() WHERE id = ${topicId}`
    );
  } else {
    const maxRows = await prisma.$queryRaw<{ max_order: number }[]>(
      Prisma.sql`SELECT COALESCE(MAX(sort_order), 0) as max_order FROM topics`
    );
    const nextOrder = Number(maxRows[0]?.max_order ?? 0) + 1;
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO topics (topic_name, is_active, sort_order, category) VALUES (${label.trim()}, 1, ${nextOrder}, ${category || null})`
    );
    const [row] = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM topics WHERE topic_name = ${label.trim()} ORDER BY id DESC LIMIT 1`
    );
    topicId = row.id;
  }
  await prisma.$executeRaw(
    Prisma.sql`UPDATE list_items SET item_key = ${String(topicId)} WHERE id = ${listItemId}`
  );
}

// ── GET all items for a list type ─────────────────────────────────────────────
export const getListItems = async (req: Request, res: Response) => {
  try {
    const { list_type, include_inactive } = req.query;
    if (!list_type) return res.status(400).json({ success: false, message: 'list_type is required' });

    const conditions: Prisma.Sql[] = [Prisma.sql`list_type = ${list_type}`];
    if (include_inactive !== 'true') conditions.push(Prisma.sql`is_active = 1`);

    const items = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, list_type, item_key, category, label, sort_order, is_active, created_at
                 FROM list_items WHERE ${Prisma.join(conditions, ' AND ')}
                 ORDER BY sort_order ASC, id ASC`
    );

    // Lazily sync any training_topic items missing item_key
    if (list_type === 'training_topic') {
      const unsynced = items.filter(i => !i.item_key);
      for (const item of unsynced) {
        await syncTopicCreate(item.id, item.label, item.category ?? null);
        const [updated] = await prisma.$queryRaw<{ item_key: string }[]>(
          Prisma.sql`SELECT item_key FROM list_items WHERE id = ${item.id}`
        );
        item.item_key = updated?.item_key ?? null;
      }
    }

    res.json({ success: true, data: items.map(i => ({ ...i, is_active: Boolean(i.is_active) })) });
  } catch (error) {
    console.error('[LIST] getListItems error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── CREATE a new list item ────────────────────────────────────────────────────
/** Generate a stable key from a label: "Group Session" → "GROUP_SESSION" */
function slugify(label: string): string {
  return label.toUpperCase().trim()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'ITEM';
}

export const createListItem = async (req: AuthReq, res: Response) => {
  try {
    const { list_type, category, label, sort_order } = req.body;
    if (!list_type || !label?.trim()) {
      return res.status(400).json({ success: false, message: 'list_type and label are required' });
    }

    // For training_topic, item_key is managed by the sync — use null initially
    const item_key = list_type === 'training_topic'
      ? null
      : (req.body.item_key ?? (category === null || category === undefined ? slugify(label.trim()) : null));

    const maxRows = await prisma.$queryRaw<{ max_order: number }[]>(
      Prisma.sql`SELECT COALESCE(MAX(sort_order), 0) as max_order FROM list_items WHERE list_type = ${list_type}`
    );
    const nextOrder = sort_order ?? (Number(maxRows[0]?.max_order ?? 0) + 1);

    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
                 VALUES (${list_type}, ${item_key || null}, ${category || null}, ${label.trim()}, ${nextOrder}, 1)`
    );
    const [newItem] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, list_type, item_key, category, label, sort_order, is_active FROM list_items WHERE id = LAST_INSERT_ID()`
    );

    // Sync to topics table for training_topic
    if (list_type === 'training_topic') {
      await syncTopicCreate(newItem.id, newItem.label, category ?? null);
      const [synced] = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id, list_type, item_key, category, label, sort_order, is_active FROM list_items WHERE id = ${newItem.id}`
      );
      return res.status(201).json({ success: true, data: { ...synced, is_active: true } });
    }

    res.status(201).json({ success: true, data: { ...newItem, is_active: true } });
  } catch (error) {
    console.error('[LIST] createListItem error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── UPDATE label / category / sort_order ─────────────────────────────────────
export const updateListItem = async (req: AuthReq, res: Response) => {
  try {
    const itemId = parseInt(req.params.id);
    const { label, category, sort_order } = req.body;

    const parts: Prisma.Sql[] = [];
    if (label     !== undefined) parts.push(Prisma.sql`label = ${label.trim()}`);
    if (category  !== undefined) parts.push(Prisma.sql`category = ${category || null}`);
    if (sort_order !== undefined) parts.push(Prisma.sql`sort_order = ${Number(sort_order)}`);

    if (!parts.length) return res.status(400).json({ success: false, message: 'No fields to update' });

    await prisma.$executeRaw(Prisma.sql`UPDATE list_items SET ${Prisma.join(parts, ', ')} WHERE id = ${itemId}`);
    const [updated] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, list_type, item_key, category, label, sort_order, is_active FROM list_items WHERE id = ${itemId}`
    );

    // Sync label/category change to topics table for training_topic
    if (updated?.list_type === 'training_topic') {
      if (updated.item_key) {
        const topicId = parseInt(updated.item_key);
        const topicParts: Prisma.Sql[] = [];
        if (label    !== undefined) topicParts.push(Prisma.sql`topic_name = ${label.trim()}`);
        if (category !== undefined) topicParts.push(Prisma.sql`category = ${category || null}`);
        if (topicParts.length) {
          topicParts.push(Prisma.sql`updated_at = NOW()`);
          await prisma.$executeRaw(
            Prisma.sql`UPDATE topics SET ${Prisma.join(topicParts, ', ')} WHERE id = ${topicId}`
          );
        }
      } else {
        // item_key missing — run full sync
        await syncTopicCreate(itemId, updated.label, updated.category ?? null);
      }
    }

    res.json({ success: true, data: { ...updated, is_active: Boolean(updated?.is_active) } });
  } catch (error) {
    console.error('[LIST] updateListItem error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── TOGGLE active status ──────────────────────────────────────────────────────
export const toggleListItemStatus = async (req: AuthReq, res: Response) => {
  try {
    const itemId = parseInt(req.params.id);
    await prisma.$executeRaw(
      Prisma.sql`UPDATE list_items SET is_active = IF(is_active = 1, 0, 1) WHERE id = ${itemId}`
    );
    const [item] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, list_type, item_key, category, label, sort_order, is_active FROM list_items WHERE id = ${itemId}`
    );

    // Sync active status to topics table for training_topic
    if (item?.list_type === 'training_topic' && item.item_key) {
      const topicId = parseInt(item.item_key);
      const isActive = Boolean(item.is_active) ? 1 : 0;
      await prisma.$executeRaw(
        Prisma.sql`UPDATE topics SET is_active = ${isActive}, updated_at = NOW() WHERE id = ${topicId}`
      );
    }

    res.json({ success: true, data: { ...item, is_active: Boolean(item?.is_active) } });
  } catch (error) {
    console.error('[LIST] toggleListItemStatus error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── DELETE a list item ────────────────────────────────────────────────────────
export const deleteListItem = async (req: AuthReq, res: Response) => {
  try {
    const itemId = parseInt(req.params.id);
    const [item] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT list_type, item_key FROM list_items WHERE id = ${itemId}`
    );

    await prisma.$executeRaw(Prisma.sql`DELETE FROM list_items WHERE id = ${itemId}`);

    // Deactivate the topics row for training_topic (don't hard-delete due to FK refs)
    if (item?.list_type === 'training_topic' && item.item_key) {
      const topicId = parseInt(item.item_key);
      await prisma.$executeRaw(
        Prisma.sql`UPDATE topics SET is_active = 0, updated_at = NOW() WHERE id = ${topicId}`
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[LIST] deleteListItem error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── REORDER — accepts [{ id, sort_order }] ────────────────────────────────────
export const reorderListItems = async (req: AuthReq, res: Response) => {
  try {
    const items: { id: number; sort_order: number }[] = req.body.items;
    if (!Array.isArray(items)) return res.status(400).json({ success: false, message: 'items array required' });

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE list_items SET sort_order = ${item.sort_order} WHERE id = ${item.id}`
        );
      }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[LIST] reorderListItems error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
