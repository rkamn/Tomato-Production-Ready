import express, { Request, Response } from 'express';
import FoodItem from '../model/FoodItem.js';
import Notification from '../model/Notification.js';
import Order from '../model/Order.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/authenticate.js';

const createRoleRouter = (role: 'customer' | 'restaurant' | 'deliveryPartner' | 'admin', title: string) => {
	const router = express.Router();

	router.use(authenticate, requireRole(role));
	router.get('/overview', (req: Request, res: Response) => {
		const user = (req as AuthenticatedRequest).user;
		return res.json({ role, title, userId: user?.userId, message: `${title} business API is ready` });
	});

	if (role === 'restaurant') {
		router.get('/notifications', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const notifications = await Notification.find({ userId: user.userId, role }).sort({ createdAt: -1 }).limit(20);
				return res.json({ notifications });
			} catch (error) {
				console.error('Restaurant notification fetch failed:', error);
				return res.status(500).json({ message: 'Unable to fetch notifications' });
			}
		});

		router.get('/menu', async (_req: Request, res: Response) => {
			try {
				const user = (_req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const menu = await FoodItem.find({ restaurantId: user.userId, isActive: true }).sort({ createdAt: -1 });
				return res.json({ menu });
			} catch (error) {
				console.error('Restaurant menu fetch failed:', error);
				return res.status(500).json({ message: 'Unable to fetch restaurant menu' });
			}
		});

		router.post('/menu', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
				const quantity = Number(req.body?.quantity ?? 0);
				const price = Number(req.body?.price ?? 0);

				if (!name || !Number.isFinite(quantity) || quantity < 1 || !Number.isFinite(price) || price < 0) {
					return res.status(400).json({ message: 'Food item name, quantity, and price are required' });
				}

				const item = await FoodItem.create({
					restaurantId: user.userId,
					name,
					quantity,
					price,
					isActive: true,
				});

				await Notification.create({
					userId: user.userId,
					role: 'restaurant',
					title: 'Menu item added',
					message: `${name} is now live on the menu with quantity ${quantity} and price ₹${price}.`,
					type: 'menu',
					entityId: String(item._id),
				});

				return res.status(201).json({ message: 'Food item added', item });
			} catch (error) {
				console.error('Restaurant menu save failed:', error);
				return res.status(500).json({ message: 'Unable to add food item' });
			}
		});
	}

	if (role === 'customer') {
		router.get('/notifications', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const notifications = await Notification.find({ userId: user.userId, role }).sort({ createdAt: -1 }).limit(20);
				return res.json({ notifications });
			} catch (error) {
				console.error('Customer notification fetch failed:', error);
				return res.status(500).json({ message: 'Unable to fetch notifications' });
			}
		});

		router.get('/menu', async (_req: Request, res: Response) => {
			try {
				const menu = await FoodItem.find({ isActive: true }).sort({ createdAt: -1 }).lean();
				return res.json({ menu });
			} catch (error) {
				console.error('Customer menu fetch failed:', error);
				return res.status(500).json({ message: 'Unable to fetch menu' });
			}
		});

		router.post('/orders', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const items = Array.isArray(req.body?.items) ? req.body.items : [];
				if (!items.length) {
					return res.status(400).json({ message: 'Order items are required' });
				}

				const sanitizedItems: Array<{ foodItemId: string; name: string; quantity: number; price: number }> = items
					.map((entry: unknown) => {
						const item = entry as Record<string, unknown>;
						const foodItemId = typeof item.foodItemId === 'string' ? item.foodItemId : '';
						const name = typeof item.name === 'string' ? item.name.trim() : '';
						const quantity = Number(item.quantity ?? 0);
						const price = Number(item.price ?? 0);
						return { foodItemId, name, quantity, price };
					})
					.filter((entry: { foodItemId: string; name: string; quantity: number; price: number }) => Boolean(entry.foodItemId) && entry.name.length > 0 && entry.quantity > 0 && entry.price >= 0);

				if (!sanitizedItems.length) {
					return res.status(400).json({ message: 'Valid order items are required' });
				}

				const totalAmount = sanitizedItems.reduce<number>((sum, item) => sum + item.price * item.quantity, 0);
				const restaurantId = typeof req.body?.restaurantId === 'string' && req.body.restaurantId ? req.body.restaurantId : undefined;
				const order = await Order.create({
					customerId: user.userId,
					...(restaurantId ? { restaurantId } : {}),
					items: sanitizedItems,
					totalAmount,
					status: 'pending',
				});

				await Notification.create({
					userId: user.userId,
					role: 'customer',
					title: 'Order placed',
					message: `Your order for ${sanitizedItems.map((item) => item.name).join(', ')} is now pending.`,
					type: 'order',
					entityId: String(order._id),
				});

				return res.status(201).json({ message: 'Order placed successfully', order });
			} catch (error) {
				console.error('Place order failed:', error);
				return res.status(500).json({ message: 'Unable to place order' });
			}
		});
	}

	if (role === 'deliveryPartner') {
		router.get('/notifications', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const notifications = await Notification.find({ userId: user.userId, role }).sort({ createdAt: -1 }).limit(20);
				return res.json({ notifications });
			} catch (error) {
				console.error('Delivery partner notification fetch failed:', error);
				return res.status(500).json({ message: 'Unable to fetch notifications' });
			}
		});
	}

	if (role === 'admin') {
		router.get('/notifications', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const notifications = await Notification.find({ userId: user.userId, role }).sort({ createdAt: -1 }).limit(20);
				return res.json({ notifications });
			} catch (error) {
				console.error('Admin notification fetch failed:', error);
				return res.status(500).json({ message: 'Unable to fetch notifications' });
			}
		});
	}

	return router;
};

export const customerRoutes = createRoleRouter('customer', 'Customer');
export const restaurantRoutes = createRoleRouter('restaurant', 'Restaurant');
export const riderRoutes = createRoleRouter('deliveryPartner', 'Delivery partner');
export const adminRoutes = createRoleRouter('admin', 'Admin');

export const createNotificationForRole = async (args: {
  userId: string;
  role: 'customer' | 'restaurant' | 'deliveryPartner' | 'admin';
  title: string;
  message: string;
  type?: 'order' | 'menu' | 'service' | 'system';
  entityId?: string;
}) => {
  try {
    return await Notification.create({
      userId: args.userId,
      role: args.role,
      title: args.title,
      message: args.message,
      type: args.type || 'service',
      entityId: args.entityId || '',
    });
  } catch (error) {
    console.error('Notification creation failed:', error);
    return null;
  }
};
