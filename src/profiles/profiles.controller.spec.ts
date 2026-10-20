import type { User } from '@prisma/client';
import type { ApiRequest } from '../auth/init-data.guard';
import type { ModeratorGuard } from '../auth/moderator.guard';
import type { TelegramPhotosService } from '../telegram/telegram-photos.service';
import type { NotificationsService } from '../telegram/notifications.service';
import { ProfilesController } from './profiles.controller';
import type { ProfilesService } from './profiles.service';

const WALLET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('PUT /api/profile/wallet', () => {
  const walletChanged = jest.fn();
  const controller = new ProfilesController(
    { updateWallet: jest.fn() } as unknown as ProfilesService,
    {} as ModeratorGuard,
    {} as TelegramPhotosService,
    { walletChanged } as unknown as NotificationsService,
  );
  const req = (payoutWallet: string | null) =>
    ({ user: { id: 1, payoutWallet } as User }) as ApiRequest;

  beforeEach(() => walletChanged.mockClear());

  it('смена и удаление кошелька — уведомление владельцу', async () => {
    await controller.updateWallet({ wallet: WALLET }, req(null));
    await controller.updateWallet({ wallet: '' }, req(WALLET));
    expect(walletChanged.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      WALLET,
      null,
    ]);
  });

  it('тот же адрес — без уведомления', async () => {
    await controller.updateWallet({ wallet: ` ${WALLET} ` }, req(WALLET));
    expect(walletChanged).not.toHaveBeenCalled();
  });
});
