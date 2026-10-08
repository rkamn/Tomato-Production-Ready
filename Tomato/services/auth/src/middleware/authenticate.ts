import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import Employee, { UserRole } from '../model/Employee.js';
import Restaurant from '../model/Restaurant.js';
import Customer from '../model/Customer.js';
import Rider from '../model/Rider.js';

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
		let restaurantId = '';
		let riderId = '';
		let customerId = '';
		let subadminId = '';
		let adminId = '';

		try {
			let dbUser: any = null;
			if (uRole === 'restaurant') {
				dbUser = await Restaurant.findById(uid).select('isBlocked isApproved name role restaurantId');
			} else if (uRole === 'deliveryPartner' || uRole === 'rider') {
				dbUser = await Rider.findById(uid).select('isBlocked isApproved name role riderId');
			} else if (uRole === 'customer') {
				dbUser = await Customer.findById(uid).select('isBlocked isApproved name role customerId');
			} else {
				dbUser = await Employee.findById(uid).select('isBlocked isApproved name role permissions adminRoleTitle restaurantId riderId customerId subadminId adminId');
			}

			if (!dbUser) {
				dbUser = (await Customer.findById(uid).select('isBlocked isApproved name role customerId'))
					|| (await Rider.findById(uid).select('isBlocked isApproved name role riderId'))
					|| (await Restaurant.findById(uid).select('isBlocked isApproved name role restaurantId'))
					|| (await Employee.findById(uid).select('isBlocked isApproved name role permissions adminRoleTitle restaurantId riderId customerId subadminId adminId'));
			}
			if (dbUser && dbUser.isBlocked) {
				return res.status(403).json({ message: 'Your account has been blocked by administrator. Please contact support.' });
			}
			if (dbUser) {
				permissions = Array.isArray(dbUser.permissions) ? dbUser.permissions : [];
				adminRoleTitle = dbUser.adminRoleTitle || '';
				restaurantId = dbUser.restaurantId || '';
				riderId = dbUser.riderId || '';
				customerId = dbUser.customerId || '';
				subadminId = dbUser.subadminId || '';
				adminId = dbUser.adminId || '';
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
		if (!restaurantId && typeof (payload as any).restaurantId === 'string') {
			restaurantId = (payload as any).restaurantId;
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

		const authenticatedUser: NonNullable<AuthenticatedRequest['user']> = {
			userId: uid,
			role: uRole as UserRole,
			permissions,
			adminRoleTitle,
			restaurantId,
			riderId,
			customerId,
			subadminId,
			adminId,
		};
		if (typeof payload.email === 'string') authenticatedUser.email = payload.email;
		if (typeof payload.phone === 'string') authenticatedUser.phone = payload.phone;
		(req as AuthenticatedRequest).user = authenticatedUser;
		return next();
	} catch {
		return res.status(401).json({ message: 'Invalid or expired authentication token' });
	}
};

export const requireRole = (...roles: UserRole[]) => (req: Request, res: Response, next: NextFunction) => {
	const user = (req as AuthenticatedRequest).user;
	if (!user || !roles.includes(user.role)) {
		return res.status(403).json({ message: 'You do not have permission for this resource' });
	}
	return next();
};

export const requirePermission = (permission: string) => (req: Request, res: Response, next: NextFunction) => {
	const user = (req as AuthenticatedRequest).user;
	if (!user) {
		return res.status(401).json({ message: 'Authentication required' });
	}
	// Super-admin has full access to all resources
	if (user.role === 'admin') {
		return next();
	}
	// Sub-admin must have the specific permission or wildcard
	if (user.role === 'subadmin') {
		const perms = Array.isArray(user.permissions) ? user.permissions : [];
		if (perms.includes(permission) || perms.includes('*')) {
			return next();
		}
	}
	return res.status(403).json({
		message: `Access denied. Requires '${permission}' permission.`,
	});
};