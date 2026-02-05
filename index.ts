import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import { getFormattedDate, getRedisClient } from './utils';

ff.http('summit-status', async (req: ff.Request, res: ff.Response) => {
    // check auth
    const authHeader = req.headers.authorization;
    const REDIS_BEARER_TOKEN = process.env.REDIS_BEARER_TOKEN;

    if (!authHeader || authHeader !== `Bearer ${REDIS_BEARER_TOKEN}`) {
        console.error('Unauthorized attempt');
        return res.status(401).json({
            status: "ERROR",
            message: "Unauthorized: Missing or invalid token."
        })
    }
    
    res.set('Access-Control-Allow-Origin', "*")
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") {
        // Send response to OPTIONS requests
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }

    const client = await getRedisClient();
    await client.connect();

    if(req.method == "GET") {
        let currentSummitData = await client.get('summit-status:current');
        let hourlySummitData = await client.get('summit-status:hourly');
        let dailySummitData = await client.get('summit-status:daily');
        let domeSummitData = await client.get('summit-status:dome');
        let basicWeatherSummitData = await client.get('summit-status:basic-weather-current'); // `current` is the default mode and the only thing we care about for caching for now
        let basicCloudSummitData = await client.get('summit-status:cloud-weather-current');
        let rawCurrentWeatherSummitData = await client.get('summit-status:raw-current-weather-data'); // uses the raw `current` meteoblue package (rather than the forecast packages: basic and cloud)
        let nightlyDigestSummitData = await client.get('summit-status:nightly-digest');
        let surveyData = await client.get('summit-status:summit-survey-data');
        let alertData = await client.get('summit-status:alert-current')
        let exposureData = await client.hGetAll('summit-status:exposures'); // exposure counts by day

        let summitData = {
            current: (currentSummitData == null) ? { error: "No data available." } : JSON.parse(currentSummitData),
            hourly: (hourlySummitData == null) ? { error: "No data available." } : JSON.parse(hourlySummitData),
            daily: (dailySummitData == null) ? { error: "No data available." } : JSON.parse(dailySummitData),
            dome: (domeSummitData == null) ? { error: "No data available." } : JSON.parse(domeSummitData),
            basicWeather: (basicWeatherSummitData == null) ? { error: "No data available." } : JSON.parse(basicWeatherSummitData),
            cloudWeather: (basicCloudSummitData == null) ? { error: "No data available." } : JSON.parse(basicCloudSummitData),
            rawCurrentWeather: (rawCurrentWeatherSummitData == null) ? { error: "No data available." } : JSON.parse(rawCurrentWeatherSummitData),  // uses the raw `current` meteoblue package (rather than the forecast packages: basic and cloud)
            nightlyDigest: (nightlyDigestSummitData == null) ? { error: "No data available." } : JSON.parse(nightlyDigestSummitData),
            survey: (surveyData == null) ? { error: "No data available." } : JSON.parse(surveyData),
            alert: (alertData == null) ? { error: "No data available." } : JSON.parse(alertData)
        }
        
        if (req.path == '/') {
            return res.status(200).send(summitData);
        }
        
        if (req.path == '/widgets') {
            const totalExpectedExposureCount = process.env.TOTAL_EXPECTED_EXPOSURES ?? summitData.survey?.totalExpectedExposureCount;
            const exposureCount = Object.values(exposureData || {}).reduce(
                (sum, val) => {
                    const num = parseInt(val, 10);
                    return sum + (Number.isInteger(num) ? num : 0)
                }, 0
            ); // get all values from redis hash and sum their integer conversions.

            const surveyProgress = (totalExpectedExposureCount
                ? (exposureCount / totalExpectedExposureCount)
                : 0).toFixed(1); // use 1 decimal place since this is a back of the envelope calculation

            let widgetData = {
                weather: { 
                    pictocode: summitData.rawCurrentWeather?.data_current?.pictocode_detailed ?? 0 
                },
                exposure: { 
                    count: exposureCount ?? 0
                },
                dome: { 
                    isOpen: summitData.nightlyDigest?.dome_open ?? false
                },
                survey: {
                    progress: surveyProgress
                },
                alert: {
                    count: summitData.alert?.count ?? 0
                }
            }
            return res.status(200).send(widgetData);
        }

        return res.status(404).send("404 Not Found");
    } 

    if(req.method == "POST") {
        console.log("SummitStatusDataUpdater: Saving Data!"); // Used for querying Logging Explorer to find the "SummitStatusDataUpdater"

        const STATS_MAP: Record<string, {
            redisKey: string,
            field: string,
            label: string,
            defaultParam?: string,
            redisAction?: 'SET' | 'HSET',
            transform?: (body: any) => {field: string, value: string}
        }> = {
            '/current-stats': {
                redisKey: 'summit-status:current',
                field: 'current',
                label: 'current-stats'
            },
            '/hourly-stats': { 
                redisKey: 'summit-status:hourly',
                field: 'hourly',
                label: 'hourly stats' 
            },
            '/daily-stats': {
                redisKey: 'summit-status:daily',
                field: 'daily',
                label: 'daily stats'
            },
            '/dome-stats': { 
                redisKey: 'summit-status:dome',
                field: 'dome',
                label: 'dome stats'
            },
            '/raw-current-weather-stats': { 
                redisKey: 'summit-status:raw-current-weather-data', 
                field: 'data', 
                label: 'raw current weather'
            },
            '/basic-weather-stats': { 
                redisKey: 'summit-status:basic-weather', 
                field: 'data', 
                label: 'basic weather', 
                defaultParam: 'current' 
            },
            '/cloud-weather-stats': { 
                redisKey: 'summit-status:cloud-weather', 
                field: 'data', 
                label: 'cloud weather', 
                defaultParam: 'current' 
            },
            '/nightly-digest-stats': { 
                redisKey: 'summit-status:exposures', 
                field: 'data', 
                label: 'nightly digest', 
                redisAction: 'HSET',
                transform: (body) => ({
                    field: body.startDate || getFormattedDate(),
                    value: body.data.exposure_count.toString()
                })
            }
        }

        const route = STATS_MAP[req.path];
        if (!route) {
            return res.status(404).json({ status: "ERROR", message: "Incorrect endpoint."});
        }

        const payload = req.body[route.field];
        if (payload === undefined) {
            return res.status(204).json({ 
                status: "SUCCESS", 
                message: `No data to save for ${route.label}. This usually means an error occurred while querying the database or upstream API` 
            });
        }

        // special case for nightly digest
        if (route.redisAction === 'HSET' && route.transform) {
            const { field, value } = route.transform(req.body);
            await client.hSet(route.redisKey, field, value);
            return res.status(200).json({ status: "SUCCESS", message: `Saved ${route.label} to bucket ${field}` });
        }

        // all other routes
        const finalRedisKey = route.defaultParam 
            ? `${route.redisKey}-${req.body.params || route.defaultParam}` 
            : route.redisKey;

        await client.set(finalRedisKey, JSON.stringify(payload));
        return res.status(200).json({ status: "SUCCESS", message: `Saved ${route.label} data!` });
    }

    if(req.method == "DELETE") {
        const { date } = req.body; // Should be in format YYYYmmdd

        if (date=="all") {
            await client.del('summit-status:exposures'); // delete everything
            return res.status(200).json({ status: "SUCCESS", message: "All exposure history cleared." });
        } 
        if (date) {
            await client.hDel('summit-status:exposures', date);
            return res.status(200).json({ status: "SUCCESS", message: `Deleted bucket for ${date}` });
        } 
        return res.status(404).send("Nothing to delete. Please specify a date in YYYYmmdd format or `all`");
        
    }
    return res.status(400).send();
});
