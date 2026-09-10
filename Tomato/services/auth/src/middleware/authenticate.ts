import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../model/User.js';

export interface AuthenticatedRequest extends Request {
	user?: {
		userId: string;
		email?: string;
		phone?: string;
		role: UserRole;
	};
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
	const header = req.header('authorization');
	const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
	const jwtSecret = process.env.JWT_SECRET;

	if (!token || !jwtSecret) {
		return res.status(401).json({ message: 'Authentication required' });
	}

	try {
		const payload = jwt.verify(token, jwtSecret);
		if (typeof payload !== 'object' || typeof payload.userId !== 'string' || typeof payload.role !== 'string') {
			return res.status(401).json({ message: 'Invalid authentication token' });
		}

		const authenticatedUser: NonNullable<AuthenticatedRequest['user']> = {
			userId: payload.userId,
			role: payload.role as UserRole,
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