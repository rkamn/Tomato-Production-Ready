import { Router, Request, Response } from 'express';
import {
  getServiceablePincodes,
  addServiceablePincodes,
  removeServiceablePincode,
} from '../../../utils/bankHelpers.js';

const router = Router();

  // Serviceable Delivery Pincodes Management (Admin can view, add, or remove pincodes anytime)
  router.get('/serviceable-pincodes', async (_req: Request, res: Response) => {
    try {
      const pincodes = await getServiceablePincodes();
      return res.json({ pincodes });
    } catch (error) {
      console.error('Fetch serviceable pincodes failed:', error);
      return res.status(500).json({ message: 'Unable to fetch serviceable pincodes' });
    }
  });

  router.post('/serviceable-pincodes', async (req: Request, res: Response) => {
    try {
      const raw = req.body?.pincode ?? req.body?.pincodes;
      const { added, pincodes } = await addServiceablePincodes(raw);
      if (added.length === 0) {
        return res.status(400).json({
          message: 'Please provide a valid 5 or 6 digit pincode (or comma-separated pincodes)',
          pincodes,
        });
      }
      return res.json({
        message: `Serviceable pincode(s) active: ${added.join(', ')}`,
        added,
        pincodes,
      });
    } catch (error) {
      console.error('Add serviceable pincodes failed:', error);
      return res.status(500).json({ message: 'Unable to add serviceable pincode' });
    }
  });

  router.delete('/serviceable-pincodes/:pincode', async (req: Request, res: Response) => {
    try {
      const pincode = String(req.params.pincode || '').trim();
      if (!pincode) {
        return res.status(400).json({ message: 'Pincode is required' });
      }
      const { pincodes, unapprovedPartnersCount } = await removeServiceablePincode(pincode);
      return res.json({
        message:
          unapprovedPartnersCount > 0
            ? `Pincode ${pincode} removed from serviceable range (${unapprovedPartnersCount} restaurant/shop(s) in this pincode were automatically marked unapproved)`
            : `Pincode ${pincode} removed from serviceable range`,
        pincodes,
        unapprovedCount: unapprovedPartnersCount,
        unapprovedPartnersCount,
      });
    } catch (error) {
      console.error('Remove serviceable pincode failed:', error);
      return res.status(500).json({ message: 'Unable to remove serviceable pincode' });
    }
  });


export default router;
