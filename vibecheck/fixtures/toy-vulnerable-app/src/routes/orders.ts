import express, { Request, Response } from 'express';
import { db } from '../db';

const router = express.Router();

router.post('/orders/find-one', async (req: Request, res: Response) => {
  const { orderId } = req.body;

  const order = await db.order.findOne({
    where: { id: orderId },
  });

  res.json(order);
});

router.get('/orders/:id', async (req: Request, res: Response) => {
  const order = await db.order.findUnique({
    where: { id: parseInt(req.params.id) },
  });
  res.json(order);
});

export default router;
