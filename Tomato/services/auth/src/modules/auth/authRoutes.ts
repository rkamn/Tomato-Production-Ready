import express, { Express } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';

import {
  loginUser,
  registerUser,
  requestPasswordReset,
  verifyResetCode,
  resetPassword,
  updateProfile,
  userResponse,
  logoutUser,
  logoutAllSessions,
  getActiveSessions,
  revokeSingleSession,
} from './authController.js';
import {
  authenticate,
  AuthenticatedRequest,
} from '../../middleware/authenticate.js';
import Address from '../../model/Address.js';
import Customer from '../../model/Customer.js';
import Restaurant from '../../model/Restaurant.js';
import Shop from '../../model/Shop.js';
import Rider from '../../model/Rider.js';
import Employee from '../../model/Employee.js';
import { resolvePartnerPincode, getServiceablePincodes, getAdminPincodeMap } from '../../utils/bankHelpers.js';
import {
  getWalletBalances,
  WalletServiceError,
} from '../wallet/walletService.js';

const createAuthRouter = (upload: multer.Multer) => {
  const router = express.Router();

  router.get('/serviceable-pincodes', async (_req, res) => {
    try {
      const [pincodes, adminZones] = await Promise.all([
        getServiceablePincodes(),
        getAdminPincodeMap(),
      ]);
      return res.json({ pincodes, adminZones });
    } catch (error) {
      console.error('Serviceable pincodes fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch serviceable pincodes' });
    }
  });

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
          const partnerPin = (rest as any)?.pincode || resolvePartnerPincode(rest) || parsed.postalCode;
          defaultAddress = {
            userId: currentUser.userId,
            label: 'Restaurant Location',
            line1: rest?.restaurantAddress || parsed.line1,
            locality: parsed.locality,
            city: parsed.city,
            state: parsed.state,
            postalCode: partnerPin,
            isDefault: true,
            location: {
              type: 'Point',
              coordinates: [
                rest?.restaurantLocation?.lng ?? 77.5946,
                rest?.restaurantLocation?.lat ?? 12.9716,
              ],
            },
          };
        } else if (currentUser.role === 'shop') {
          const shop = await Shop.findById(currentUser.userId).lean();
          const parsed = parseAddressString(shop?.shopAddress);
          const partnerPin = (shop as any)?.pincode || resolvePartnerPincode(shop) || parsed.postalCode;
          defaultAddress = {
            userId: currentUser.userId,
            label: 'Shop Location',
            line1: shop?.shopAddress || parsed.line1,
            locality: parsed.locality,
            city: parsed.city,
            state: parsed.state,
            postalCode: partnerPin,
            isDefault: true,
            location: {
              type: 'Point',
              coordinates: [
                shop?.shopLocation?.lng ?? 77.6408,
                shop?.shopLocation?.lat ?? 12.9784,
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
          currentUser.role === 'superadmin' ||
          currentUser.role === 'admin' ||
          currentUser.role === 'subadmin' ||
          currentUser.baseRole === 'admin' ||
          currentUser.baseRole === 'subadmin'
        ) {
          let empDoc: any = null;
          if (currentUser.userId && mongoose.isValidObjectId(currentUser.userId)) {
            empDoc = await Employee.findById(currentUser.userId).lean();
          }
          if (!empDoc && currentUser.email) {
            empDoc = await Employee.findOne({ email: currentUser.email.toLowerCase() }).lean();
          }
          if (!empDoc && (currentUser as any).username) {
            empDoc = await Employee.findOne({ username: (currentUser as any).username.toLowerCase() }).lean();
          }
          if (!empDoc && (currentUser as any).adminId) {
            empDoc = await Employee.findOne({ adminId: (currentUser as any).adminId }).lean();
          }

          if (empDoc?.assignedLocation && empDoc.assignedLocation.city && empDoc.assignedLocation.postalCode) {
            const loc = empDoc.assignedLocation;
            defaultAddress = {
              userId: currentUser.userId,
              label: loc.label || `${loc.city} Operations HQ`,
              line1: loc.line1 || 'Tomato Regional Headquarters',
              locality: loc.locality || loc.city,
              city: loc.city,
              state: loc.state || 'Karnataka',
              postalCode: loc.postalCode,
              isDefault: true,
              location: loc.location || {
                type: 'Point',
                coordinates: [77.5946, 12.9716],
              },
            };
          } else {
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
          }
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
      } else if (defaultAddress) {
        if (currentUser.role === 'restaurant') {
          const rest = await Restaurant.findById(currentUser.userId).lean();
          const partnerPin = (rest as any)?.pincode || resolvePartnerPincode(rest);
          if (partnerPin) {
            defaultAddress.postalCode = partnerPin;
          }
        } else if (currentUser.role === 'shop') {
          const shop = await Shop.findById(currentUser.userId).lean();
          const partnerPin = (shop as any)?.pincode || resolvePartnerPincode(shop);
          if (partnerPin) {
            defaultAddress.postalCode = partnerPin;
          }
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
      } else if (currentUser.role === 'shop') {
        user = await Shop.findById(currentUser.userId).lean();
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
  router.post('/password-reset/verify-code', verifyResetCode);
  router.post('/password-reset/confirm', resetPassword);

  // Active Session Management & Server-Side Revocation
  router.post('/logout', authenticate, logoutUser);
  router.post('/logout-all', authenticate, logoutAllSessions);
  router.get('/sessions', authenticate, getActiveSessions);
  router.delete('/sessions/:sessionId', authenticate, revokeSingleSession);

  return router;
};

export default createAuthRouter;
