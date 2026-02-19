import * as ff from '@google-cloud/functions-framework';
import { createClient } from 'redis';
import { createRequest, createResponse, MockRequest, MockResponse } from 'node-mocks-http';

// prevent unintended api calls
jest.mock('redis');
jest.mock('@google-cloud/functions-framework');

const mockedFF = ff as jest.Mocked<typeof ff>;
const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

type RedisClientType = ReturnType<typeof createClient>;

describe('redis', () => {
    let mainHandler: (req: ff.Request, res: ff.Response) => Promise<void>;

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

    let req: MockRequest<ff.Request>;
    let res: MockResponse<ff.Response>;

    beforeAll(() => {
        // Intercept registration of handlers and save it as mainHandler
        mockedFF.http.mockImplementation((name, handler) => {
            mainHandler = handler;
        });

        req = createRequest();
        res = createResponse();
    
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

        mockedCreateClient.mockReturnValue(redisClientMock as Partial<RedisClientType> as RedisClientType);

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
        req = createRequest({
            method: "POST",
            path: path,
            query: {},
            body: body,
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        });
        res = createResponse();

        await mainHandler(req, res);

        expect(redisClientMock.set).toHaveBeenCalledWith(
            expect.stringContaining(key), 
            JSON.stringify(data)
        )
    });

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
        req = createRequest({
            method: "POST",
            path: path,
            body: body,
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        });
        res = createResponse();

        await mainHandler(req, res);
        expect(res._getStatusCode()).toBe(204);
    });

    test.each([
        ['basic', '/basic-weather-stats', { data: { temp: 50 }, params: 'current' }],
        ['cloud', '/cloud-weather-stats', { data: { temp: 50 }, params: 'current' }],
    ])('should store %s weather stats successfully', async(key, path, data) => {
        const body = data;
        req = createRequest({
            method: "POST",
            path: path,
            body: body,
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        });
        res = createResponse();

        await mainHandler(req, res);

        expect(redisClientMock.set).toHaveBeenCalledWith(
            expect.stringContaining(key), 
            JSON.stringify(data.data)
        )
    });

    it('should return 401 if authorization is missing or invalid', async () => {
        req = createRequest({
            method: "POST",
            path: "/current-stats",
            query: {},
            body: {
                current: {}
            },
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        });
        res = createResponse();
        
        req.headers.authorization = 'Bearer incorrect-token';
    
        await mainHandler(req, res);

        expect(res._getStatusCode()).toBe(401);
        const responseData = res._getJSONData();
        expect(responseData).toEqual({
            status: "ERROR",
            message: "Unauthorized: Missing or invalid token."
        });
    });

    describe('/widgets', () => {
        const path = '/widgets';
        it('should get data for /widgets', async () => {
            req = createRequest({
                method: "GET",
                path: path,
                body: {},
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
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
                'summit-status:current-exposures': JSON.stringify({
                    dome_open: true,
                    exposure_count: 7
                }),
                'summit-status:exposures': "7"
            };
    
            redisClientMock.get.mockImplementation(async (key) => {
                return mockDb[key] || null;
            });
    
            await mainHandler(req, res);
    
            expect(res._getStatusCode()).toBe(200);
            const responseData = res._getData();
            expect(responseData).toEqual({
                weather: { pictocode: 2 },
                exposure: { count: 7 },
                dome: { isOpen: true },
                survey: { progress: "0.0" },
                alert: { count: 0 }
            });
        });
    
        it('should default survey progress to "0.0" if TOTAL_EXPECTED_EXPOSURES is missing in /widgets', async () => {
            req = createRequest({
                method: "GET",
                path: path,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
            
            process.env.TOTAL_EXPECTED_EXPOSURES = "0"; 
            
            // return null for exposures
            redisClientMock.get.mockImplementation(async (key) => {
                if (key === 'summit-status:exposures') {
                    return null;
                }
                if (key === 'summit-status:current-exposures') {
                    return JSON.stringify({exposure_count: 2});
                }
                return JSON.stringify({}); // Other keys return empty objects
            });
        
            await mainHandler(req, res);
        
            const responseData = res._getData(); 
            expect(responseData.survey.progress).toBe("0.0");
            expect(responseData.exposure.count).toBe(2);
        });
    
        it('should return default values in widgetData when Redis data is malformed or partial in /widgets', async () => {
            req = createRequest({
                method: "GET",
                path: path,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
        
            // valid JSON but missing specific fields
            const mockDb: Record<string, string> = {
                'summit-status:raw-current-weather-data': JSON.stringify(null), // missing pictocode
                'summit-status:current-exposures': JSON.stringify(null), // missing dome_open
                'summit-status:alert-current': JSON.stringify(null), // missing count
                'summit-status:exposures': JSON.stringify(null)
            };
        
            redisClientMock.get.mockImplementation(async (key) => mockDb[key] || null);
        
            await mainHandler(req, res);
        
            const data = res._getData();
            
            expect(data.weather.pictocode).toBe(0);  
            expect(data.dome.isOpen).toBe(false);
            expect(data.alert.count).toBe(0);
        });
    
        it('should return alert-current count if stored in redis in /widgets', async () => {
            req = createRequest({
                method: "GET",
                path: path,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            }) ;
            res= createResponse();
    
            const mockDb: Record<string, string> = {
                'summit-status:alert-current': JSON.stringify({ count: "10" }),
            };
        
            redisClientMock.get.mockImplementation(async (key) => mockDb[key] || null);
        
            await mainHandler(req, res);
        
            const data = res._getData();
            expect(data.alert.count).toBe("10");
        });
    });
    

    it('should get data for /full', async () => {
        const path = "/full";
        const body = {};

        req = createRequest({
            method: "GET",
            path: path,
            body: body,
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        });
        res = createResponse();

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
            'summit-status:current-exposures': JSON.stringify({
                dome_open: true,
                exposure_count: 7
            }),
            'summit-status:exposures': "7",
            'summit-status:date-last-run': '2026-02-15',
        };

        redisClientMock.get.mockImplementation(async (key) => {
            return mockDb[key] || null;
        });

        await mainHandler(req, res);

        expect(res._getStatusCode()).toBe(200);
        const responseData = res._getData();

        expect(responseData).toEqual({
            weather: { pictocode: 2 },
            exposure: { count: 7 },
            dome: { isOpen: true },
            survey: { progress: "0.0" },
            alert: { count: 0 },
            dateLastRun: "2026-02-15"
        });
    });

    describe('/accumulated-exposure-count', () => {
        const path = "/accumulated-exposure-count";
        it('/accumulated-exposure-count should get data', async () => {
            const body = {
                data: { exposure_count: 5 },
                params: "" // no override
            };
            req = createRequest({
                method: "POST",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
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
    
            expect(res._getStatusCode()).toBe(200);
    
            // verify accumulation: 10 (existing) + 5 (new) = 15
            expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:exposures', 15);
            
            // verify last run date was updated to today.
            expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:date-last-run', todayStr);
    
            const responseData = res._getJSONData(); // Automatically parses JSON
                expect(responseData).toMatchObject({
                    status: "SUCCESS"
                });
        });
    
        it('/accumulated-exposure-count should get data and fall back to a default of 0 if new value is not given', async () => {
            const body = {
                // missing data field
                data: null,
                params: "" // no override
            };
            
            req = createRequest({
                method: "POST",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
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
    
            expect(res._getStatusCode()).toBe(200);
    
            // verify accumulation: 10 (existing) + 0 (new) = 10
            expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:exposures', 10);
            
            // // verify last run date was updated to today.
            expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:date-last-run', todayStr);
    
    
            const responseData = res._getJSONData(); // Automatically parses JSON
                expect(responseData).toMatchObject({
                    status: "SUCCESS"
                });
        });
    
        it('/accumulated-exposure-count should get data and have a default if new value is not given', async () => {
            const body = null;
            
            req = createRequest({
                method: "POST",
                path: path,
                body: undefined,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
            
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
    
            expect(res._getStatusCode()).toBe(204);
        });
    
        it('/accumulated-exposure-count should handle invalid params (not reaccumulate)', async () => {
            req = createRequest({
                method: "POST",
                path: path,
                body: { 
                    data: { exposure_count: 5 },
                },
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            Object.defineProperty(req, 'body', {});
            res = createResponse();
            
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
    
            expect(res._getStatusCode()).toBe(200);
        });
    
        it('/accumulated-exposure-count returns 400 if exposure_count is not an integer', async () => {
            const body = { 
                data: { exposure_count: "5" } // String instead of number
            }
    
            req = createRequest({
                method: "POST",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
        
            await mainHandler(req, res);
    
            expect(res._getStatusCode()).toBe(400);
            const responseData = res._getJSONData(); // Automatically parses JSON
            expect(responseData).toMatchObject({ status: "ERROR" });
        });
    
        it('/accumulated-exposure-count returns 429 (too many requests) if already processed today and no override', async () => {
            const todayStr = new Date().toISOString().split('T')[0];
            const body = { 
                data: { exposure_count: 5 } 
            }
            req = createRequest({
                method: "POST",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
            // Mock Redis to say it already ran today
            redisClientMock.get.mockImplementation(async (key) => {
                if (key === 'summit-status:date-last-run') return todayStr;
                return null;
            });
        
            await mainHandler(req, res);
    
            expect(res._getStatusCode()).toBe(429);
            const responseData = res._getJSONData(); // Automatically parses JSON
            expect(responseData).toMatchObject({ status: "SKIPPED" });
        });
    
        it('/accumulated-exposure-count returns 200 if reaccumulate ', async () => {
            const todayStr = new Date().toISOString().split('T')[0];
            const body = { 
                data: { exposure_count: 5 },
                params: "reaccumulate"
            }
            req = createRequest({
                method: "POST",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
            redisClientMock.get.mockImplementation(async (key) => {
                if (key === 'summit-status:date-last-run') return todayStr;
                return "10"; // Existing exposures
            });
        
            await mainHandler(req, res);
        
            expect(res._getStatusCode()).toBe(200);
            expect(redisClientMock.set).toHaveBeenCalledWith('summit-status:exposures', 15); // 10 (existing in redis) + 5 (new)
        });
    });

    it('returns 404 for an undefined POST stats path', async () => {
        const path = "/invalid-stats-path";
        const body = { some: 'data' };
        req = createRequest({
            method: "POST",
            path: path,
            body: body,
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        });
        res = createResponse();
    
        await mainHandler(req, res);

        expect(res._getStatusCode()).toBe(404);
        const responseData = res._getJSONData(); // Automatically parses JSON
        expect(responseData).toMatchObject({
            status: "ERROR",
            message: "Incorrect endpoint."
        });
    });


    it('should 404 for /blah', async() => {
        const path = "/blah";
        const body = {};
        req = createRequest({
            method: "GET",
            path: path,
            body: body,
            headers: {
                authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
            }
        });
        res = createResponse();

        await mainHandler(req, res);

        expect(res._getStatusCode()).toBe(404);
    });

    describe("/", () => {
        const path = "/";

        it('should get data for /', async () => {
            req = createRequest({
                method: "GET",
                path: path,
                body: {},
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
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
    
            expect(res._getStatusCode()).toBe(200);
            expect(res._getData()).toEqual({
                current: { temp: 15 },
                hourly: [{ hour: 1 }],
                daily: [{ day: 'Mon' }],
                dome: { status: 'OPEN' },
                basicWeather: { condition: 'Sunny' },
                cloudWeather: { coverage: 'None' },
                currentExposure: { error: "No data available." },
                rawCurrentWeather: { error: "No data available." },
                alert: { error: "No data available." }
            });
        });

        it('should return error for null redis keys', async () => {
            const body = {};
            req = createRequest({
                method: "GET",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
            redisClientMock.get.mockResolvedValue(null); // simulate empty redis
    
            await mainHandler(req, res);
    
            expect(res._getStatusCode()).toBe(200);
    
            expect(res._getData()).toEqual({
                current: { error: "No data available." },
                hourly: { error: "No data available." },
                daily: { error: "No data available." },
                dome: { error: "No data available." },
                basicWeather: { error: "No data available." },
                cloudWeather: { error: "No data available." },
                currentExposure: { error: "No data available." },
                rawCurrentWeather: { error: "No data available." },
                alert: { error: "No data available." }
            });
        });
    
        it('should return 204 for OPTIONS', async () => {
            const body = {};
            req = createRequest({
                method: "OPTIONS",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
    
            await mainHandler(req, res);
    
            expect(res._getStatusCode()).toBe(204);
        });

        describe('DELETE /', () => {
            // test valid keys
            test.each([
                ['date-last-run', 'summit-status:date-last-run'],
                ['exposures', 'summit-status:exposures']
            ])('should successfully delete valid key: %s', async (queryKey, expectedRedisKey) => {
                const body = {};
                req = createRequest({
                    method: "DELETE",
                    path: path,
                    body: body,
                    headers: {
                        authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                    }
                });
                res = createResponse();
    
                req.query = { key: queryKey };
        
                redisClientMock.del.mockResolvedValue(1); // mock a redis success (on del)
        
                await mainHandler(req, res);
    
                expect(res._getStatusCode()).toBe(200);
        
                const responseData = res._getJSONData(); // Automatically parses JSON
                expect(responseData).toMatchObject({
                    status: "SUCCESS",
                    message: expect.stringContaining(expectedRedisKey)
                });
                
            });
        
            // test incorrect or missing keys
            test.each([
                ['invalid-key'],
                [''],
                [undefined]
            ])('should return 400 for invalid or missing key: %s', async (badKey) => {
                const body = {};
                req = createRequest({
                    method: "DELETE",
                    path: path,
                    body: body,
                    headers: {
                        authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                    }
                });
                res = createResponse();
    
                req.query = badKey !== undefined ? { key: badKey } : {};
        
                await mainHandler(req, res);
    
                expect(res._getStatusCode()).toBe(400);
        
                const responseData = res._getJSONData(); // Automatically parses JSON
                expect(responseData).toMatchObject({
                    status: "ERROR",
                    message: "Valid keys are: date-last-run, exposures, current-exposures"
                });
            });
    
            it('should return 404 when key is valid but does not exist in Redis', async () => {
                const body = {};
                req = createRequest({
                    method: "DELETE",
                    path: path,
                    body: body,
                    headers: {
                        authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                    }
                });
                res = createResponse();
    
                req.query = { key: 'exposures' };
            
                // Redis returns 0 if nothing was deleted
                redisClientMock.del.mockResolvedValue(0);
            
                await mainHandler(req, res);
                expect(res._getStatusCode()).toBe(404);
        
                const responseData = res._getJSONData(); // Automatically parses JSON
                expect(responseData).toMatchObject({
                    status: "NOT_FOUND",
                    message: "summit-status:exposures key did not exist in cache."
                });
            });
    
            it('should return 500 when Redis throws an unexpected error', async () => {
                const body = {};
                req = createRequest({
                    method: "DELETE",
                    path: path,
                    body: body,
                    headers: {
                        authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                    }
                });
                res = createResponse();
    
                req.query = { key: 'date-last-run' };
            
                // Force the client to error
                const redisError = new Error("Connection lost");
                redisClientMock.del.mockRejectedValue(redisError);
            
                // keep the test output clean
                const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            
                await mainHandler(req, res);
                
                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining("Error deleting cache"),
                    redisError
                );
    
                expect(res._getStatusCode()).toBe(500);
        
                const responseData = res._getJSONData(); // Automatically parses JSON
                expect(responseData).toMatchObject({
                    status: "ERROR",
                    message: "Failed to clear cache."
                });
            
                consoleSpy.mockRestore();
            });
        });
    
        it('returns 400 for unsupported HTTP method', async () => {
            const body = {};
            req = createRequest({
                method: "PUT",
                path: path,
                body: body,
                headers: {
                    authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}`
                }
            });
            res = createResponse();
        
            await mainHandler(req, res);
    
            expect(res._getStatusCode()).toBe(400);
        });
    });

    it('req.body is null', async () => {
        const req = {
            method: "POST",
            path: "/accumulated-exposure-count",
            body: null, // force the first part of ?. to trigger
            headers: { authorization: `Bearer ${process.env.REDIS_BEARER_TOKEN}` }
        } as unknown as ff.Request;

        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
        } as unknown as ff.Response;

        await mainHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(204);
    });
});

