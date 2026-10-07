import express, { Express } from 'express';
import multer from 'multer';

import {
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  updateProfile,
} from './authController.js';
import {
  authenticate,
  AuthenticatedRequest,
} from '../../middleware/authenticate.js';
import Address from '../../model/Address.js';
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
  router.put('/profile', authenticate, upload.single('photo'), updateProfile);
  router.post('/password-reset/request', requestPasswordReset);
  router.post('/password-reset/confirm', resetPassword);

  return router;
};

export default createAuthRouter;
