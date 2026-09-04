import type { User } from '@prisma/client';
import { type Result } from '@tichu/shared';
import { prisma } from '../db/client';
import { withDb, type DbError } from '../db/errors';

export interface CreateUserInput {
  readonly loginId: string;
  readonly passwordHash: string;
  readonly nickname: string;
}

export function findUserByLoginId(loginId: string): Promise<Result<User | null, DbError>> {
  return withDb(() => prisma.user.findUnique({ where: { loginId } }));
}

export function findUserById(id: string): Promise<Result<User | null, DbError>> {
  return withDb(() => prisma.user.findUnique({ where: { id } }));
}

export function createUser(data: CreateUserInput): Promise<Result<User, DbError>> {
  return withDb(() => prisma.user.create({ data }));
}
