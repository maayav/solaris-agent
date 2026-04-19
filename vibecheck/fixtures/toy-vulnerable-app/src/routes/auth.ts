import express, { Request, Response } from 'express';
import { db } from '../db';

const router = express.Router();

router.post('/admin/delete-user', async (req: Request, res: Response) => {
  const { userId } = req.body;

  await db.user.delete({ where: { id: userId } });

  res.json({ success: true, message: `User ${userId} deleted` });
});

export default router;
