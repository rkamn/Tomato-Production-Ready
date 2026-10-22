import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Employee, { USER_ROLES, UserRole } from '../../model/Employee.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Customer, { ICustomer } from '../../model/Customer.js';
import Rider, { IRider } from '../../model/Rider.js';
import Shop, { IShop } from '../../model/Shop.js';
import Notification from '../../model/Notification.js';
import Address from '../../model/Address.js';
import { generateIdFromCounter } from '../../model/Counter.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';
import {
	extractPincodeFromText,
	resolvePartnerPincode,
	getServiceablePincodes,
} from '../../utils/bankHelpers.js';
import { getOrCreateUserWallet } from '../wallet/walletService.js';
import {
	createSession,
	revokeSession,
	revokeAllUserSessions,
	getUserActiveSessions,
} from '../../services/sessionService.js';
import mailService from '../../services/mailService.js';
import {
	credentialAttemptTracker,
	escapeRegex,
	logAuthEvent,
	logSecurityEvent,
	getClientIp,
	setAuthCookies,
	clearAuthCookies,
} from '../../security/index.js';

const getPublicBaseUrl = () => process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;

const scrypt = promisify(scryptCallback);

export const hashPassword = async (password: string) => {
	const salt = randomBytes(16).toString('hex');
	const derivedKey = await scrypt(password, salt, 64) as Buffer;
	return `${salt}:${derivedKey.toString('hex')}`;
};

export const verifyPassword = async (password: string, storedHash: string) => {
	const [salt, key] = storedHash.split(':');
	if (!salt || !key) {
		return false;
	}

	const derivedKey = await scrypt(password, salt, 64) as Buffer;
	const storedKey = Buffer.from(key, 'hex');
	return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, '');
const isPhone = (value: string) => /^\+?[1-9]\d{9,14}$/.test(value);
const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

const getRegistrationPayload = (body: Request['body']) => {
	const rawIdentifier = typeof body?.identifier === 'string' ? body.identifier.trim() : '';
	const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : rawIdentifier.includes('@') ? normalizeEmail(rawIdentifier) : '';
	const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : rawIdentifier && !rawIdentifier.includes('@') ? normalizePhone(rawIdentifier) : '';
	const payload: { email?: string; phone?: string } = {};

	if (email) payload.email = email;
	if (phone) payload.phone = phone;

	return payload;
};

export const formatUserId = (id?: string): string => {
	if (!id || typeof id !== 'string') return '';
	const trimmed = id.trim();
	if (trimmed.length <= 4) return trimmed.toLowerCase();
	return trimmed.slice(0, 4).toLowerCase() + trimmed.slice(4);
};

export const generateRestaurantId = (): Promise<string> =>
	generateIdFromCounter('restaurentId', 'rest', 1000, async (id: string) =>
		Boolean(await Restaurant.exists({ restaurantId: { $in: [id, id.toUpperCase()] } })),
	);

export const generateRiderId = (): Promise<string> =>
	generateIdFromCounter('riderId', 'ride', 1000, async (id: string) =>
		Boolean(await Rider.exists({ riderId: { $in: [id, id.toUpperCase()] } })),
	);

export const generateCustomerId = (): Promise<string> =>
	generateIdFromCounter('customerId', 'cust', 1000, async (id: string) =>
		Boolean(await Customer.exists({ customerId: { $in: [id, id.toUpperCase()] } })),
	);

export const generateSubAdminId = (): Promise<string> =>
	generateIdFromCounter('subadminId', 'sub', 1000, async (id: string) =>
		Boolean(await Employee.exists({ subadminId: { $in: [id, id.toUpperCase()] } })),
	);

export const generateEmployeeId = (): Promise<string> =>
	generateIdFromCounter('employeeId', 'emp', 1000, async (id: string) =>
		Boolean(await Employee.exists({ employeeId: { $in: [id, id.toUpperCase()] } })),
	);

export const generateAdminId = (): Promise<string> =>
	generateIdFromCounter('adminId', 'adm', 1000, async (id: string) =>
		Boolean(await Employee.exists({ adminId: { $in: [id, id.toUpperCase()] } })),
	);

export const generateShopId = (): Promise<string> =>
	generateIdFromCounter('shopId', 'shop', 1000, async (id: string) =>
		Boolean(await Shop.exists({ shopId: { $in: [id, id.toUpperCase()] } })),
	);

export const createToken = (user: {
	_id: { toString: () => string };
	email?: string;
	phone?: string;
	name?: string;
	role: string;
	permissions?: string[];
	adminRoleTitle?: string;
	restaurantId?: string;
	riderId?: string;
	customerId?: string;
	subadminId?: string;
	adminId?: string;
	employeeId?: string;
	shopId?: string;
}, sessionId?: string) => {
	const jwtSecret = process.env.JWT_SECRET || 'tomato-local-development-secret';

	return jwt.sign(
		{
			...(sessionId ? { sessionId } : {}),
			userId: user._id.toString(),
			id: user._id.toString(),
			_id: user._id.toString(),
			email: user.email,
			phone: user.phone,
			name: user.name,
			role: user.role,
			permissions: user.permissions || [],
			adminRoleTitle: user.adminRoleTitle || '',
			restaurantId: formatUserId(user.restaurantId),
			shopId: formatUserId((user as any).shopId),
			riderId: formatUserId(user.riderId),
			customerId: formatUserId(user.customerId),
			subadminId: formatUserId(user.subadminId),
			adminId: formatUserId((user as any).adminId),
			employeeId: formatUserId((user as any).employeeId),
		},
		jwtSecret,
		{ expiresIn: '12h' },
	);
};

export const userResponse = (user: {
	_id: unknown;
	name: string;
	email?: string;
	phone?: string;
	image?: string;
	role: string;
	isApproved?: boolean;
	isBlocked?: boolean;
	walletBalance?: number;
	creditPoint?: number;
	restaurantId?: string;
	shopId?: string;
	riderId?: string;
	customerId?: string;
	subadminId?: string;
	adminId?: string;
	digipin?: string;
	pincode?: string;
	restaurantAddress?: string;
	shopAddress?: string;
	restaurantLocation?: { lat: number; lng: number };
	shopLocation?: { lat: number; lng: number };
	cuisine?: string;
	category?: string;
	deliveryVehicle?: string;
	currentLocation?: { lat: number; lng: number };
	isOnline?: boolean;
	isOpen?: boolean;
	lastLocationUpdated?: Date;
	permissions?: string[];
	adminRoleTitle?: string;
	createdBy?: string;
	dob?: string;
	gsnNumber?: string;
	bankDetails?: any;
}) => {
	const rawCustomerId = user.customerId || (user.role === 'customer' ? `cust-${String(user._id).slice(-4).toLowerCase()}` : '');
	const rawSubadminId = user.subadminId || (user.role === 'subadmin' ? `sub-${String(user._id).slice(-4).toLowerCase()}` : '');
	const rawAdminId = (user as any).adminId || (user.role === 'admin' ? ((user as any).adminId || `adm-${String(user._id).slice(-4).toLowerCase()}`) : '');
	const rawEmployeeId = (user as any).employeeId || (user.role === 'employee' ? ((user as any).employeeId || `emp-${String(user._id).slice(-4).toLowerCase()}`) : '');
	const rawRestaurantId = user.restaurantId || (user.role === 'restaurant' ? `rest-${String(user._id).slice(-4).toLowerCase()}` : '');
	const rawShopId = (user as any).shopId || (user.role === 'shop' ? `shop-${String(user._id).slice(-4).toLowerCase()}` : '');
	const rawRiderId = user.riderId || (user.role === 'deliveryPartner' || (user.role as string) === 'rider' ? `ride-${String(user._id).slice(-4).toLowerCase()}` : '');

	const customerId = formatUserId(rawCustomerId);
	const subadminId = formatUserId(rawSubadminId);
	const adminId = formatUserId(rawAdminId);
	const employeeId = formatUserId(rawEmployeeId);
	const restaurantId = formatUserId(rawRestaurantId);
	const shopId = formatUserId(rawShopId);
	const riderId = formatUserId(rawRiderId);

	const cleanName = typeof user.name === 'string' ? (user.name.split('/')[0] ?? '').trim() : '';
	const displayName = cleanName || 'Tomato User';

	return {
		id: user._id,
		_id: user._id,
		name: cleanName || user.name,
		displayName,
		email: user.email,
		phone: user.phone,
		dob: (user as any).dob || '',
		gsnNumber: (user as any).gsnNumber && String((user as any).gsnNumber).trim()
			? String((user as any).gsnNumber).trim()
			: ((user.role === 'restaurant' || user.role === 'shop') ? 'NA' : ''),
		image: user.image || '',
		role: user.role,
		isApproved: user.isApproved ?? true,
		approvalStatus: (user as any).approvalStatus || (user.isApproved === false ? 'pending' : 'approved'),
		rejectionReason: (user as any).rejectionReason || '',
		restaurantId,
		shopId,
		riderId,
		customerId,
		subadminId,
		adminId,
		employeeId,
		username: (user as any).username || '',
		isSuperAdmin: user.role === 'superadmin',
		assignedLocation: (user as any).assignedLocation || null,
		salary: Math.max(0, Number((user as any).salary || 0)),
		digipin: user.digipin || '',
		pincode: resolvePartnerPincode(user),
		city: (user as any).city || (user as any).assignedLocation?.city || '',
		restaurantAddress: user.restaurantAddress || user.shopAddress || '',
		shopAddress: user.shopAddress || user.restaurantAddress || '',
		restaurantLocation: user.restaurantLocation || user.shopLocation || { lat: 12.9716, lng: 77.5946 },
		shopLocation: user.shopLocation || user.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
		cuisine: user.cuisine || user.category || '',
		category: user.category || user.cuisine || '',
		deliveryVehicle: user.deliveryVehicle || '',
		currentLocation: user.currentLocation || { lat: 12.9716, lng: 77.5946 },
		isOnline: user.isOnline ?? true,
		isOpen: user.isOpen ?? true,
		lastLocationUpdated: user.lastLocationUpdated || new Date(),
		permissions: user.permissions || [],
		adminRoleTitle: user.adminRoleTitle || '',
		createdBy: user.createdBy || '',
		bankDetails: (user as any).bankDetails || null,
	};
};

export const registerUser = async (req: Request, res: Response) => {
	const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
	const registrationData = getRegistrationPayload(req.body);
	const password = typeof req.body?.password === 'string' ? req.body.password : '';
	const requestedRole = typeof req.body?.role === 'string' ? req.body.role : 'customer';

	if (requestedRole === 'subadmin' || requestedRole === 'admin') {
		return res.status(403).json({ message: 'Administrative accounts can only be created by an administrator' });
	}

	const role = USER_ROLES.includes(requestedRole as UserRole) ? requestedRole as UserRole : null;
	const email = registrationData.email || '';
	const phone = registrationData.phone || '';

	if (!name || (!email && !phone) || !password || !role) {
		return res.status(400).json({ message: 'Name, email or mobile number, and password are required' });
	}

	if (password.length < 8) {
		return res.status(400).json({ message: 'Password must be at least 8 characters' });
	}

	if (phone && !isPhone(phone)) {
		return res.status(400).json({ message: 'Enter a valid mobile number' });
	}

	// Validate restaurant or shop location or DIGIPIN at registration
	let restaurantLocation: { lat: number; lng: number } = { lat: 12.9716, lng: 77.5946 };
	let digipin = typeof req.body?.digipin === 'string' ? req.body.digipin.trim().toUpperCase() : '';
	const rawLat = req.body?.restaurantLocation?.lat ?? req.body?.shopLocation?.lat ?? req.body?.lat;
	const rawLng = req.body?.restaurantLocation?.lng ?? req.body?.shopLocation?.lng ?? req.body?.lng;
	const hasCoords = rawLat !== undefined && rawLng !== undefined && !isNaN(Number(rawLat)) && !isNaN(Number(rawLng));

	if (role === 'restaurant' || role === 'shop') {
		if (!digipin && !hasCoords) {
			return res.status(400).json({
				message: `${role === 'shop' ? 'Shop' : 'Restaurant'} pickup location is required. Please share current GPS coordinates or DIGIPIN.`,
			});
		}
		if (hasCoords) {
			restaurantLocation = { lat: Number(rawLat), lng: Number(rawLng) };
		}
		if (!digipin && hasCoords) {
			digipin = `DGP-${Math.round(restaurantLocation.lat * 100)}-${Math.round(restaurantLocation.lng * 100)}`;
		}
	}

	try {
		const duplicateQuery = {
			$or: [
				...(email ? [{ email }] : []),
				...(phone ? [{ phone }] : []),
			],
		};

		const [existingEmployee, existingRestaurant, existingCustomer, existingRider, existingShop] = await Promise.all([
			Employee.findOne(duplicateQuery),
			Restaurant.findOne(duplicateQuery),
			Customer.findOne(duplicateQuery),
			Rider.findOne(duplicateQuery),
			Shop.findOne(duplicateQuery),
		]);

		if (existingEmployee || existingRestaurant || existingCustomer || existingRider || existingShop) {
			return res.status(409).json({ message: 'An account with that email or mobile number already exists' });
		}

		if (role === 'shop') {
			const shopId = await generateShopId();
			const shopAddress = typeof req.body?.shopAddress === 'string'
				? req.body.shopAddress.trim()
				: typeof req.body?.restaurantAddress === 'string'
					? req.body.restaurantAddress.trim()
					: '';
			const pincode = extractPincodeFromText(req.body?.pincode || shopAddress || digipin);
			const category = typeof req.body?.category === 'string'
				? req.body.category.trim()
				: typeof req.body?.cuisine === 'string'
					? req.body.cuisine.trim()
					: 'Retail, Supermarket & Groceries';

			const shopPayload: Record<string, unknown> = {
				name,
				passwordHash: await hashPassword(password),
				role: 'shop',
				isApproved: false,
				isBlocked: false,
				shopId,
				digipin,
				pincode,
				shopAddress,
				shopLocation: restaurantLocation,
				category,
				isOpen: true,
				isOnline: true,
			};
			if (email) shopPayload.email = email;
			if (phone) shopPayload.phone = phone;

			const shop = await Shop.create(shopPayload) as unknown as IShop;
			await getOrCreateUserWallet(String(shop._id), 'shop', shop.name).catch(() => {});

			await Notification.create({
				userId: String(shop._id),
				role: 'shop',
				title: 'Welcome to Tomato',
				message: `Your shop registration (${shop.name}) has been submitted and is pending admin approval.`,
				type: 'service',
			});

			if (email) {
				mailService.sendWelcomeAccountMail({
					userEmail: email,
					userName: shop.name,
					role: 'shop',
					accountId: shop.shopId,
					phone: shop.phone,
					isApproved: false,
					loginUrl: `${getPublicBaseUrl()}`,
				}).catch((err) => console.error('[Auth] Failed to send shop welcome mail:', err));
			}

			const { token, session } = await createSession(shop as any, req);
			return res.status(201).json({
				token,
				user: userResponse(shop as any),
				session: { sessionId: session.sessionId, expiresAt: session.expiresAt },
				message: 'Registration received. Awaiting admin approval.',
			});
		}

		if (role === 'restaurant') {
			const restaurantId = await generateRestaurantId();
			const restAddr = typeof req.body?.restaurantAddress === 'string' ? req.body.restaurantAddress.trim() : '';
			const pincode = extractPincodeFromText(req.body?.pincode || restAddr || digipin);
			const restaurantPayload: Record<string, unknown> = {
				name,
				passwordHash: await hashPassword(password),
				role: 'restaurant',
				isApproved: false,
				isBlocked: false,
				restaurantId,
				digipin,
				pincode,
				restaurantAddress: restAddr,
				restaurantLocation,
				cuisine: typeof req.body?.cuisine === 'string' ? req.body.cuisine.trim() : 'Multi-cuisine',
				isOpen: true,
				isOnline: true,
			};
			if (email) restaurantPayload.email = email;
			if (phone) restaurantPayload.phone = phone;

			const restaurant = await Restaurant.create(restaurantPayload) as unknown as IRestaurant;
			await getOrCreateUserWallet(String(restaurant._id), 'restaurant', restaurant.name).catch(() => {});

			await Notification.create({
				userId: String(restaurant._id),
				role: 'restaurant',
				title: 'Welcome to Tomato',
				message: `Your restaurant registration (${restaurant.name}) has been submitted and is pending admin approval.`,
				type: 'service',
			});

			if (email) {
				mailService.sendWelcomeAccountMail({
					userEmail: email,
					userName: restaurant.name,
					role: 'restaurant',
					accountId: restaurant.restaurantId,
					phone: restaurant.phone,
					isApproved: false,
					loginUrl: `${getPublicBaseUrl()}`,
				}).catch((err) => console.error('[Auth] Failed to send restaurant welcome mail:', err));
			}

			const { token, session } = await createSession(restaurant as any, req);
			return res.status(201).json({
				token,
				user: userResponse(restaurant as any),
				session: { sessionId: session.sessionId, expiresAt: session.expiresAt },
				message: 'Registration received. Awaiting admin approval.',
			});
		}

		if (role === 'customer') {
			const customerId = await generateCustomerId();
			const customerPayload: Record<string, unknown> = {
				name,
				passwordHash: await hashPassword(password),
				role: 'customer',
				isApproved: true,
				isBlocked: false,
				customerId,
			};
			if (email) customerPayload.email = email;
			if (phone) customerPayload.phone = phone;

			const customer = await Customer.create(customerPayload) as unknown as ICustomer;
			await getOrCreateUserWallet(String(customer._id), 'customer', customer.name).catch(() => {});

			await Notification.create({
				userId: String(customer._id),
				role: 'customer',
				title: 'Welcome to Tomato',
				message: `Your customer account (${customer.name}) is ready. Service updates will appear here.`,
				type: 'service',
			});

			if (email) {
				mailService.sendWelcomeAccountMail({
					userEmail: email,
					userName: customer.name,
					role: 'customer',
					accountId: customer.customerId,
					phone: customer.phone,
					isApproved: true,
					loginUrl: `${getPublicBaseUrl()}`,
				}).catch((err) => console.error('[Auth] Failed to send customer welcome mail:', err));
			}

			const { token, session } = await createSession(customer as any, req);
			return res.status(201).json({
				token,
				user: userResponse(customer as any),
				session: { sessionId: session.sessionId, expiresAt: session.expiresAt },
				message: 'Registration successful',
			});
		}

		if (role === 'deliveryPartner') {
			const riderId = await generateRiderId();
			const riderLat = req.body?.currentLocation?.lat ?? req.body?.lat;
			const riderLng = req.body?.currentLocation?.lng ?? req.body?.lng;
			const currentLocation = (riderLat !== undefined && riderLng !== undefined && !isNaN(Number(riderLat)))
				? { lat: Number(riderLat), lng: Number(riderLng) }
				: { lat: 12.9716, lng: 77.5946 };

			const riderPayload: Record<string, unknown> = {
				name,
				passwordHash: await hashPassword(password),
				role: 'deliveryPartner',
				isApproved: false,
				isBlocked: false,
				riderId,
				deliveryVehicle: typeof req.body?.deliveryVehicle === 'string' ? req.body.deliveryVehicle.trim() : 'motorcycle',
				currentLocation,
				isOnline: true,
				lastLocationUpdated: new Date(),
			};
			if (email) riderPayload.email = email;
			if (phone) riderPayload.phone = phone;

			const rider = await Rider.create(riderPayload) as unknown as IRider;
			await getOrCreateUserWallet(String(rider._id), 'deliveryPartner', rider.name).catch(() => {});

			await Notification.create({
				userId: String(rider._id),
				role: 'deliveryPartner',
				title: 'Welcome to Tomato',
				message: `Your delivery partner registration (${rider.name}) has been submitted and is pending admin approval.`,
				type: 'service',
			});

			if (email) {
				mailService.sendWelcomeAccountMail({
					userEmail: email,
					userName: rider.name,
					role: 'deliveryPartner',
					accountId: rider.riderId,
					phone: rider.phone,
					isApproved: false,
					loginUrl: `${getPublicBaseUrl()}`,
				}).catch((err) => console.error('[Auth] Failed to send delivery partner welcome mail:', err));
			}

			const { token, session } = await createSession(rider as any, req);
			return res.status(201).json({
				token,
				user: userResponse(rider as any),
				session: { sessionId: session.sessionId, expiresAt: session.expiresAt },
				message: 'Registration received. Awaiting admin approval.',
			});
		}

		const isEmployee = role === 'employee';
		const isApproved = !isEmployee; // Employee accounts require admin/superadmin approval!
		const approvalStatus = isEmployee ? 'pending' : 'approved';
		const adminId = role === 'admin' ? await generateAdminId() : undefined;
		const subadminId = role === 'subadmin' ? await generateSubAdminId() : undefined;
		const employeeId = isEmployee ? await generateEmployeeId() : undefined;
		const employeePayload: Record<string, unknown> = {
			name,
			...registrationData,
			passwordHash: await hashPassword(password),
			role,
			adminRoleTitle: role === 'admin' ? 'Platform Administrator' : role === 'subadmin' ? 'Operations Sub-Admin' : 'Employee (Pending Role Assignment)',
			isApproved,
			approvalStatus,
			isBlocked: false,
			permissions: role === 'admin' ? ['*'] : role === 'subadmin' ? ['orders_manage'] : [],
			...(adminId ? { adminId } : {}),
			...(subadminId ? { subadminId } : {}),
			...(employeeId ? { employeeId } : {}),
		};

		const employee = await Employee.create(employeePayload);
		await getOrCreateUserWallet(String(employee._id), employee.role, employee.name).catch(() => {});

		await Notification.create({
			userId: String(employee._id),
			role: employee.role,
			title: 'Welcome to Tomato',
			message: isEmployee
				? 'Your employee registration has been submitted and is pending administrator approval and role assignment.'
				: `Your ${employee.role} account is ready.`,
			type: 'service',
		});

		const empEmail = employee.email || email;
		if (empEmail) {
			mailService.sendWelcomeAccountMail({
				userEmail: empEmail,
				userName: employee.name,
				role: employee.role,
				accountId: employee.adminId || employee.subadminId || employee.employeeId,
				phone: employee.phone,
				isApproved,
				loginUrl: `${getPublicBaseUrl()}`,
			}).catch((err) => console.error('[Auth] Failed to send employee welcome mail:', err));
		}

		const { token, session } = await createSession(employee as any, req);
		return res.status(201).json({
			token,
			user: userResponse(employee as any),
			session: { sessionId: session.sessionId, expiresAt: session.expiresAt },
			message: isEmployee
				? 'Employee registration submitted successfully. Awaiting administrator approval and role assignment.'
				: 'Registration successful',
		});
	} catch (error) {
		console.error('Registration failed:', error);
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
			return res.status(409).json({ message: 'An account with that email or mobile number already exists' });
		}
		return res.status(500).json({ message: 'Unable to register' });
	}
};

export const loginUser = async (req: Request, res: Response) => {
	const rawValue = typeof req.body?.identifier === 'string'
		? req.body.identifier.trim()
		: typeof req.body?.email === 'string'
			? req.body.email.trim()
			: typeof req.body?.phone === 'string'
				? req.body.phone.trim()
				: '';
	const password = typeof req.body?.password === 'string' ? req.body.password : '';

	if (!rawValue || !password) {
		return res.status(400).json({ message: 'Email or mobile number and password are required' });
	}

	// 0. Check password guessing lockout status
	const lockoutCheck = credentialAttemptTracker.isLockedOut(rawValue);
	if (lockoutCheck.locked) {
		logSecurityEvent({
			eventType: 'AUTH_LOGIN_FAILURE',
			severity: 'WARN',
			identifier: rawValue,
			ip: getClientIp(req),
			method: req.method,
			path: req.originalUrl || req.path,
			message: `Login rejected: Account locked (${lockoutCheck.remainingSeconds}s remaining)`,
		});
		return res.status(429).json({
			success: false,
			message: `Account temporarily locked due to multiple failed login attempts. Please try again in ${Math.ceil(lockoutCheck.remainingSeconds / 60)} minute(s).`,
			code: 'ACCOUNT_LOCKED',
			retryAfterSeconds: lockoutCheck.remainingSeconds,
		});
	}

	try {
		let user: any = null;

		// 1. Check direct username match against database records
		const escapedRaw = escapeRegex(rawValue);
		user = await (Employee as any).findOne({
			username: { $regex: new RegExp(`^${escapedRaw}$`, 'i') },
		}).select('+passwordHash');

		if (!user && rawValue.includes('@')) {
			const emailClean = rawValue.toLowerCase();
			const escaped = escapeRegex(emailClean);
			const emailQuery = { email: { $regex: new RegExp(`^${escaped}$`, 'i') } };
			user = await Customer.findOne(emailQuery).select('+passwordHash');
			if (!user) user = await Rider.findOne(emailQuery).select('+passwordHash');
			if (!user) user = await Restaurant.findOne(emailQuery).select('+passwordHash');
			if (!user) user = await Shop.findOne(emailQuery).select('+passwordHash');
			if (!user) user = await Employee.findOne(emailQuery).select('+passwordHash');
		} else if (!user) {
			const digits = rawValue.replace(/\D/g, '');
			const phoneVariants = new Set<string>();
			phoneVariants.add(rawValue);
			phoneVariants.add(rawValue.replace(/[\s()-]/g, ''));
			if (digits) {
				phoneVariants.add(digits);
				if (digits.length >= 10) {
					const last10 = digits.slice(-10);
					phoneVariants.add(last10);
					phoneVariants.add(`+91${last10}`);
					phoneVariants.add(`+91 ${last10}`);
					phoneVariants.add(`0${last10}`);
					phoneVariants.add(`91${last10}`);
				}
			}

			const phoneQuery = {
				$or: [
					{ phone: { $in: Array.from(phoneVariants) } },
					{ email: { $regex: new RegExp(`^${escapeRegex(rawValue)}$`, 'i') } },
				],
			};
			user = await Customer.findOne(phoneQuery).select('+passwordHash');
			if (!user) user = await Rider.findOne(phoneQuery).select('+passwordHash');
			if (!user) user = await Restaurant.findOne(phoneQuery).select('+passwordHash');
			if (!user) user = await Shop.findOne(phoneQuery).select('+passwordHash');
			if (!user) user = await Employee.findOne(phoneQuery).select('+passwordHash');
		}

		if (!user || !(await verifyPassword(password, user.passwordHash))) {
			const failure = credentialAttemptTracker.recordFailure(rawValue);
			logAuthEvent(false, rawValue, req, 'Invalid user credentials provided');
			if (failure.isLocked) {
				logSecurityEvent({
					eventType: 'AUTH_LOGIN_FAILURE',
					severity: 'WARN',
					identifier: rawValue,
					ip: getClientIp(req),
					method: req.method,
					path: req.originalUrl || req.path,
					message: `Account temporarily locked for ${failure.lockMinutes} minutes due to repeated failed logins`,
				});
				return res.status(429).json({
					success: false,
					message: `Too many failed login attempts. Account temporarily locked for ${failure.lockMinutes} minutes to prevent password guessing.`,
					code: 'ACCOUNT_LOCKED',
					retryAfterSeconds: failure.lockMinutes * 60,
				});
			}
			return res.status(401).json({ message: 'Invalid email, mobile number, or password' });
		}

		// Login succeeded -> reset failed attempt tracking and log security event
		credentialAttemptTracker.recordSuccess(rawValue);
		logAuthEvent(true, rawValue, req, 'User authenticated successfully', {
			userId: String(user._id || user.id),
			role: user.role,
		});

		if (user.isBlocked) {
			return res.status(403).json({ message: 'This account has been blocked by an administrator. Please contact support.' });
		}

		if (user.role === 'employee' && user.isApproved === false) {
			if ((user as any).approvalStatus === 'rejected') {
				return res.status(403).json({
					message: 'Your employee registration has been rejected by an administrator. Please contact support.',
					isApproved: false,
					approvalStatus: 'rejected',
				});
			}
			return res.status(403).json({
				message: 'Your employee account is pending approval and role assignment by an administrator. Please wait for approval before signing in.',
				isApproved: false,
				approvalStatus: 'pending',
			});
		}

		const { token, session } = await createSession(user, req);

		// Set validated HttpOnly cookies for browser performance & XSS immunity
		setAuthCookies(res, { token, sessionId: session.sessionId });

		return res.status(200).json({
			token,
			user: userResponse(user),
			session: {
				sessionId: session.sessionId,
				deviceType: session.deviceType,
				browser: session.browser,
				os: session.os,
				expiresAt: session.expiresAt,
			},
		});
	} catch (error) {
		console.error('Login failed:', error);
		return res.status(500).json({ message: 'Unable to log in' });
	}
};

/**
 * Universal Multi-Entity User Lookup for Global Authentication & Password Reset
 * Supports Customer, Restaurant, Shop, Rider, and Employee (Admin, Sub-Admin, Super Admin)
 * Matches by Entity ID (customerId, restaurantId, shopId, riderId, adminId, employeeId),
 * ObjectId, Username, Case-insensitive Email, Phone variants, or Name.
 */
export const findUserByIdentifier = async (rawValue: string) => {
	const raw = String(rawValue || '').trim().replace(/^["']|["']$/g, '');
	if (!raw) return null;

	const rawLower = raw.toLowerCase();
	const escapedRaw = escapeRegex(raw);
	const regex = new RegExp(`^${escapedRaw}$`, 'i');

	// 0. Super Admin & Platform Admin Keywords & Aliases Lookup
	const superAdminEmail = (process.env.SUPERADMIN_EMAIL || 'lightbits.infotech@gmail.com').toLowerCase().trim();
	const smtpUser = (process.env.SMTP_USER || '').toLowerCase().trim();
	const isSuperAdminKeyword = [
		'super',
		'superadmin',
		'super admin',
		'super_admin',
		'super-admin',
		'superadministrator',
		'super administrator',
		'super@tomato.com',
		'superadmin@tomato.com',
		'superadmin@gmail.com',
		'sup-0001',
	].includes(rawLower) || rawLower === superAdminEmail || (smtpUser && rawLower === smtpUser);

	if (isSuperAdminKeyword) {
		let superUser: any = await Employee.findOne({
			$or: [
				{ role: 'superadmin' },
				{ username: 'super' },
				{ email: superAdminEmail },
				{ adminId: 'SUP-0001' },
			],
		}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');

		if (superUser) {
			if (!superUser.email && superAdminEmail) {
				superUser.email = superAdminEmail;
				await superUser.save().catch(() => {});
			}
			return superUser;
		}
	}

	if (['admin', 'administrator', 'platform admin', 'platform administrator'].includes(rawLower)) {
		const adminUser: any = await Employee.findOne({
			$or: [
				{ role: 'admin' },
				{ adminId: 'ADM-1001' },
			],
		}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (adminUser) return adminUser;
	}

	// 1. Direct specific Entity IDs, Username & Role lookup
	let user: any = await Customer.findOne({ customerId: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	if (!user) user = await Restaurant.findOne({ restaurantId: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	if (!user) user = await Shop.findOne({ shopId: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	if (!user) user = await Rider.findOne({ riderId: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	if (!user) {
		user = await Employee.findOne({
			$or: [
				{ username: regex },
				{ adminId: regex },
				{ subadminId: regex },
				{ employeeId: regex },
				{ role: regex },
				{ adminRoleTitle: regex },
			],
		}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	}

	// 2. Direct ObjectId match if rawValue is a 24-character hex ObjectId
	if (!user && mongoose.isValidObjectId(raw)) {
		const objId = new mongoose.Types.ObjectId(raw);
		user = await Employee.findById(objId).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Customer.findById(objId).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Restaurant.findById(objId).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Shop.findById(objId).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Rider.findById(objId).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	}

	// 3. Email match (case-insensitive across all models, Employee checked first)
	if (!user && raw.includes('@')) {
		const emailClean = rawLower;
		const emailRegex = new RegExp(`^${escapeRegex(emailClean)}$`, 'i');
		const emailQuery = { email: emailRegex };
		user = await Employee.findOne(emailQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Customer.findOne(emailQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Rider.findOne(emailQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Restaurant.findOne(emailQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Shop.findOne(emailQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	}

	// 4. Phone variants match
	if (!user) {
		const digits = raw.replace(/\D/g, '');
		const phoneVariants = new Set<string>();
		phoneVariants.add(raw);
		phoneVariants.add(raw.replace(/[\s()-]/g, ''));
		if (digits) {
			phoneVariants.add(digits);
			if (digits.length >= 10) {
				const last10 = digits.slice(-10);
				phoneVariants.add(last10);
				phoneVariants.add(`+91${last10}`);
				phoneVariants.add(`+91 ${last10}`);
				phoneVariants.add(`0${last10}`);
				phoneVariants.add(`91${last10}`);
			}
		}

		const phoneQuery = {
			$or: [
				{ phone: { $in: Array.from(phoneVariants) } },
				{ email: regex },
			],
		};
		user = await Employee.findOne(phoneQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Customer.findOne(phoneQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Rider.findOne(phoneQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Restaurant.findOne(phoneQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Shop.findOne(phoneQuery).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	}

	// 5. Fallback by name / username
	if (!user) {
		user = await Employee.findOne({ name: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Customer.findOne({ name: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Restaurant.findOne({ name: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Shop.findOne({ name: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		if (!user) user = await Rider.findOne({ name: regex }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
	}

	return user;
};

export const requestPasswordReset = async (req: Request, res: Response) => {
	const rawValue = typeof req.body?.identifier === 'string'
		? req.body.identifier.trim()
		: typeof req.body?.email === 'string'
			? req.body.email.trim()
			: typeof req.body?.phone === 'string'
				? req.body.phone.trim()
				: '';

	if (!rawValue) {
		return res.status(400).json({ message: 'Email, mobile number, username, or account ID is required' });
	}

	try {
		const user = await findUserByIdentifier(rawValue);

		if (!user) {
			return res.status(404).json({ message: 'No account found matching that email, phone, username, or account ID' });
		}

		// Ensure superadmin has email populated if missing
		if (user.role === 'superadmin' && !user.email) {
			user.email = (process.env.SUPERADMIN_EMAIL || process.env.SMTP_USER || 'lightbits.infotech@gmail.com').trim().toLowerCase();
			await user.save().catch(() => {});
		}

		// Allow linking an email if user profile has no email and client supplied one
		if (!user.email && typeof req.body?.email === 'string' && req.body.email.includes('@')) {
			user.email = req.body.email.trim().toLowerCase();
			await user.save();
		}

		// Helper to mask email for user security in responses (e.g. li***ch@gmail.com)
		const maskEmail = (em: string) => {
			const [userPart, domain] = em.split('@');
			if (!userPart || !domain) return em;
			if (userPart.length <= 3) return `${userPart[0]}***@${domain}`;
			return `${userPart.slice(0, 2)}***${userPart.slice(-2)}@${domain}`;
		};

		// Generate cryptographically secure 6-digit random number
		const sixDigitCode = randomInt(100000, 1000000).toString();
		user.resetPasswordTokenHash = hashResetToken(sixDigitCode);
		// Validity: 10 minutes
		user.resetPasswordExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
		await user.save();

		// Log security event (without logging the code or token)
		logSecurityEvent({
			eventType: 'PASSWORD_RESET_REQUESTED',
			severity: 'INFO',
			identifier: rawValue,
			ip: getClientIp(req),
			method: req.method,
			path: req.originalUrl || req.path,
			message: 'Password reset code generated and dispatched',
		});

		// Construct secure frontend reset URL
		const frontendOrigin = req.headers.origin || req.headers.referer || process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
		const cleanFrontendUrl = String(frontendOrigin).replace(/\/$/, '');
		const resetUrl = `${cleanFrontendUrl}/index.html?action=reset-password&token=${sixDigitCode}`;

		// Dispatch secure password reset email with 6-digit code
		const recipientEmail = user.email || (rawValue.includes('@') ? rawValue : undefined);
		let emailDelivered = false;
		if (recipientEmail) {
			try {
				const mailResult = await mailService.sendPasswordResetMail({
					customerEmail: recipientEmail,
					customerName: user.name || (user.displayName || 'Tomato User'),
					resetToken: sixDigitCode,
					resetUrl,
					expiresInMinutes: 10,
				});
				emailDelivered = Boolean(mailResult.success);
			} catch (err: any) {
				console.error('[Mail Service] Password reset mail error:', err?.message || err);
			}
		}

		const displayEmail = recipientEmail ? maskEmail(recipientEmail) : null;

		return res.status(200).json({
			message: recipientEmail
				? `A 6-digit verification code has been sent to your registered email (${displayEmail}). It is valid for 10 minutes.`
				: 'A 6-digit verification code has been generated. It is valid for 10 minutes.',
			emailSent: emailDelivered,
			targetEmail: recipientEmail,
			maskedEmail: displayEmail,
			expiresInMinutes: 10,
		});
	} catch (error) {
		console.error('Password reset request failed:', error);
		return res.status(500).json({ message: 'Unable to start password reset' });
	}
};

export const verifyResetCode = async (req: Request, res: Response) => {
	const rawToken = req.body?.resetToken || req.body?.token || req.body?.code;
	const token = typeof rawToken === 'string' ? rawToken.trim() : '';

	if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
		return res.status(400).json({ valid: false, message: 'A 6-digit verification code is required.' });
	}

	try {
		const hashed = hashResetToken(token);
		const filter = {
			resetPasswordTokenHash: hashed,
			resetPasswordExpiresAt: { $gt: new Date() },
		};

		let user: any = await Customer.findOne(filter).select('_id name email');
		if (!user) user = await Rider.findOne(filter).select('_id name email');
		if (!user) user = await Restaurant.findOne(filter).select('_id name email');
		if (!user) user = await Shop.findOne(filter).select('_id name email');
		if (!user) user = await Employee.findOne(filter).select('_id name email');

		if (!user) {
			return res.status(400).json({
				valid: false,
				message: 'Invalid or expired 6-digit verification code. Please request a new code.',
			});
		}

		return res.status(200).json({
			valid: true,
			message: 'Verification code confirmed.',
		});
	} catch (error) {
		console.error('Password reset code verification failed:', error);
		return res.status(500).json({ valid: false, message: 'Unable to verify verification code.' });
	}
};

export const resetPassword = async (req: Request, res: Response) => {
	const rawToken = req.body?.resetToken || req.body?.token || req.body?.code;
	const token = typeof rawToken === 'string' ? rawToken.trim() : '';
	const rawPassword = req.body?.password || req.body?.newPassword;
	const password = typeof rawPassword === 'string' ? rawPassword : '';

	if (!token || !password) {
		return res.status(400).json({ message: '6-digit verification code and new password are required' });
	}

	if (password.length < 8) {
		return res.status(400).json({ message: 'Password must be at least 8 characters' });
	}

	try {
		let user: any = await Customer.findOne({
			resetPasswordTokenHash: hashResetToken(token),
			resetPasswordExpiresAt: { $gt: new Date() },
		}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');

		if (!user) {
			user = await Rider.findOne({
				resetPasswordTokenHash: hashResetToken(token),
				resetPasswordExpiresAt: { $gt: new Date() },
			}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		}

		if (!user) {
			user = await Restaurant.findOne({
				resetPasswordTokenHash: hashResetToken(token),
				resetPasswordExpiresAt: { $gt: new Date() },
			}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		}

		if (!user) {
			user = await Shop.findOne({
				resetPasswordTokenHash: hashResetToken(token),
				resetPasswordExpiresAt: { $gt: new Date() },
			}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		}

		if (!user) {
			user = await Employee.findOne({
				resetPasswordTokenHash: hashResetToken(token),
				resetPasswordExpiresAt: { $gt: new Date() },
			}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		}

		if (!user) {
			logSecurityEvent({
				eventType: 'PASSWORD_RESET_FAILED',
				severity: 'WARN',
				ip: getClientIp(req),
				method: req.method,
				path: req.originalUrl || req.path,
				message: 'Password reset attempted with invalid or expired 6-digit verification code',
			});
			return res.status(400).json({ message: 'Invalid or expired 6-digit verification code. Please request a new code.' });
		}

		user.passwordHash = await hashPassword(password);
		user.set('resetPasswordTokenHash', undefined);
		user.set('resetPasswordExpiresAt', undefined);
		await user.save();

		// Revoke all existing sessions across devices on password reset
		await revokeAllUserSessions(String(user._id), 'password_reset').catch(() => {});

		logSecurityEvent({
			eventType: 'PASSWORD_RESET_SUCCESS',
			severity: 'INFO',
			identifier: user.email || user.username || String(user._id),
			userId: String(user._id),
			ip: getClientIp(req),
			method: req.method,
			path: req.originalUrl || req.path,
			message: 'Password reset successfully completed and active sessions revoked',
		});

		// Send password changed security alert email
		if (user.email) {
			mailService.sendPasswordChangedMail({
				customerEmail: user.email,
				customerName: user.name || 'Tomato User',
				changedAt: new Date(),
			}).catch((err) => console.error('[Mail Service] Password changed alert error:', err));
		}

		return res.status(200).json({ message: 'Password reset successful' });
	} catch (error) {
		console.error('Password reset failed:', error);
		return res.status(500).json({ message: 'Unable to reset password' });
	}
};

/**
 * Authenticated Password Change
 * Allows any logged-in user (Customer, Restaurant, Shop, Rider, Employee/Admin)
 * to update their password from their profile/dashboard settings.
 */
export const changePassword = async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.user?.userId;
	if (!userId) {
		return res.status(401).json({ message: 'Authentication required' });
	}

	const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
	const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

	if (!currentPassword || !newPassword) {
		return res.status(400).json({ message: 'Current password and new password are required' });
	}

	if (newPassword.length < 8) {
		return res.status(400).json({ message: 'New password must be at least 8 characters long' });
	}

	try {
		let user: any = null;
		if (mongoose.isValidObjectId(userId)) {
			const objId = new mongoose.Types.ObjectId(userId);
			user = await Customer.findById(objId).select('+passwordHash');
			if (!user) user = await Rider.findById(objId).select('+passwordHash');
			if (!user) user = await Restaurant.findById(objId).select('+passwordHash');
			if (!user) user = await Shop.findById(objId).select('+passwordHash');
			if (!user) user = await Employee.findById(objId).select('+passwordHash');
		}

		if (!user) {
			return res.status(404).json({ message: 'User account not found' });
		}

		const isValid = await verifyPassword(currentPassword, user.passwordHash);
		if (!isValid) {
			logSecurityEvent({
				eventType: 'PASSWORD_RESET_FAILED',
				severity: 'WARN',
				userId: String(userId),
				ip: getClientIp(req),
				method: req.method,
				path: req.originalUrl || req.path,
				message: 'Password change failed: Current password incorrect',
			});
			return res.status(400).json({ message: 'Current password is incorrect' });
		}

		user.passwordHash = await hashPassword(newPassword);
		user.set('resetPasswordTokenHash', undefined);
		user.set('resetPasswordExpiresAt', undefined);
		await user.save();

		// Revoke other active sessions across devices
		await revokeAllUserSessions(String(user._id), 'password_change').catch(() => {});

		logSecurityEvent({
			eventType: 'PASSWORD_CHANGED',
			severity: 'INFO',
			userId: String(userId),
			identifier: user.email || user.username || String(user._id),
			ip: getClientIp(req),
			method: req.method,
			path: req.originalUrl || req.path,
			message: 'Password updated successfully via authenticated settings',
		});

		if (user.email) {
			mailService.sendPasswordChangedMail({
				customerEmail: user.email,
				customerName: user.name || (user.displayName || 'Tomato User'),
				changedAt: new Date(),
			}).catch(() => {});
		}

		return res.status(200).json({ message: 'Password changed successfully' });
	} catch (error) {
		console.error('Change password failed:', error);
		return res.status(500).json({ message: 'Unable to change password' });
	}
};

export const updateProfile = async (req: AuthenticatedRequest & { file?: Express.Multer.File | undefined }, res: Response) => {
	const userId = req.user?.userId;
	if (!userId) {
		return res.status(401).json({ message: 'Authentication required' });
	}

	const nextName = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
	const nextEmailRaw = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
	const nextPhoneRaw = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
	const uploadedFile = req.file?.filename ? `${getPublicBaseUrl()}/uploads/${req.file.filename}` : undefined;
	const nextImage = typeof req.body?.image === 'string' ? req.body.image.trim() : uploadedFile;
	const nextEmail = nextEmailRaw ? normalizeEmail(nextEmailRaw) : undefined;
	const nextPhone = nextPhoneRaw ? normalizePhone(nextPhoneRaw) : undefined;
	const nextAddress = typeof req.body?.restaurantAddress === 'string'
		? req.body.restaurantAddress.trim()
		: typeof req.body?.shopAddress === 'string'
			? req.body.shopAddress.trim()
			: typeof req.body?.address === 'string'
				? req.body.address.trim()
				: undefined;
	const nextPincode = typeof req.body?.pincode === 'string' ? req.body.pincode.trim() : undefined;
	const nextCuisine = typeof req.body?.cuisine === 'string'
		? req.body.cuisine.trim()
		: typeof req.body?.category === 'string'
			? req.body.category.trim()
			: undefined;
	const nextVehicle = typeof req.body?.deliveryVehicle === 'string' ? req.body.deliveryVehicle.trim() : undefined;
	const nextDob = typeof req.body?.dob === 'string' ? req.body.dob.trim() : undefined;
	const nextGsn = typeof req.body?.gsnNumber === 'string'
		? (req.body.gsnNumber.trim().toUpperCase() || 'NA')
		: undefined;
	const nextDigipin = typeof req.body?.digipin === 'string'
		? req.body.digipin.trim().toUpperCase()
		: undefined;
	const nextCity = typeof req.body?.city === 'string'
		? req.body.city.trim()
		: undefined;

	if (!nextName && !nextEmail && !nextPhone && !nextImage && !nextAddress && nextPincode === undefined && !nextCuisine && !nextVehicle && nextDob === undefined && nextGsn === undefined && nextDigipin === undefined && nextCity === undefined) {
		return res.status(400).json({
			message: 'No profile changes provided',
		});
	}

	if (nextPhone && !isPhone(nextPhone)) {
		return res.status(400).json({ message: 'Enter a valid mobile number' });
	}

	try {
		const updates: Record<string, unknown> = {};
		if (nextName) updates.name = nextName;
		if (nextEmail) updates.email = nextEmail;
		if (nextPhone) updates.phone = nextPhone;
		if (nextImage) updates.image = nextImage;
		if (nextDob !== undefined) updates.dob = nextDob;
		if (nextGsn !== undefined) updates.gsnNumber = nextGsn;
		if (nextDigipin !== undefined) updates.digipin = nextDigipin;
		if (nextCity !== undefined) updates.city = nextCity;
		if (nextAddress !== undefined) {
			updates.restaurantAddress = nextAddress;
			updates.shopAddress = nextAddress;
			updates.address = nextAddress;
		}
		if (nextPincode !== undefined || nextAddress !== undefined) {
			const resolvedPin = extractPincodeFromText(nextPincode || nextAddress || '');
			if (resolvedPin) {
				updates.pincode = resolvedPin;
				updates.postalCode = resolvedPin;
			} else if (nextPincode !== undefined) {
				updates.pincode = nextPincode;
				updates.postalCode = nextPincode;
			}
		}
		if (nextCuisine !== undefined) {
			updates.cuisine = nextCuisine;
			updates.category = nextCuisine;
		}
		if (nextVehicle !== undefined) updates.deliveryVehicle = nextVehicle;

		const userRole = req.user?.role;
		if ((userRole === 'restaurant' || userRole === 'shop') && updates.pincode !== undefined) {
			const serviceable = await getServiceablePincodes();
			if (!updates.pincode || !serviceable.includes(String(updates.pincode))) {
				updates.isApproved = false;
			}
		}

		const duplicateFilter = {
			$and: [
				{ _id: { $ne: userId } },
				{
					$or: [
						...(nextEmail ? [{ email: nextEmail }] : []),
						...(nextPhone ? [{ phone: nextPhone }] : []),
					],
				},
			],
		};

		const [dupEmp, dupRest, dupCust, dupRider, dupShop] = await Promise.all([
			nextEmail || nextPhone ? Employee.findOne(duplicateFilter) : null,
			nextEmail || nextPhone ? Restaurant.findOne(duplicateFilter) : null,
			nextEmail || nextPhone ? Customer.findOne(duplicateFilter) : null,
			nextEmail || nextPhone ? Rider.findOne(duplicateFilter) : null,
			nextEmail || nextPhone ? Shop.findOne(duplicateFilter) : null,
		]);

		if (dupEmp || dupRest || dupCust || dupRider || dupShop) {
			return res.status(409).json({ message: 'An account with that email or mobile number already exists' });
		}

		let user: any = null;
		if (userRole === 'restaurant') {
			user = await Restaurant.findByIdAndUpdate(
				userId,
				updates,
				{ returnDocument: 'after', runValidators: true },
			).lean();
		} else if (userRole === 'shop') {
			user = await Shop.findByIdAndUpdate(
				userId,
				updates,
				{ returnDocument: 'after', runValidators: true },
			).lean();
		} else if (userRole === 'customer') {
			user = await Customer.findByIdAndUpdate(
				userId,
				updates,
				{ returnDocument: 'after', runValidators: true },
			).lean();
		} else if (userRole === 'deliveryPartner' || (userRole as string) === 'rider') {
			if (updates.pincode || updates.address || updates.city) {
				const pin = String(updates.pincode || '');
				const addr = String(updates.address || '');
				const city = String(updates.city || 'Bengaluru');
				updates.assignedLocation = {
					postalCode: pin,
					locality: addr,
					city: city,
				};
			}
			user = await Rider.findByIdAndUpdate(
				userId,
				updates,
				{ returnDocument: 'after', runValidators: true },
			).lean();
		} else {
			user = await Employee.findByIdAndUpdate(
				userId,
				updates,
				{ returnDocument: 'after', runValidators: true },
			).lean();
		}

		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		if (updates.pincode) {
			await Address.updateMany(
				{ userId: String(userId) },
				{ $set: { postalCode: String(updates.pincode) } },
			).catch(() => {});
		}

		return res.status(200).json({
			message: 'Profile updated successfully',
			user: userResponse(user as any),
		});
	} catch (error) {
		console.error('Profile update failed:', error);
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
			return res.status(409).json({ message: 'An account with that email or mobile number already exists' });
		}
		return res.status(500).json({ message: 'Unable to update profile' });
	}
};

export const logoutUser = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const sessionId = req.user?.sessionId;
		if (sessionId) {
			await revokeSession(sessionId, 'user_logout');
		}
		clearAuthCookies(res);
		return res.status(200).json({ message: 'Signed out successfully' });
	} catch (error) {
		console.error('Logout failed:', error);
		return res.status(500).json({ message: 'Unable to sign out' });
	}
};

export const logoutAllSessions = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const userId = req.user?.userId;
		if (!userId) {
			return res.status(401).json({ message: 'Authentication required' });
		}
		const count = await revokeAllUserSessions(userId, 'user_logout_all');
		clearAuthCookies(res);
		return res.status(200).json({ message: `Successfully signed out of ${count} active session(s)` });
	} catch (error) {
		console.error('Logout all sessions failed:', error);
		return res.status(500).json({ message: 'Unable to sign out of all sessions' });
	}
};

export const getActiveSessions = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const userId = req.user?.userId;
		if (!userId) {
			return res.status(401).json({ message: 'Authentication required' });
		}
		const sessions = await getUserActiveSessions(userId, req.user?.sessionId);
		return res.status(200).json({ sessions });
	} catch (error) {
		console.error('Get active sessions failed:', error);
		return res.status(500).json({ message: 'Unable to retrieve active sessions' });
	}
};

export const revokeSingleSession = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const userId = req.user?.userId;
		const rawSessionId = req.params.sessionId;
		const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
		if (!userId) {
			return res.status(401).json({ message: 'Authentication required' });
		}
		if (!sessionId || typeof sessionId !== 'string') {
			return res.status(400).json({ message: 'Session ID is required' });
		}

		const sessions = await getUserActiveSessions(userId);
		const targetSession = sessions.find((s) => s.sessionId === sessionId);
		if (!targetSession) {
			return res.status(404).json({ message: 'Session not found or already expired' });
		}

		await revokeSession(sessionId, 'user_revoked');
		return res.status(200).json({ message: 'Session revoked successfully' });
	} catch (error) {
		console.error('Revoke session failed:', error);
		return res.status(500).json({ message: 'Unable to revoke session' });
	}
};
