import { Request, Response } from 'express';
import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import User from '../model/User.js';

const scrypt = promisify(scryptCallback);

const hashPassword = async (password: string) => {
	const salt = randomBytes(16).toString('hex');
	const derivedKey = await scrypt(password, salt, 64) as Buffer;
	return `${salt}:${derivedKey.toString('hex')}`;
};

const verifyPassword = async (password: string, storedHash: string) => {
	const [salt, key] = storedHash.split(':');
	if (!salt || !key) {
		return false;
	}

	const derivedKey = await scrypt(password, salt, 64) as Buffer;
	const storedKey = Buffer.from(key, 'hex');
	return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
};

const normalizePhone = (value: string) => value.replace(/[\s()-]/g, '');
const isPhone = (value: string) => /^\+?[1-9]\d{9,14}$/.test(value);
const getIdentifier = (body: Request['body']) => {
	const value = typeof body?.identifier === 'string'
		? body.identifier.trim()
		: typeof body?.email === 'string'
			? body.email.trim()
			: typeof body?.phone === 'string'
				? body.phone.trim()
				: '';
	const normalized = value.includes('@') ? value.toLowerCase() : normalizePhone(value);
	return { value: normalized, field: normalized.includes('@') ? 'email' : 'phone' as const };
};

const createToken = (user: { _id: { toString: () => string }; email?: string; phone?: string; role: string }) => {
	const jwtSecret = process.env.JWT_SECRET;
	if (!jwtSecret) {
		throw new Error('JWT_SECRET is not configured');
	}

	return jwt.sign(
		{ userId: user._id.toString(), email: user.email, phone: user.phone, role: user.role },
		jwtSecret,
		{ expiresIn: '1h' },
	);
};

const userResponse = (user: { _id: unknown; name: string; email?: string; phone?: string; image: string; role: string }) => ({
	id: user._id,
	name: user.name,
	email: user.email,
	phone: user.phone,
	image: user.image,
	role: user.role,
});

export const registerUser = async (req: Request, res: Response) => {
	const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
	const identifier = getIdentifier(req.body);
	const password = typeof req.body?.password === 'string' ? req.body.password : '';

	if (!name || !identifier.value || !password) {
		return res.status(400).json({ message: 'Name, email or mobile number, and password are required' });
	}

	if (password.length < 8) {
		return res.status(400).json({ message: 'Password must be at least 8 characters' });
	}

	if (identifier.field === 'phone' && !isPhone(identifier.value)) {
		return res.status(400).json({ message: 'Enter a valid mobile number' });
	}

	try {
		if (await User.exists({ [identifier.field]: identifier.value })) {
			return res.status(409).json({ message: 'An account with that email or mobile number already exists' });
		}

		const user = await User.create({
			name,
			[identifier.field]: identifier.value,
			passwordHash: await hashPassword(password),
			role: 'customer',
		});
		return res.status(201).json({ token: createToken(user), user: userResponse(user) });
	} catch (error) {
		console.error('Registration failed:', error);
		return res.status(500).json({ message: 'Unable to register' });
	}
};

export const loginUser = async (req: Request, res: Response) => {
	const identifier = getIdentifier(req.body);
	const password = typeof req.body?.password === 'string' ? req.body.password : '';

	if (!identifier.value || !password) {
		return res.status(400).json({ message: 'Email or mobile number and password are required' });
	}

	if (identifier.field === 'phone' && !isPhone(identifier.value)) {
		return res.status(400).json({ message: 'Enter a valid mobile number' });
	}

	try {
		const user = await User.findOne({ [identifier.field]: identifier.value }).select('+passwordHash');

		if (!user || !(await verifyPassword(password, user.passwordHash))) {
			return res.status(401).json({ message: 'Invalid email, mobile number, or password' });
		}

		return res.status(200).json({ token: createToken(user), user: userResponse(user) });
	} catch (error) {
		console.error('Login failed:', error);
		return res.status(500).json({ message: 'Unable to log in' });
	}
};