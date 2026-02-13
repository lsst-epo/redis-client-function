import * as ff from '@google-cloud/functions-framework';
import { createClient } from 'redis';

// prevent unintended api calls
jest.mock('redis');
jest.mock('@google-cloud/functions-framework');

const mockedFF = ff as jest.Mocked<typeof ff>;
const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('redis', () => {
    let mainHandler: (req: any, res: any) => Promise<void>;

    let redisClientMock: {
        connect: jest.Mock;
        set: jest.Mock;
        get: jest.Mock;
        quit: jest.Mock;
        on: jest.Mock;
        del: jest.Mock;
        hGetAll: jest.Mock;
        hSet: jest.Mock;
    }

    const createMockContext = (path: string, body: any, method: string) => {
        const req = { 
            body: body,
            method: method,
            query: {},
            path: path,
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        return { req, res };
    }

    beforeAll(() => {
        // Intercept registration of handlers and save it as mainHandler
        mockedFF.http.mockImplementation((name, handler) => {
            mainHandler = handler;
        });
    
        // Isolate module loading to force trigger registration
        jest.isolateModules(() => {
            require('./index');
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();

        redisClientMock = {
            connect: jest.fn().mockResolvedValue(undefined),
            set: jest.fn().mockResolvedValue('OK'),
            get: jest.fn().mockResolvedValue('1'),
            on: jest.fn(),
            del: jest.fn(),
            quit: jest.fn().mockResolvedValue(undefined),
            hGetAll: jest.fn().mockResolvedValue({}),
            hSet: jest.fn().mockResolvedValue(1),
        }

        mockedCreateClient.mockReturnValue(redisClientMock as any);

        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});

        jest.useFakeTimers().setSystemTime(new Date('2026-01-01'));
    })

    afterAll(() => {
        jest.useRealTimers();
    });

    test.each([
        ['current',  '/current-stats', { temp: 0, wind: 0}],
        ['hourly', '/hourly-stats', { temp: 0, wind: 0}],
        ['daily', '/daily-stats', { temp: 0, wind: 0}],
        ['dome', '/dome-stats', { temp: 0, wind: 0}],
    ])('should store %s stats successfully', async(key, path, data) => {
        const body = {[key]: data};
        const { req, res } = createMockContext(path, body, "POST")

        await mainHandler(req, res);

        expect(redisClientMock.set).toHaveBeenCalledWith(
            expect.stringContaining(key), 
            JSON.stringify(data)
        )
    })

    test.each([
        ['current',  '/current-stats'],
        ['hourly', '/hourly-stats'],
        ['daily', '/daily-stats'],
        ['dome', '/dome-stats'],
        ['basic', '/basic-weather-stats'],
        ['cloud', '/cloud-weather-stats'],
    ])('should store %s stats successfully', async(key, path) => {
        if(key == "basic" || key == "cloud"){
            key = "data";
        }
        const body = {[key]: undefined};
        const { req, res } = createMockContext(path, body, "POST")

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(204);
    })

    test.each([
        ['basic', '/basic-weather-stats', { data: { temp: 50 }, params: 'current' }],
        ['cloud', '/cloud-weather-stats', { data: { temp: 50 }, params: 'current' }],
    ])('should store %s weather stats successfully', async(key, path, data) => {
        const body = data
        const { req, res } = createMockContext(path, body, "POST")

        await mainHandler(req, res);

        expect(redisClientMock.set).toHaveBeenCalledWith(
            expect.stringContaining(key), 
            JSON.stringify(data.data)
        )
    })

    it('should return 401 if authorization is missing or invalid', async () => {
        const { req, res } = createMockContext('/current-stats', { current: {} }, "POST");
        
        req.headers.authorization = 'Bearer incorrect-token';
    
        await mainHandler(req, res);
    
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: "ERROR",
            message: "Unauthorized: Missing or invalid token."
        }));
    });

    
    it('should get data for /', async () => {
        const path = "/";
        const body = "{}"
        const { req, res } = createMockContext(path, body, "GET")

        const mockDb: Record<string, string> = {
            'summit-status:current': JSON.stringify({ temp: 15 }),
            'summit-status:hourly': JSON.stringify([{ hour: 1 }]),
            'summit-status:daily': JSON.stringify([{ day: 'Mon' }]),
            'summit-status:dome': JSON.stringify({ status: 'OPEN' }),
            'summit-status:basic-weather-current': JSON.stringify({ condition: 'Sunny' }),
            'summit-status:cloud-weather-current': JSON.stringify({ coverage: 'None' })
        };

        redisClientMock.get.mockImplementation(async (key) => {
            return mockDb[key] || null;
        });

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith({
            current: { temp: 15 },
            hourly: [{ hour: 1 }],
            daily: [{ day: 'Mon' }],
            dome: { status: 'OPEN' },
            basicWeather: { condition: 'Sunny' },
            cloudWeather: { coverage: 'None' },
            nightlyDigest: { error: "No data available." },
            rawCurrentWeather: { error: "No data available." },
            alert: { error: "No data available." }
        });
    })

    it('should get data for /widgets', async () => {
        const path = "/widgets";
        const body = "{}"
        const { req, res } = createMockContext(path, body, "GET")

        const mockDb: Record<string, string> = {
            'summit-status:current': JSON.stringify({ temp: 15 }),
            'summit-status:hourly': JSON.stringify([{ hour: 1 }]),
            'summit-status:daily': JSON.stringify([{ day: 'Mon' }]),
            'summit-status:dome': JSON.stringify({ status: 'OPEN' }),
            'summit-status:basic-weather-current': JSON.stringify({ condition: 'Sunny' }),
            'summit-status:cloud-weather-current': JSON.stringify({ coverage: 'None' }),
            'summit-status:raw-current-weather-data': JSON.stringify({ data_current: {
                pictocode_detailed: 2
            }}),
            'summit-status:nightly-digest': JSON.stringify({
                dome_open: true,
                exposures_count: 7
            }),
            'summit-status:exposures': "7"
        };

        redisClientMock.get.mockImplementation(async (key) => {
            return mockDb[key] || null;
        });

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const responseData = res.send.mock.calls[0][0]; // body of first response

        expect(responseData).toEqual({
            weather: { pictocode: 2 },
            exposure: { count: 7 },
            dome: { isOpen: true },
            survey: { progress: "0.0" },
            alert: { count: 0 }
        });
    })

    it('/nightly-digest-stats should get data', async () => {
        const path = "/nightly-digest-stats";
        const body = {
            data: { exposure_count: 5 },
            params: "" // no override
        };
        
        const { req, res } = createMockContext(path, body, "POST");

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const mockDb: Record<string, string> = {
            'summit-status:exposures': "10",
            'summit-status:date-last-run': yesterdayStr // yesterday (allows the test to proceed)
        };

        redisClientMock.get.mockImplementation(async (key) => mockDb[key] || null);
        redisClientMock.set.mockResolvedValue("OK");

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);

        // verify accumulation: 10 (existing) + 5 (new) = 15
        expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:exposures', 15);
        
        // verify last run date was updated to today.
        expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:date-last-run', todayStr);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: "SUCCESS"
        }));
    });

    it('/nightly-digest-stats returns 400 if exposure_count is not an integer', async () => {
        const path = '/nightly-digest-stats';
        const body = { 
            data: { exposure_count: "5" } // String instead of number
        }
        const { req, res } = createMockContext(path, body, "POST");
    
        await mainHandler(req, res);
    
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "ERROR" }));
    });

    it('/nightly-digest-stats returns 429 (too many requests) if already processed today and no override', async () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const path = '/nightly-digest-stats';
        const body = { 
            data: { exposure_count: 5 } 
        }
        const { req, res } = createMockContext(path, body, "POST");

        // Mock Redis to say it already ran today
        redisClientMock.get.mockImplementation(async (key) => {
            if (key === 'summit-status:date-last-run') return todayStr;
            return null;
        });
    
        await mainHandler(req, res);
    
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "SKIPPED" }));
    });

    it('/nightly-digest-stats returns 200 if reaccumulate ', async () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const path = '/nightly-digest-stats';
        const body = { 
            data: { exposure_count: 5 },
            params: "reaccumulate"
        }
        const { req, res } = createMockContext(path, body, "POST");

        redisClientMock.get.mockImplementation(async (key) => {
            if (key === 'summit-status:date-last-run') return todayStr;
            return "10"; // Existing exposures
        });
    
        await mainHandler(req, res);
    
        expect(res.status).toHaveBeenCalledWith(200);
        expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:exposures', 15); // 10 (existing in redis) + 5 (new)
    });


    it('should 404 for /blah', async() => {
        const path = "/blah";
        const body = "{}"
        const { req, res } = createMockContext(path, body, "GET")

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    })

    it('should return error for null redis keys', async () => {
        const path = "/";
        const body = "{}"
        const { req, res } = createMockContext(path, body, "GET")

        redisClientMock.get.mockResolvedValue(null); // simulate empty redis

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);

        expect(res.send).toHaveBeenCalledWith({
            current: { error: "No data available." },
            hourly: { error: "No data available." },
            daily: { error: "No data available." },
            dome: { error: "No data available." },
            basicWeather: { error: "No data available." },
            cloudWeather: { error: "No data available." },
            nightlyDigest: { error: "No data available." },
            rawCurrentWeather: { error: "No data available." },
            alert: { error: "No data available." }
        });
    })

    it('should return 204 for OPTIONS', async () => {
        const {req, res} = createMockContext("/", "{}", "OPTIONS");

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(204);
    })

    describe('DELETE /', () => {
        // test valid keys
        test.each([
            ['date-last-run', 'summit-status:date-last-run'],
            ['exposures', 'summit-status:exposures']
        ])('should successfully delete valid key: %s', async (queryKey, expectedRedisKey) => {
            const { req, res } = createMockContext("/", {}, "DELETE");
            req.query = { key: queryKey };
    
            redisClientMock.del.mockResolvedValue(1); // mock a redis success (on del)
    
            await mainHandler(req, res);
    
            expect(redisClientMock.del).toHaveBeenCalledWith(expectedRedisKey);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                status: "SUCCESS",
                message: expect.stringContaining(expectedRedisKey)
            }));
        });
    
        // test incorrect or missing keys
        test.each([
            ['invalid-key'],
            [''],
            [undefined]
        ])('should return 400 for invalid or missing key: %s', async (badKey) => {
            const { req, res } = createMockContext("/", {}, "DELETE");
            req.query = badKey !== undefined ? { key: badKey } : {};
    
            await mainHandler(req, res);
    
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                status: "ERROR",
                message: expect.stringContaining("Valid keys are: date-last-run, exposures")
            }));

            expect(redisClientMock.del).not.toHaveBeenCalled(); // ensure we didn't delete anything from redis
        });
    });
        
});