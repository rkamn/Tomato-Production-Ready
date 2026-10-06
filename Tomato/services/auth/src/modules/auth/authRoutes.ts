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
import {
  getWalletBalances,
  WalletServiceError,
} from '../../services/walletService.js';

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
    } catch (error) {
      if (error instanceof WalletServiceError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error('Wallet fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch wallet' });
    }
  });
  router.put('/profile', authenticate, upload.single('photo'), updateProfile);
  router.post('/password-reset/request', requestPasswordReset);
  router.post('/password-reset/confirm', resetPassword);

  return router;
};

export default createAuthRouter;
