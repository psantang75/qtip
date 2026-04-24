import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { getJwtSecret } from '../config/environment';
import logger from '../config/logger';
const fs     = require('fs').promises;
const path   = require('path');
const { createReadStream } = require('fs');

/**
 * Office Online viewer / cross-origin file access — pre-production review item #45.
 *
 * Previously this controller minted a random hex token and kept it in a
 * per-process `Map`. That made the URL useless across PM2 workers and
 * across restarts (the lookup map was empty after either event), and the
 * download path returned `Access-Control-Allow-Origin: *` so any site that
 * could guess the URL could fetch the bytes.
 *
 * Both problems collapse into one fix: sign the (resourceId, exp) pair as a
 * JWT instead of storing it server-side. Verification is stateless, so it
 * works on any worker and survives any restart, and we can tighten CORS to
 * the actual Office Online viewer origins instead of `*`.
 */

const VIEW_TOKEN_TTL_SECONDS = 120; // 2-minute window — same effective TTL as the old Map.
const VIEW_TOKEN_AUDIENCE   = 'qtip:resource-view';

interface ViewTokenPayload {
  /** Token is valid only for this resource id — prevents URL-substitution attacks. */
  rid: number;
  /** Audience tag so a regular auth JWT can never be used as a view token. */
  aud: string;
}

/**
 * Office Online viewer / Office Apps origins we explicitly allow to fetch
 * the bytes via CORS. Configurable through `OFFICE_VIEWER_ALLOWED_ORIGINS`
 * (comma-separated) for environments that need additional viewers. Anything
 * not on this list gets no `Access-Control-Allow-Origin` header at all,
 * which is the safe default — same-origin requests still work because they
 * don't need CORS in the first place.
 */
const OFFICE_VIEWER_ORIGINS = (() => {
  const fromEnv = process.env.OFFICE_VIEWER_ALLOWED_ORIGINS?.trim();
  if (fromEnv) {
    return fromEnv.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [
    'https://view.officeapps.live.com',
    'https://officeapps.live.com',
    'https://word-edit.officeapps.live.com',
    'https://excel.officeapps.live.com',
    'https://powerpoint.officeapps.live.com',
    'https://outlook.officeapps.live.com',
  ];
})();

function applyOfficeViewerCors(req: Request, res: Response): void {
  const origin = (req.headers.origin as string | undefined)?.trim();
  if (origin && OFFICE_VIEWER_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
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
    logger.error('[RESOURCE] getResources error:', error);
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
    logger.error('[RESOURCE] createResource error:', error);
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
    logger.error('[RESOURCE] updateResource error:', error);
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
    logger.error('[RESOURCE] toggleResourceStatus error:', error);
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

    const token = jwt.sign(
      { rid: resourceId, aud: VIEW_TOKEN_AUDIENCE } satisfies ViewTokenPayload,
      getJwtSecret(),
      { expiresIn: VIEW_TOKEN_TTL_SECONDS },
    );

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host     = req.headers['x-forwarded-host'] || req.get('host');
    const viewUrl  = `${protocol}://${host}/api/trainer/resources/${resourceId}/view?token=${token}`;

    res.json({ success: true, data: { viewUrl } });
  } catch (error) {
    logger.error('[RESOURCE] generateViewToken error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Serve file via signed token (no auth middleware — token IS the auth) ───────

export const serveFileWithToken = async (req: Request, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id);
    const { token }  = req.query as { token?: string };

    if (!token) return res.status(401).json({ success: false, message: 'Token required' });

    let payload: ViewTokenPayload;
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as ViewTokenPayload & { exp?: number };
      if (decoded.aud !== VIEW_TOKEN_AUDIENCE || typeof decoded.rid !== 'number' || decoded.rid !== resourceId) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
      }
      payload = decoded;
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT file_path, file_name, file_mime_type FROM training_resources WHERE id = ${payload.rid} AND file_path IS NOT NULL`
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'File not found' });

    const { file_path, file_name, file_mime_type } = rows[0];
    const absPath = path.join(process.cwd(), file_path);
    try { await fs.access(absPath); } catch { return res.status(404).json({ success: false, message: 'File not found on server' }); }

    const stats = await fs.stat(absPath);
    res.setHeader('Content-Type', file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
    // Office Online needs cross-origin access; only echo Origin when it's on
    // the explicit Office viewer allowlist (see OFFICE_VIEWER_ORIGINS).
    applyOfficeViewerCors(req, res);

    const stream = createReadStream(absPath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    stream.pipe(res);
  } catch (error) {
    logger.error('[RESOURCE] serveFileWithToken error:', error);
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
    logger.error('[RESOURCE] downloadResourceFile error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
