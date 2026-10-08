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

  router.get('/default-address', authenticate, async (req, res) => {
    const currentUser = (req as AuthenticatedRequest).user;
    if (!currentUser?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      const defaultAddress = await Address.findOne({
        userId: currentUser.userId,
      })
        .sort({ isDefault: -1, createdAt: -1 })
        .lean();

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
