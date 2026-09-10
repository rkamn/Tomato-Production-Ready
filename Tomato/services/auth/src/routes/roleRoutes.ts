import express, { Request, Response } from 'express';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/authenticate.js';

const createRoleRouter = (role: 'customer' | 'restaurant' | 'deliveryPartner' | 'admin', title: string) => {
	const router = express.Router();

	router.use(authenticate, requireRole(role));
	router.get('/overview', (req: Request, res: Response) => {
		const user = (req as AuthenticatedRequest).user;
		return res.json({ role, title, userId: user?.userId, message: `${title} business API is ready` });
	});

	return router;
};

export const customerRoutes = createRoleRouter('customer', 'Customer');
export const restaurantRoutes = createRoleRouter('restaurant', 'Restaurant');
export const riderRoutes = createRoleRouter('deliveryPartner', 'Delivery partner');
export const adminRoutes = createRoleRouter('admin', 'Admin');