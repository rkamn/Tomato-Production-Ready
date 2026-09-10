import express, { Express } from 'express';
import multer from 'multer';

import { loginUser, registerUser, requestPasswordReset, resetPassword, updateProfile } from '../controllers/auth.js';
import { authenticate } from '../middleware/authenticate.js';

const createAuthRouter = (upload: multer.Multer) => {
  const router = express.Router();

  router.post('/register', registerUser);
  router.post('/login', loginUser);
  router.put('/profile', authenticate, upload.single('photo'), updateProfile);
  router.post('/password-reset/request', requestPasswordReset);
  router.post('/password-reset/confirm', resetPassword);

  return router;
};

export default createAuthRouter;

//----