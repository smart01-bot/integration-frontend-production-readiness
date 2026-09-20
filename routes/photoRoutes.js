import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { clampPagination, readLimiter } from '../middleware/apiHygiene.js';
import {
  getPhotos,
  searchPhotosByBib,
  uploadPhoto,
  batchUploadPhotos,
  deletePhoto
} from '../controllers/photoController.js';

const router = Router();

// Public lookups
router.get('/', readLimiter, clampPagination, getPhotos);
router.get('/bib/:bib_number', readLimiter, searchPhotosByBib);

// Ingestion endpoints (§14) - accessible to staff, media, photographers
router.post('/', auth(), requireRole(['admin', 'volunteer']), uploadPhoto);
router.post('/batch', auth(), requireRole(['admin', 'volunteer']), batchUploadPhotos);
router.delete('/:photoId', auth(), requireRole(['admin']), deletePhoto);

export default router;
