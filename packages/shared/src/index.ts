export * from './domain.js';
export * from './bracket.js';
export * from './dto.js';
export * from './realtime.js';
export * from './errors.js';
export * from './dupr-export.js';
export * from './i18n/index.js';

/** Типы тел запросов — без runtime Zod, чтобы веб не тащил валидатор. */
export type {
  TelegramAuthInput,
  ClaimInput,
  CreatePlayerInput,
  UpdatePlayerInput,
  CreateTournamentInput,
  UpdateTournamentInput,
  CreateTrainingInput,
  UpdateTrainingInput,
  SetTrainingAmountInput,
  MatchScoreInput,
  LinkPartnerInput,
  ImportPlayersInput,
} from './schemas.js';
