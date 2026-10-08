import { Request, Response } from 'express';
import { promisify } from 'node:util';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Employee, { IEmployee, USER_ROLES, UserRole } from '../../model/Employee.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Customer, { ICustomer } from '../../model/Customer.js';
import Rider, { IRider } from '../../model/Rider.js';
import Notification from '../../model/Notification.js';
import Counter, { getNextCounterValue, generateIdFromCounter } from '../../model/Counter.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

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

export const generateAdminId = (): Promise<string> =>
	generateIdFromCounter('adminId', 'adm', 1000, async (id: string) =>
		Boolean(await Employee.exists({ adminId: { $in: [id, id.toUpperCase()] } })),
	);

export const createToken = (user: {
	_id: { toString: () => string };
	email?: string;
	phone?: string;
	role: string;
	permissions?: string[];
	adminRoleTitle?: string;
	restaurantId?: string;
	riderId?: string;
	customerId?: string;
	subadminId?: string;
	adminId?: string;
}) => {
	const jwtSecret = process.env.JWT_SECRET || 'tomato-local-development-secret';

	return jwt.sign(
		{
			userId: user._id.toString(),
			id: user._id.toString(),
			_id: user._id.toString(),
			email: user.email,
			phone: user.phone,
			role: user.role,
			permissions: user.permissions || [],
			adminRoleTitle: user.adminRoleTitle || '',
			restaurantId: formatUserId(user.restaurantId),
			riderId: formatUserId(user.riderId),
			customerId: formatUserId(user.customerId),
			subadminId: formatUserId(user.subadminId),
			adminId: formatUserId((user as any).adminId),
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
	riderId?: string;
	customerId?: string;
	subadminId?: string;
	adminId?: string;
	digipin?: string;
	restaurantAddress?: string;
	restaurantLocation?: { lat: number; lng: number };
	cuisine?: string;
	deliveryVehicle?: string;
	currentLocation?: { lat: number; lng: number };
	isOnline?: boolean;
	isOpen?: boolean;
	lastLocationUpdated?: Date;
	permissions?: string[];
	adminRoleTitle?: string;
	createdBy?: string;
}) => {
	const rawCustomerId = user.customerId || (user.role === 'customer' ? `cust-${String(user._id).slice(-4).toLowerCase()}` : '');
	const rawSubadminId = user.subadminId || (user.role === 'subadmin' ? `sub-${String(user._id).slice(-4).toLowerCase()}` : '');
	const rawAdminId = (user as any).adminId || (user.role === 'admin' ? ((user as any).adminId || `adm-${String(user._id).slice(-4).toLowerCase()}`) : '');
	const rawRestaurantId = user.restaurantId || (user.role === 'restaurant' ? `rest-${String(user._id).slice(-4).toLowerCase()}` : '');
	const rawRiderId = user.riderId || (user.role === 'deliveryPartner' || (user.role as string) === 'rider' ? `ride-${String(user._id).slice(-4).toLowerCase()}` : '');

	const customerId = formatUserId(rawCustomerId);
	const subadminId = formatUserId(rawSubadminId);
	const adminId = formatUserId(rawAdminId);
	const restaurantId = formatUserId(rawRestaurantId);
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
		image: user.image || '',
		role: user.role,
		isApproved: user.isApproved ?? true,
		isBlocked: user.isBlocked ?? false,
		...(user.role === 'admin'
			? {}
			: {
				walletBalance: user.walletBalance ?? 0,
				creditPoint: user.creditPoint ?? 0,
			}),
		restaurantId,
		riderId,
		customerId,
		subadminId,
		adminId,
		digipin: user.digipin || '',
		restaurantAddress: user.restaurantAddress || '',
		restaurantLocation: user.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
		cuisine: user.cuisine || '',
		deliveryVehicle: user.deliveryVehicle || '',
		currentLocation: user.currentLocation || { lat: 12.9716, lng: 77.5946 },
		isOnline: user.isOnline ?? true,
		isOpen: user.isOpen ?? true,
		lastLocationUpdated: user.lastLocationUpdated || new Date(),
		permissions: user.permissions || [],
		adminRoleTitle: user.adminRoleTitle || '',
		createdBy: user.createdBy || '',
	};
};

export const registerUser = async (req: Request, res: Response) => {
	const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
	const registrationData = getRegistrationPayload(req.body);
	const password = typeof req.body?.password === 'string' ? req.body.password : '';
	const requestedRole = typeof req.body?.role === 'string' ? req.body.role : 'customer';

	if (requestedRole === 'subadmin') {
		return res.status(403).json({ message: 'Sub-admin accounts can only be created by an administrator' });
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

	// Validate restaurant location or DIGIPIN at registration
	let restaurantLocation: { lat: number; lng: number } = { lat: 12.9716, lng: 77.5946 };
	let digipin = typeof req.body?.digipin === 'string' ? req.body.digipin.trim().toUpperCase() : '';
	const rawLat = req.body?.restaurantLocation?.lat ?? req.body?.lat;
	const rawLng = req.body?.restaurantLocation?.lng ?? req.body?.lng;
	const hasCoords = rawLat !== undefined && rawLng !== undefined && !isNaN(Number(rawLat)) && !isNaN(Number(rawLng));

	if (role === 'restaurant') {
		if (!digipin && !hasCoords) {
			return res.status(400).json({
				message: 'Restaurant pickup location is required. Please share current GPS coordinates or DIGIPIN.',
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

		const [existingEmployee, existingRestaurant, existingCustomer, existingRider] = await Promise.all([
			Employee.findOne(duplicateQuery),
			Restaurant.findOne(duplicateQuery),
			Customer.findOne(duplicateQuery),
			Rider.findOne(duplicateQuery),
		]);

		if (existingEmployee || existingRestaurant || existingCustomer || existingRider) {
			return res.status(409).json({ message: 'An account with that email or mobile number already exists' });
		}

		if (role === 'restaurant') {
			const restaurantId = await generateRestaurantId();
			const restaurantPayload: Record<string, unknown> = {
				name,
				passwordHash: await hashPassword(password),
				role: 'restaurant',
				isApproved: false,
				isBlocked: false,
				restaurantId,
				digipin,
				restaurantAddress: typeof req.body?.restaurantAddress === 'string' ? req.body.restaurantAddress.trim() : '',
				restaurantLocation,
				cuisine: typeof req.body?.cuisine === 'string' ? req.body.cuisine.trim() : 'Multi-cuisine',
				isOpen: true,
				isOnline: true,
			};
			if (email) restaurantPayload.email = email;
			if (phone) restaurantPayload.phone = phone;

			const restaurant = await Restaurant.create(restaurantPayload) as unknown as IRestaurant;

			await Notification.create({
				userId: String(restaurant._id),
				role: 'restaurant',
				title: 'Welcome to Tomato',
				message: `Your restaurant registration (${restaurant.name}) has been submitted and is pending admin approval.`,
				type: 'service',
			});

			return res.status(201).json({
				token: createToken(restaurant as any),
				user: userResponse(restaurant as any),
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

			await Notification.create({
				userId: String(customer._id),
				role: 'customer',
				title: 'Welcome to Tomato',
				message: `Your customer account (${customer.name}) is ready. Service updates will appear here.`,
				type: 'service',
			});

			return res.status(201).json({
				token: createToken(customer as any),
				user: userResponse(customer as any),
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

			await Notification.create({
				userId: String(rider._id),
				role: 'deliveryPartner',
				title: 'Welcome to Tomato',
				message: `Your delivery partner registration (${rider.name}) has been submitted and is pending admin approval.`,
				type: 'service',
			});

			return res.status(201).json({
				token: createToken(rider as any),
				user: userResponse(rider as any),
				message: 'Registration received. Awaiting admin approval.',
			});
		}

		const isApproved = true;
		const adminId = role === 'admin' ? await generateAdminId() : undefined;
		const subadminId = role === 'subadmin' ? await generateSubAdminId() : undefined;
		const employeePayload: Record<string, unknown> = {
			name,
			...registrationData,
			passwordHash: await hashPassword(password),
			role,
			adminRoleTitle: role === 'admin' ? 'Platform Administrator' : 'Operations Sub-Admin',
			isApproved,
			isBlocked: false,
			permissions: role === 'admin' ? ['*'] : ['orders_manage'],
			...(adminId ? { adminId } : {}),
			...(subadminId ? { subadminId } : {}),
		};

		const employee = await Employee.create(employeePayload);

		await Notification.create({
			userId: String(employee._id),
			role: employee.role,
			title: 'Welcome to Tomato',
			message: `Your ${employee.role} account is ready.`,
			type: 'service',
		});

		return res.status(201).json({
			token: createToken(employee as any),
			user: userResponse(employee as any),
			message: 'Registration successful',
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

	try {
		let user: any = null;

		if (rawValue.includes('@')) {
			const emailClean = rawValue.toLowerCase();
			const escaped = emailClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const emailQuery = { email: { $regex: new RegExp(`^${escaped}$`, 'i') } };
			user = await Customer.findOne(emailQuery).select('+passwordHash');
			if (!user) user = await Rider.findOne(emailQuery).select('+passwordHash');
			if (!user) user = await Restaurant.findOne(emailQuery).select('+passwordHash');
			if (!user) user = await Employee.findOne(emailQuery).select('+passwordHash');
		} else {
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
					{ email: { $regex: new RegExp(`^${rawValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
				],
			};
			user = await Customer.findOne(phoneQuery).select('+passwordHash');
			if (!user) user = await Rider.findOne(phoneQuery).select('+passwordHash');
			if (!user) user = await Restaurant.findOne(phoneQuery).select('+passwordHash');
			if (!user) user = await Employee.findOne(phoneQuery).select('+passwordHash');
		}

		if (!user || !(await verifyPassword(password, user.passwordHash))) {
			return res.status(401).json({ message: 'Invalid email, mobile number, or password' });
		}

		if (user.isBlocked) {
			return res.status(403).json({ message: 'This account has been blocked by an administrator. Please contact support.' });
		}

		return res.status(200).json({ token: createToken(user), user: userResponse(user) });
	} catch (error) {
		console.error('Login failed:', error);
		return res.status(500).json({ message: 'Unable to log in' });
	}
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
		return res.status(400).json({ message: 'Email or mobile number is required' });
	}

	try {
		let user: any = null;
		if (rawValue.includes('@')) {
			const emailClean = rawValue.toLowerCase();
			const escaped = emailClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const emailQuery = { email: { $regex: new RegExp(`^${escaped}$`, 'i') } };
			user = await Customer.findOne(emailQuery);
			if (!user) user = await Rider.findOne(emailQuery);
			if (!user) user = await Restaurant.findOne(emailQuery);
			if (!user) user = await Employee.findOne(emailQuery);
		} else {
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
					{ email: { $regex: new RegExp(`^${rawValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
				],
			};
			user = await Customer.findOne(phoneQuery);
			if (!user) user = await Rider.findOne(phoneQuery);
			if (!user) user = await Restaurant.findOne(phoneQuery);
			if (!user) user = await Employee.findOne(phoneQuery);
		}

		if (!user) {
			return res.status(404).json({ message: 'No account found for that email or mobile number' });
		}

		const resetToken = randomBytes(32).toString('hex');
		user.resetPasswordTokenHash = hashResetToken(resetToken);
		user.resetPasswordExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
		await user.save();

		return res.status(200).json({
			message: 'Reset token created. In production, deliver this token by email or SMS.',
			resetToken,
		});
	} catch (error) {
		console.error('Password reset request failed:', error);
		return res.status(500).json({ message: 'Unable to start password reset' });
	}
};

export const resetPassword = async (req: Request, res: Response) => {
	const token = typeof req.body?.resetToken === 'string' ? req.body.resetToken.trim() : '';
	const password = typeof req.body?.password === 'string' ? req.body.password : '';

	if (!token || !password) {
		return res.status(400).json({ message: 'Reset token and new password are required' });
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
			user = await Employee.findOne({
				resetPasswordTokenHash: hashResetToken(token),
				resetPasswordExpiresAt: { $gt: new Date() },
			}).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
		}

		if (!user) {
			return res.status(400).json({ message: 'Reset token is invalid or expired' });
		}

		user.passwordHash = await hashPassword(password);
		user.set('resetPasswordTokenHash', undefined);
		user.set('resetPasswordExpiresAt', undefined);
		await user.save();

		return res.status(200).json({ message: 'Password reset successful' });
	} catch (error) {
		console.error('Password reset failed:', error);
		return res.status(500).json({ message: 'Unable to reset password' });
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
	const nextAddress = typeof req.body?.restaurantAddress === 'string' ? req.body.restaurantAddress.trim() : undefined;
	const nextCuisine = typeof req.body?.cuisine === 'string' ? req.body.cuisine.trim() : undefined;
	const nextVehicle = typeof req.body?.deliveryVehicle === 'string' ? req.body.deliveryVehicle.trim() : undefined;

	if (!nextName && !nextEmail && !nextPhone && !nextImage && !nextAddress && !nextCuisine && !nextVehicle) {
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
		if (nextAddress !== undefined) updates.restaurantAddress = nextAddress;
		if (nextCuisine !== undefined) updates.cuisine = nextCuisine;
		if (nextVehicle !== undefined) updates.deliveryVehicle = nextVehicle;

		const userRole = req.user?.role;

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

		const [dupEmp, dupRest, dupCust, dupRider] = await Promise.all([
			nextEmail || nextPhone ? Employee.findOne(duplicateFilter) : null,
			nextEmail || nextPhone ? Restaurant.findOne(duplicateFilter) : null,
			nextEmail || nextPhone ? Customer.findOne(duplicateFilter) : null,
			nextEmail || nextPhone ? Rider.findOne(duplicateFilter) : null,
		]);

		if (dupEmp || dupRest || dupCust || dupRider) {
			return res.status(409).json({ message: 'An account with that email or mobile number already exists' });
		}

		let user: any = null;
		if (userRole === 'restaurant') {
			user = await Restaurant.findByIdAndUpdate(
				userId,
				updates,
				{ new: true, runValidators: true },
			).lean();
		} else if (userRole === 'customer') {
			user = await Customer.findByIdAndUpdate(
				userId,
				updates,
				{ new: true, runValidators: true },
			).lean();
		} else if (userRole === 'deliveryPartner' || (userRole as string) === 'rider') {
			user = await Rider.findByIdAndUpdate(
				userId,
				updates,
				{ new: true, runValidators: true },
			).lean();
		} else {
			user = await Employee.findByIdAndUpdate(
				userId,
				updates,
				{ new: true, runValidators: true },
			).lean();
		}

		if (!user) {
			return res.status(404).json({ message: 'User not found' });
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
