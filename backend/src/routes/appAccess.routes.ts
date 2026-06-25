import express, { RequestHandler } from 'express'
import { authenticate, authorizeAdmin } from '../middleware/auth'
import {
  getNavigation,
  getAccess,
  listPages,
  updatePageAccess,
} from '../controllers/appAccess.controller'

const router = express.Router()

const h = (fn: unknown) => fn as RequestHandler

// All routes require authentication.
router.use(h(authenticate))

// Sidebar nav + per-page access for the current user.
router.get('/navigation',       h(getNavigation))

// Admin matrix CRUD — declared BEFORE `/:pageKey` so the param doesn't swallow
// `/admin`. Admin role only.
router.get('/admin/pages',                   h(authorizeAdmin), h(listPages))
router.put('/admin/pages/:id/access',        h(authorizeAdmin), h(updatePageAccess))

// Single-page access check (must come last among GETs because of `/:pageKey`).
router.get('/:pageKey',         h(getAccess))

export default router
