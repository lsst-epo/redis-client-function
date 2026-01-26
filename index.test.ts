import * as ff from '@google-cloud/functions-framework';
import { createClient } from 'redis';

// prevent unintended api calls
jest.mock('redis');
jest.mock('@google-cloud/functions-framework');

const mockedFF = ff as jest.Mocked<typeof ff>;
const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('Redis', () => {
    let mainHandler: (req: any, res: any) => Promise<void>;

    let redisClientMock: {
        connect: jest.Mock;
        set: jest.Mock;
        get: jest.Mock;
        quit: jest.Mock;
        on: jest.Mock;

    }

    const createMockContext = (path: string, body: any, method: string) => {
        const req = { 
            body: body,
            method: method,
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
            quit: jest.fn().mockResolvedValue(undefined)
        }

        mockedCreateClient.mockReturnValue(redisClientMock as any);

        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    })

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
            nightlyDigest: { error: "No data available."},
            rawCurrentWeather: {error: "No data available."}
        });
    })

    it('should get data for /widget', async () => {
        const path = "/widget";
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
                exposure_count: 7
            })
        };

        redisClientMock.get.mockImplementation(async (key) => {
            return mockDb[key] || null;
        });

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const responseData = res.send.mock.calls[0][0]; // body of first response

        expect(responseData).toEqual({
            weather: { pictocode: 2 },
            exposures: { count: 7 },
            dome: { isOpen: true }
        });
    })

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
            current: { error: "No data available."},
            hourly: { error: "No data available."},
            daily: { error: "No data available."},
            dome: { error: "No data available."},
            basicWeather: { error: "No data available."},
            cloudWeather: { error: "No data available."},
            nightlyDigest: { error: "No data available."},
            rawCurrentWeather: {error: "No data available."}
        });
    })

    it('should return 204 for OPTIONS', async () => {
        const {req, res} = createMockContext("/", "{}", "OPTIONS");

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(204);
    })
        
});