import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db';

const router = express.Router();

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: generateToken(user) });
});

function generateToken(user: any): string {
  return Buffer.from(JSON.stringify({ id: user.id, role: user.role })).toString('base64');
}

export default router;
