import express from 'express';

import { loginUser, registerUser, requestPasswordReset, resetPassword } from '../controllers/auth.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/password-reset/request', requestPasswordReset);
router.post('/password-reset/confirm', resetPassword);


export default router;

//----