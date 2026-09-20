import express from 'express';
import { getMerchandiseCatalog, getMerchandiseItem } from '../controllers/merchandiseController.js';

const router = express.Router();

router.get('/', getMerchandiseCatalog);
router.get('/:id', getMerchandiseItem);

export default router;
