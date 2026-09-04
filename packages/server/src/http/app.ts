import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './authController';

export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());

  app.use('/auth', authRouter);

  return app;
}
