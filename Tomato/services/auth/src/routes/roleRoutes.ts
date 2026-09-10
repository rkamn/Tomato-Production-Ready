import express, { Request, Response } from 'express';
import Address from '../model/Address.js';
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
		router.get('/addresses', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const addresses = await Address.find({ userId: user.userId }).sort({ isDefault: -1, createdAt: -1 });
				return res.json({ addresses });
			} catch (error) {
				console.error('Customer address fetch failed:', error);
				return res.status(500).json({ message: 'Unable to fetch addresses' });
			}
		});

		router.post('/addresses', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}

				const payload = req.body ?? {};
				const label = typeof payload.label === 'string' ? payload.label.trim() : 'Home';
				const line1 = typeof payload.line1 === 'string' ? payload.line1.trim() : '';
				const city = typeof payload.city === 'string' ? payload.city.trim() : '';
				const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
				const state = typeof payload.state === 'string' ? payload.state.trim() : '';
				const postalCode = typeof payload.postalCode === 'string' ? payload.postalCode.trim() : '';
				const line2 = typeof payload.line2 === 'string' ? payload.line2.trim() : '';
				const isDefault = Boolean(payload.isDefault);
				const newAddress = {
					userId: user.userId,
					label: label || 'Home',
					line1,
					city,
					state,
					postalCode,
					line2,
					phone: phone || undefined,
					isDefault,
				};

				if (!newAddress.line1 || !newAddress.city) {
					return res.status(400).json({ message: 'Address line and city are required' });
				}

				if (isDefault) {
					await Address.updateMany({ userId: user.userId }, { $set: { isDefault: false } });
				}

				const address = await Address.create(newAddress);
				return res.status(201).json({ message: 'Address saved', address });
			} catch (error) {
				console.error('Customer address save failed:', error);
				return res.status(500).json({ message: 'Unable to save address' });
			}
		});

		router.put('/addresses/:addressId', async (req: Request, res: Response) => {
			try {
				const user = (req as AuthenticatedRequest).user;
				if (!user?.userId) {
					return res.status(401).json({ message: 'Authentication required' });
				}
				const addressId = req.params.addressId;
				if (!addressId) {
					return res.status(400).json({ message: 'Address ID is required' });
				}

				const payload = req.body ?? {};
				const update: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(payload)) {
					if (value !== undefined && value !== null && value !== '') {
						update[key] = value;
					}
				}

				if (Object.keys(update).length === 0) {
					return res.status(400).json({ message: 'No address changes provided' });
				}

				if (update.isDefault === true) {
					await Address.updateMany({ userId: user.userId }, { $set: { isDefault: false } });
				}

				const address = await Address.findOneAndUpdate(
					{ _id: addressId, userId: user.userId },
					{ $set: update },
					{ new: true, runValidators: true },
				);

				if (!address) {
					return res.status(404).json({ message: 'Address not found' });
				}

				return res.json({ message: 'Address updated', address });
			} catch (error) {
				console.error('Customer address update failed:', error);
				return res.status(500).json({ message: 'Unable to update address' });
			}
		});

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
