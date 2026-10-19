import * as Sentry from '@sentry/nestjs';
import { RedactingLogger } from './redacting-logger';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
const capture = Sentry.captureException as jest.Mock;

describe('RedactingLogger → Sentry', () => {
  const logger = new RedactingLogger();
  beforeEach(() => {
    capture.mockClear();
    // вывод в консоль тесту не нужен
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('Error — в Sentry без токена бота, повтор той же ошибки — только в лог', () => {
    const err = new Error(
      'request to https://api.telegram.org/bot123456789:AAEabcdefghijklmnopqrstuvwxyz0123456/getMe failed',
    );
    logger.error(err, 'ScheduledJob');
    logger.error(err, 'ScheduledJob');
    expect(capture).toHaveBeenCalledTimes(1);
    const [sent, hint] = capture.mock.calls[0] as [Error, unknown];
    expect(sent.message).toContain('[REDACTED_BOT_TOKEN]');
    expect(sent.message).not.toContain('AAEabcdef');
    expect(hint).toEqual({ tags: { context: 'ScheduledJob' } });

    // та же ошибка из другого места — отдельное событие
    logger.error(err, 'NotificationsService');
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('строки, 500-е из HTTP (их Sentry уже получил) и warn — не отправляются', () => {
    logger.error(
      'Internal error',
      'Error: boom\n    at x',
      'ExceptionsHandler',
    );
    // Nest 11 пишет 500-ю в лог самим Error — но Sentry её уже получил через фильтр
    logger.error(new Error('boom'), 'ExceptionsHandler');
    logger.warn(new Error('мелочь'));
    expect(capture).not.toHaveBeenCalled();
  });
});
