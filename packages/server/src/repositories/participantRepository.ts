import type { Participant } from '@prisma/client';
import { type Result } from '@tichu/shared';
import { prisma } from '../db/client';
import { withDb, type DbError } from '../db/errors';

export interface CreateParticipantInput {
  readonly roomId: string;
  readonly userId: string;
  readonly seat: number;
}

export function createParticipant(data: CreateParticipantInput): Promise<Result<Participant, DbError>> {
  return withDb(() => prisma.participant.create({ data }));
}
