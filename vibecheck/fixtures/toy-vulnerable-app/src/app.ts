import express from 'express';
import authRoutes from './routes/auth';
import loginRoutes from './routes/login';
import ordersRoutes from './routes/orders';

const app = express();
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/', loginRoutes);
app.use('/orders', ordersRoutes);

export default app;
