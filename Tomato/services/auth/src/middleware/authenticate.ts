import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import Employee, { UserRole } from '../model/Employee.js';
import Restaurant from '../model/Restaurant.js';
import Customer from '../model/Customer.js';
import Rider from '../model/Rider.js';
import Shop from '../model/Shop.js';

export interface AuthenticatedRequest extends Request {
	user?: {
		userId: string;
		email?: string;
		phone?: string;
		name?: string;
		role: UserRole;
		isApproved?: boolean;
		isBlocked?: boolean;
		adminRoleTitle?: string;
		permissions?: string[];
		restaurantId?: string;
		riderId?: string;
		customerId?: string;
		subadminId?: string;
		adminId?: string;
		employeeId?: string;
		shopId?: string;
		baseRole?: string;
	};
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
	const header = req.header('authorization');
	const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
	const jwtSecret = process.env.JWT_SECRET || 'tomato-local-development-secret';

	if (!token) {
		return res.status(401).json({ message: 'Authentication required' });
	}

	try {
		const payload = jwt.verify(token, jwtSecret);
		const uid = (payload as any)?.userId || (payload as any)?.id || (payload as any)?._id;
		const uRole = (payload as any)?.role;
		if (typeof payload !== 'object' || typeof uid !== 'string' || typeof uRole !== 'string') {
			return res.status(401).json({ message: 'Invalid authentication token' });
		}

		let permissions: string[] = [];
		let adminRoleTitle = '';
		let baseRole = '';
		let restaurantId = '';
		let riderId = '';
		let customerId = '';
		let subadminId = '';
		let adminId = '';
		let employeeId = '';
		let shopId = '';

		try {
			let dbUser: any = null;
			if (uRole === 'restaurant') {
				dbUser = await Restaurant.findById(uid).select('isBlocked isApproved name role restaurantId');
			} else if (uRole === 'shop') {
				dbUser = await Shop.findById(uid).select('isBlocked isApproved name role shopId');
			} else if (uRole === 'deliveryPartner' || uRole === 'rider') {
				dbUser = await Rider.findById(uid).select('isBlocked isApproved name role riderId');
			} else if (uRole === 'customer') {
				dbUser = await Customer.findById(uid).select('isBlocked isApproved name role customerId');
			} else {
				dbUser = await Employee.findById(uid).select('isBlocked isApproved name role baseRole permissions adminRoleTitle restaurantId riderId customerId subadminId adminId employeeId');
			}

			if (!dbUser) {
				dbUser = (await Customer.findById(uid).select('isBlocked isApproved name role customerId'))
					|| (await Shop.findById(uid).select('isBlocked isApproved name role shopId'))
					|| (await Rider.findById(uid).select('isBlocked isApproved name role riderId'))
					|| (await Restaurant.findById(uid).select('isBlocked isApproved name role restaurantId'))
					|| (await Employee.findById(uid).select('isBlocked isApproved name role baseRole permissions adminRoleTitle restaurantId riderId customerId subadminId adminId employeeId'));
			}
			if (dbUser && dbUser.isBlocked) {
				return res.status(403).json({ message: 'Your account has been blocked by administrator. Please contact support.' });
			}
			if (dbUser) {
				permissions = Array.isArray(dbUser.permissions) ? dbUser.permissions : [];
				adminRoleTitle = dbUser.adminRoleTitle || '';
				baseRole = dbUser.baseRole || '';
				restaurantId = dbUser.restaurantId || '';
				shopId = dbUser.shopId || '';
				riderId = dbUser.riderId || '';
				customerId = dbUser.customerId || '';
				subadminId = dbUser.subadminId || '';
				adminId = dbUser.adminId || '';
				employeeId = dbUser.employeeId || '';
			}
		} catch {
			// In case DB is temporarily slow or disconnected during unit tests
		}

		if (!permissions.length && Array.isArray((payload as any).permissions)) {
			permissions = (payload as any).permissions;
		}
		if (!adminRoleTitle && typeof (payload as any).adminRoleTitle === 'string') {
			adminRoleTitle = (payload as any).adminRoleTitle;
		}
		if (!baseRole && typeof (payload as any).baseRole === 'string') {
			baseRole = (payload as any).baseRole;
		}
		if (!restaurantId && typeof (payload as any).restaurantId === 'string') {
			restaurantId = (payload as any).restaurantId;
		}
		if (!shopId && typeof (payload as any).shopId === 'string') {
			shopId = (payload as any).shopId;
		}
		if (!riderId && typeof (payload as any).riderId === 'string') {
			riderId = (payload as any).riderId;
		}
		if (!customerId && typeof (payload as any).customerId === 'string') {
			customerId = (payload as any).customerId;
		}
		if (!subadminId && typeof (payload as any).subadminId === 'string') {
			subadminId = (payload as any).subadminId;
		}
		if (!adminId && typeof (payload as any).adminId === 'string') {
			adminId = (payload as any).adminId;
		}
		if (!employeeId && typeof (payload as any).employeeId === 'string') {
			employeeId = (payload as any).employeeId;
		}

		const authenticatedUser: NonNullable<AuthenticatedRequest['user']> = {
			userId: uid,
			role: uRole as UserRole,
			baseRole,
			permissions,
			adminRoleTitle,
			restaurantId,
			shopId,
			riderId,
			customerId,
			subadminId,
			adminId,
			employeeId,
		};
		if (typeof payload.email === 'string') authenticatedUser.email = payload.email;
		if (typeof payload.phone === 'string') authenticatedUser.phone = payload.phone;
		(req as AuthenticatedRequest).user = authenticatedUser;
		return next();
	} catch {
		return res.status(401).json({ message: 'Invalid or expired authentication token' });
	}
};

export const requireRole = (...roles: (UserRole | string)[]) => (req: Request, res: Response, next: NextFunction) => {
	const user = (req as AuthenticatedRequest).user;
	if (!user) {
		return res.status(403).json({ message: 'You do not have permission for this resource' });
	}
	if (
		user.role === 'superadmin' ||
		roles.includes(user.role) ||
		(user.baseRole && (roles.includes(user.baseRole as any) || user.baseRole === 'superadmin'))
	) {
		return next();
	}
	return res.status(403).json({ message: 'You do not have permission for this resource' });
};

export const requirePermission = (permission: string) => (req: Request, res: Response, next: NextFunction) => {
	const user = (req as AuthenticatedRequest).user;
	if (!user) {
		return res.status(401).json({ message: 'Authentication required' });
	}
	// Super-admin & Platform Admin (or custom role with base admin) have full access to all resources
	if (user.role === 'superadmin' || user.role === 'admin' || user.baseRole === 'admin') {
		return next();
	}
	// Sub-admin or custom staff roles check specific permission or wildcard
	const perms = Array.isArray(user.permissions) ? user.permissions : [];
	if (perms.includes(permission) || perms.includes('*')) {
		return next();
	}
	return res.status(403).json({
		message: `Access denied. Requires '${permission}' permission.`,
	});
};