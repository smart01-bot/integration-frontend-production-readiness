import express from 'express';
import {
  getDashboardOverview,
  updateEventPhase,
  broadcastAnnouncementSms,
  getOrdersList,
  updateOrderStatus,
  getUsersList,
  updateUserRole,
  getInventoryStatus,
  releaseExpiredReservationsNow,
  getContentCMS,
  updateContentCMS,
  getAuditLogs,
  getPromoCodes,
  createPromoCode,
  getActivityCapacities,
  updateActivityCapacity,
  getRefundRequests,
  processRefundRequest,
  getIncidents,
  updateIncidentStatus,
  exportRegistrationsCsv,
  exportRevenueCsv
} from '../controllers/adminController.js';
import { requireRole } from '../middleware/rbac.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth());
router.use(requireRole(['admin']));

router.get('/dashboard/overview', getDashboardOverview);
router.get('/overview', getDashboardOverview);
router.patch('/events/phase', updateEventPhase);
router.post('/broadcast/sms', broadcastAnnouncementSms);

// Orders Management
router.get('/orders', getOrdersList);
router.patch('/orders/:id/status', updateOrderStatus);

// User Directory & Role Promotion
router.get('/users', getUsersList);
router.patch('/users/:id/role', updateUserRole);

// Inventory & 7-Day Hold Control
router.get('/inventory', getInventoryStatus);
router.post('/inventory/release-expired', releaseExpiredReservationsNow);

// CMS Content Management
router.get('/content', getContentCMS);
router.put('/content', updateContentCMS);

// Audit Logs
router.get('/audit-logs', getAuditLogs);

// Promo Codes & Capacity Controls
router.get('/promo-codes', getPromoCodes);
router.post('/promo-codes', createPromoCode);
router.get('/capacities', getActivityCapacities);
router.patch('/capacities/:id', updateActivityCapacity);

// Refunds & Issue Workflow
router.get('/refunds', getRefundRequests);
router.post('/refunds/:id/process', processRefundRequest);

// Incident Management (HQ command centre)
router.get('/incidents', getIncidents);
router.patch('/incidents/:id/status', updateIncidentStatus);

// Exports (M&E and reporting)
router.get('/export/registrations.csv', exportRegistrationsCsv);
router.get('/export/revenue.csv', exportRevenueCsv);

export default router;
