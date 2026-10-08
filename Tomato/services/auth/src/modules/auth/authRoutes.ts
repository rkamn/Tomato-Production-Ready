import express, { Express } from 'express';
import multer from 'multer';

import {
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  updateProfile,
  userResponse,
} from './authController.js';
import {
  authenticate,
  AuthenticatedRequest,
} from '../../middleware/authenticate.js';
import Address from '../../model/Address.js';
import Customer from '../../model/Customer.js';
import Restaurant from '../../model/Restaurant.js';
import Rider from '../../model/Rider.js';
import Employee from '../../model/Employee.js';
import {
  getWalletBalances,
  WalletServiceError,
} from '../wallet/walletService.js';

const createAuthRouter = (upload: multer.Multer) => {
  const router = express.Router();

  router.post('/register', registerUser);
  router.post('/login', loginUser);
  router.get('/wallet', authenticate, async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    if (!currentUser?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      const wallet = await getWalletBalances(
        currentUser.userId,
        currentUser.role,
      );
      return res.json(wallet);
    } catch (error: any) {
      if (error instanceof WalletServiceError || error?.name === 'WalletServiceError') {
        return res.status(error.statusCode || 400).json({ message: error.message });
      }
      console.error('Wallet fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch wallet' });
    }
  });

  const parseAddressString = (rawAddress?: string) => {
    const defaultCity = 'Bengaluru';
    const defaultPincode = '560001';
    const defaultState = 'Karnataka';

    if (!rawAddress || typeof rawAddress !== 'string' || !rawAddress.trim()) {
      return {
        city: defaultCity,
        postalCode: defaultPincode,
        state: defaultState,
        locality: 'Central',
        line1: 'Bengaluru Central',
      };
    }

    const str = rawAddress.trim();
    const pincodeMatch = str.match(/\b([1-9]\d{5})\b/);
    const postalCode = pincodeMatch ? (pincodeMatch[1] ?? defaultPincode) : defaultPincode;

    const cleanStr = str.replace(/\b[1-9]\d{5}\b/g, '').replace(/[-–,]+$/, '').trim();
    const parts = cleanStr.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);

    const indianStates = new Set([
      'karnataka', 'maharashtra', 'delhi', 'tamil nadu', 'telangana', 'uttar pradesh',
      'west bengal', 'gujarat', 'kerala', 'rajasthan', 'madhya pradesh', 'punjab',
      'haryana', 'bihar', 'odisha', 'assam', 'ka', 'mh', 'dl', 'tn', 'ts', 'up', 'wb'
    ]);

    let city = '';
    let state = defaultState;
    let locality = '';

    for (let i = parts.length - 1; i >= 0; i--) {
      const part = (parts[i] ?? '').replace(/[-–]+$/, '').trim();
      if (!part) continue;
      const lower = part.toLowerCase();
      if (indianStates.has(lower) && !city) {
        state = part;
      } else if (!city) {
        city = part;
      } else if (!locality) {
        locality = part;
      }
    }

    if (!city) {
      city = defaultCity;
    }

    return {
      city,
      postalCode,
      state,
      locality: locality || (parts[0] ?? 'Central'),
      line1: str,
    };
  };

  router.get('/default-address', authenticate, async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    if (!currentUser?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      let defaultAddress: any = await Address.findOne({
        userId: currentUser.userId,
      })
        .sort({ isDefault: -1, createdAt: -1 })
        .lean();

      if (!defaultAddress) {
        if (currentUser.role === 'restaurant') {
          const rest = await Restaurant.findById(currentUser.userId).lean();
          const parsed = parseAddressString(rest?.restaurantAddress);
          defaultAddress = {
            userId: currentUser.userId,
            label: 'Restaurant Location',
            line1: rest?.restaurantAddress || parsed.line1,
            locality: parsed.locality,
            city: parsed.city,
            state: parsed.state,
            postalCode: parsed.postalCode,
            isDefault: true,
            location: {
              type: 'Point',
              coordinates: [
                rest?.restaurantLocation?.lng ?? 77.5946,
                rest?.restaurantLocation?.lat ?? 12.9716,
              ],
            },
          };
        } else if (
          currentUser.role === 'deliveryPartner' ||
          (currentUser.role as string) === 'rider'
        ) {
          const rider = await Rider.findById(currentUser.userId).lean();
          defaultAddress = {
            userId: currentUser.userId,
            label: 'Rider Base Location',
            line1: 'Bengaluru Central Delivery Hub',
            locality: 'Delivery Hub',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560001',
            isDefault: true,
            location: {
              type: 'Point',
              coordinates: [
                rider?.currentLocation?.lng ?? 77.5946,
                rider?.currentLocation?.lat ?? 12.9716,
              ],
            },
          };
        } else if (
          currentUser.role === 'admin' ||
          currentUser.role === 'subadmin'
        ) {
          defaultAddress = {
            userId: currentUser.userId,
            label: 'Operations HQ',
            line1: 'Tomato Operations Headquarters',
            locality: 'Central HQ',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560001',
            isDefault: true,
            location: {
              type: 'Point',
              coordinates: [77.5946, 12.9716],
            },
          };
        } else {
          defaultAddress = {
            userId: currentUser.userId,
            label: 'Default Delivery Area',
            line1: 'Bengaluru Central',
            locality: 'Central',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560001',
            isDefault: true,
            location: {
              type: 'Point',
              coordinates: [77.5946, 12.9716],
            },
          };
        }
      }

      return res.json({ address: defaultAddress || null });
    } catch (error: any) {
      console.error('Fetch default address failed:', error);
      return res.status(500).json({ message: 'Unable to fetch default address' });
    }
  });
  router.get('/profile', authenticate, async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    if (!currentUser?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      let user: any = null;
      if (currentUser.role === 'customer') {
        user = await Customer.findById(currentUser.userId).lean();
      } else if (currentUser.role === 'restaurant') {
        user = await Restaurant.findById(currentUser.userId).lean();
      } else if (currentUser.role === 'deliveryPartner' || (currentUser.role as string) === 'rider') {
        user = await Rider.findById(currentUser.userId).lean();
      } else {
        user = await Employee.findById(currentUser.userId).lean();
      }

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.json({ user: userResponse(user) });
    } catch (error) {
      console.error('Fetch profile failed:', error);
      return res.status(500).json({ message: 'Unable to fetch profile' });
    }
  });
  router.put('/profile', authenticate, upload.single('photo'), updateProfile);
  router.post('/password-reset/request', requestPasswordReset);
  router.post('/password-reset/confirm', resetPassword);

  return router;
};

export default createAuthRouter;
