import customerRoutes from './customer/index.js';
import restaurantRoutes from './restaurant/index.js';
import shopRoutes from './shop/index.js';
import riderRoutes from './rider/index.js';
import adminRoutes from './admin/index.js';
import { authRoute } from './auth/index.js';
import { notificationRoutes, notificationService } from './notification/index.js';

export * from './customer/index.js';
export * from './restaurant/index.js';
export * from './shop/index.js';
export * from './rider/index.js';
export * from './admin/index.js';
export * from './auth/index.js';
export * from './notification/index.js';
export * from './wallet/index.js';

export {
  authRoute,
  notificationRoutes,
  notificationService,
  customerRoutes,
  restaurantRoutes,
  shopRoutes,
  riderRoutes,
  adminRoutes,
};

