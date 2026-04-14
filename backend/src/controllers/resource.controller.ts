import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
const fs     = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');
const { createReadStream } = require('fs');

// Short-lived signed tokens for Office Online viewer (2-min TTL, no auth header required)
const viewTokens = new Map<string, { resourceId: number; expires: number }>();

function cleanExpiredTokens() {
  const now = Date.now();
  for (const [k, v] of viewTokens) {
    if (v.expires < now) viewTokens.delete(k);
  }
}

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
  file?: Express.Multer.File;
}

function detectResourceType(mimeType: string): string {
  if (mimeType === 'application/pdf')                                                                   return 'PDF';
  if (mimeType.startsWith('image/'))                                                                    return 'IMAGE';
  if (mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')           return 'WORD';
  if (mimeType === 'application/vnd.ms-powerpoint' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')         return 'POWERPOINT';
  if (mimeType === 'application/vnd.ms-excel' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')                 return 'EXCEL';
  if (mimeType.startsWith('video/'))                                                                    return 'VIDEO';
  return 'FILE';
}

function parseTopicIds(raw: any): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter(Boolean);
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : []; }
    catch { return raw.split(',').map(s => parseInt(s.trim())).filter(Boolean); }
  }
  return [];
}

// ── List ──────────────────────────────────────────────────────────────────────

export const getResources = async (req: AuthReq, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(5000, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;
    const { is_active, search } = req.query;

    const conditions: Prisma.Sql[] = [];
    if (is_active !== undefined) conditions.push(Prisma.sql`tr.is_active = ${is_active === 'true' ? 1 : 0}`);
    if (search)                  conditions.push(Prisma.sql`tr.title LIKE ${'%' + search + '%'}`);

    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.sql``;

    const [countRows, rows] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) as total FROM training_resources tr ${whereClause}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT tr.id, tr.title, tr.resource_type, tr.url,
            tr.file_name, tr.file_size, tr.file_mime_type,
            tr.description, tr.is_active, tr.created_at,
            u.username as created_by_name,
            GROUP_CONCAT(DISTINCT rt.topic_id ORDER BY rt.topic_id) as topic_id_list,
            GROUP_CONCAT(DISTINCT li.label ORDER BY li.label SEPARATOR '||') as topic_name_list
          FROM training_resources tr
          LEFT JOIN users u ON tr.created_by = u.id
          LEFT JOIN resource_topics rt ON tr.id = rt.resource_id
          LEFT JOIN list_items li ON rt.topic_id = li.id
          ${whereClause}
          GROUP BY tr.id
          ORDER BY tr.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      ),
    ]);

    const resources = rows.map(r => ({
      ...r,
      topic_ids:   r.topic_id_list ? String(r.topic_id_list).split(',').map(Number) : [],
      topic_names: r.topic_name_list ? String(r.topic_name_list).split('||') : [],
    }));

    res.json({ success: true, data: { resources, totalCount: Number(countRows[0]?.total ?? 0), page, limit } });
  } catch (error) {
    console.error('[RESOURCE] getResources error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Create ────────────────────────────────────────────────────────────────────

export const createResource = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const { title, resource_type, url, description, topic_ids: rawTopicIds, is_active } = req.body;
    const file = req.file;
    if (!title) return res.status(400).json({ success: false, message: 'title is required' });

    const type = resource_type ?? (file ? detectResourceType(file.mimetype) : 'URL');

    if (type === 'URL' && !url) {
      return res.status(400).json({ success: false, message: 'url is required for URL resources' });
    }

    let filePath: string | null = null, fileName: string | null = null,
        fileSize: number | null = null, fileMime: string | null = null;

    if (file) {
      const dir = path.join(process.cwd(), 'uploads', 'resources');
      await fs.mkdir(dir, { recursive: true });
      const storedName = `resource_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`;
      await fs.writeFile(path.join(dir, storedName), file.buffer);
      filePath = `uploads/resources/${storedName}`;
      fileName = file.originalname; fileSize = file.size; fileMime = file.mimetype;
    }

    const topicIds = parseTopicIds(rawTopicIds);

    const newId = await prisma.$transaction(async tx => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO training_resources
          (title, resource_type, url, file_path, file_name, file_size, file_mime_type, description, is_active, created_by)
          VALUES (${title}, ${type}, ${url || null}, ${filePath}, ${fileName}, ${fileSize}, ${fileMime},
                  ${description || null}, ${is_active === false || is_active === 'false' ? 0 : 1}, ${userId})`
      );
      const [{ id }] = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
      const resourceId = Number(id);
      for (const tid of topicIds) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO resource_topics (resource_id, topic_id) VALUES (${resourceId}, ${tid})`);
      }
      return resourceId;
    });

    res.status(201).json({ success: true, data: { id: newId }, message: 'Resource created' });
  } catch (error) {
    console.error('[RESOURCE] createResource error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Update ────────────────────────────────────────────────────────────────────

export const updateResource = async (req: AuthReq, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const { title, resource_type, url, description, is_active, topic_ids: rawTopicIds } = req.body;
    const file = req.file;

    const existing = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM training_resources WHERE id = ${resourceId}`);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Resource not found' });

    const parts: Prisma.Sql[] = [];
    if (title !== undefined)         parts.push(Prisma.sql`title = ${title}`);
    if (resource_type !== undefined)  parts.push(Prisma.sql`resource_type = ${resource_type}`);
    if (url !== undefined)            parts.push(Prisma.sql`url = ${url || null}`);
    if (description !== undefined)    parts.push(Prisma.sql`description = ${description || null}`);
    if (is_active !== undefined)      parts.push(Prisma.sql`is_active = ${is_active === false || is_active === 'false' ? 0 : 1}`);

    if (file) {
      const dir = path.join(process.cwd(), 'uploads', 'resources');
      await fs.mkdir(dir, { recursive: true });
      const storedName = `resource_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`;
      await fs.writeFile(path.join(dir, storedName), file.buffer);
      parts.push(Prisma.sql`file_path = ${'uploads/resources/' + storedName}`);
      parts.push(Prisma.sql`file_name = ${file.originalname}`);
      parts.push(Prisma.sql`file_size = ${file.size}`);
      parts.push(Prisma.sql`file_mime_type = ${file.mimetype}`);
      parts.push(Prisma.sql`resource_type = ${detectResourceType(file.mimetype)}`);
    }

    await prisma.$transaction(async tx => {
      if (parts.length) {
        await tx.$executeRaw(Prisma.sql`UPDATE training_resources SET ${Prisma.join(parts, ', ')}, updated_at = NOW() WHERE id = ${resourceId}`);
      }

      if (rawTopicIds !== undefined) {
        const topicIds = parseTopicIds(rawTopicIds);
        await tx.$executeRaw(Prisma.sql`DELETE FROM resource_topics WHERE resource_id = ${resourceId}`);
        for (const tid of topicIds) {
          await tx.$executeRaw(Prisma.sql`INSERT INTO resource_topics (resource_id, topic_id) VALUES (${resourceId}, ${tid})`);
        }
      }
    });

    res.json({ success: true, message: 'Resource updated' });
  } catch (error) {
    console.error('[RESOURCE] updateResource error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Toggle status ─────────────────────────────────────────────────────────────

export const toggleResourceStatus = async (req: AuthReq, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const { is_active } = req.body;
    if (is_active === undefined) return res.status(400).json({ success: false, message: 'is_active is required' });
    const existing = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM training_resources WHERE id = ${resourceId}`);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Resource not found' });
    await prisma.$executeRaw(Prisma.sql`UPDATE training_resources SET is_active = ${is_active === true || is_active === 'true' ? 1 : 0}, updated_at = NOW() WHERE id = ${resourceId}`);
    res.json({ success: true, message: 'Resource status updated' });
  } catch (error) {
    console.error('[RESOURCE] toggleResourceStatus error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Generate signed view URL (for Office Online) ─────────────────────────────

export const generateViewToken = async (req: AuthReq, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, file_path FROM training_resources WHERE id = ${resourceId} AND file_path IS NOT NULL`
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'File not found' });

    cleanExpiredTokens();
    const token = crypto.randomBytes(32).toString('hex');
    viewTokens.set(token, { resourceId, expires: Date.now() + 120_000 }); // 2 min

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host     = req.headers['x-forwarded-host'] || req.get('host');
    const viewUrl  = `${protocol}://${host}/api/trainer/resources/${resourceId}/view?token=${token}`;

    res.json({ success: true, data: { viewUrl } });
  } catch (error) {
    console.error('[RESOURCE] generateViewToken error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Serve file via signed token (no auth middleware — token IS the auth) ───────

export const serveFileWithToken = async (req: Request, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const { token }  = req.query as { token?: string };

    if (!token) return res.status(401).json({ success: false, message: 'Token required' });

    const entry = viewTokens.get(token);
    if (!entry || entry.expires < Date.now() || entry.resourceId !== resourceId) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT file_path, file_name, file_mime_type FROM training_resources WHERE id = ${resourceId} AND file_path IS NOT NULL`
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'File not found' });

    const { file_path, file_name, file_mime_type } = rows[0];
    const absPath = path.join(process.cwd(), file_path);
    try { await fs.access(absPath); } catch { return res.status(404).json({ success: false, message: 'File not found on server' }); }

    const stats = await fs.stat(absPath);
    res.setHeader('Content-Type', file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
    // Allow Office Online to fetch this cross-origin
    res.setHeader('Access-Control-Allow-Origin', '*');

    const stream = createReadStream(absPath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    stream.pipe(res);
  } catch (error) {
    console.error('[RESOURCE] serveFileWithToken error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Serve file (authenticated) ────────────────────────────────────────────────

export const downloadResourceFile = async (req: AuthReq, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT file_path, file_name, file_mime_type FROM training_resources WHERE id = ${resourceId} AND file_path IS NOT NULL`
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'File not found' });

    const { file_path, file_name, file_mime_type } = rows[0];
    const absPath = path.join(process.cwd(), file_path);
    try { await fs.access(absPath); } catch { return res.status(404).json({ success: false, message: 'File not found on server' }); }

    const stats = await fs.stat(absPath);
    res.setHeader('Content-Type', file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
    const stream = createReadStream(absPath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    stream.pipe(res);
  } catch (error) {
    console.error('[RESOURCE] downloadResourceFile error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
