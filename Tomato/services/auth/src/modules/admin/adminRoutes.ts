import express from 'express';
import {
  authenticate,
  requireRole,
} from '../../middleware/authenticate.js';
import adminPincodeRoutes from './routes/adminPincodes.js';
import adminCouponRoutes from './routes/adminCoupons.js';
import adminOverviewRoutes from './routes/adminOverview.js';
import adminOrderRoutes from './routes/adminOrders.js';
import adminUserRoutes from './routes/adminUsers.js';
import adminComplaintRoutes from './routes/adminComplaints.js';
import adminBankRoutes from './routes/adminBank.js';
import adminBillingRoutes from './routes/adminBilling.js';

const createAdminRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('admin', 'subadmin'));

  router.use('/', adminPincodeRoutes);
  router.use('/', adminCouponRoutes);
  router.use('/', adminOverviewRoutes);
  router.use('/', adminOrderRoutes);
  router.use('/', adminUserRoutes);
  router.use('/', adminComplaintRoutes);
  router.use('/', adminBankRoutes);
  router.use('/', adminBillingRoutes);

  return router;
};

export const adminRoutes = createAdminRouter();
export default adminRoutes;
