import { getFormattedDate, getRedisClient } from './utils';
import { createClient } from 'redis';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

jest.mock('dotenv/config', () => ({}));

describe('utils', () => {
  describe('getFormattedDate', () => {
    it('returns correct YYYYMMDD format for current date', () => {
      
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T12:00:00Z'));
      
      const result = getFormattedDate();
      expect(result).toBe('20260101');
      
      jest.useRealTimers();
    });

    it('returns correct date when offset is applied', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T12:00:00Z'));
      
      expect(getFormattedDate(1)).toBe('20260102'); // +1 day
      expect(getFormattedDate(-1)).toBe('20251231'); // -1 day
      
      jest.useRealTimers();
    });
  });

  describe('getRedisClient', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = {
        ...originalEnv,
        REDIS_USERNAME: 'user',
        REDIS_PASS: 'pass',
        REDIS_IP: '0.0.0.0',
        REDIS_PORT: '6379',
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    

    it('creates a redis client with correct config', async () => {
      const mockOn = jest.fn();
      const mockConnect = jest.fn();
      
      (createClient as jest.Mock).mockReturnValue({
        on: mockOn,
        connect: mockConnect,
      });

      const client = await getRedisClient();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://user:pass@0.0.0.0:6379',
        socket: {
          connectTimeout: 30000
        }
      });

      
      const errorCallback = mockOn.mock.calls.find(call => call[0] === 'error')[1];
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      errorCallback(new Error('Test Error'));
      
      expect(consoleSpy).toHaveBeenCalledWith('Redis Client Error', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });
});