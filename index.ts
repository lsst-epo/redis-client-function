import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import { getRedisClient } from './utils';

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
        let alertData = await client.get('summit-status:alert-current')
        let exposureData = await client.get('summit-status:exposures'); // exposure counts by day
        let dateLastRunData = await client.get('summit-status:date-last-run'); // when was nightly-digest-stats last run?

        let summitData = {
            current: (currentSummitData == null) ? { error: "No data available." } : JSON.parse(currentSummitData),
            hourly: (hourlySummitData == null) ? { error: "No data available." } : JSON.parse(hourlySummitData),
            daily: (dailySummitData == null) ? { error: "No data available." } : JSON.parse(dailySummitData),
            dome: (domeSummitData == null) ? { error: "No data available." } : JSON.parse(domeSummitData),
            basicWeather: (basicWeatherSummitData == null) ? { error: "No data available." } : JSON.parse(basicWeatherSummitData),
            cloudWeather: (basicCloudSummitData == null) ? { error: "No data available." } : JSON.parse(basicCloudSummitData),
            rawCurrentWeather: (rawCurrentWeatherSummitData == null) ? { error: "No data available." } : JSON.parse(rawCurrentWeatherSummitData),  // uses the raw `current` meteoblue package (rather than the forecast packages: basic and cloud)
            nightlyDigest: (nightlyDigestSummitData == null) ? { error: "No data available." } : JSON.parse(nightlyDigestSummitData),
            alert: (alertData == null) ? { error: "No data available." } : JSON.parse(alertData)
        }

        const totalExpectedExposureCount = Number(process.env.TOTAL_EXPECTED_EXPOSURES);
        const exposureCount = parseInt(exposureData || "0", 10) || 0;
        const surveyProgress = (totalExpectedExposureCount
            ? (exposureCount / totalExpectedExposureCount)
            : 0).toFixed(1); // use 1 decimal place since this is a back of the envelope calculation

        let widgetData = {
            weather: { 
                pictocode: summitData.rawCurrentWeather?.data_current?.pictocode_detailed ?? 0 
            },
            exposure: { 
                count: exposureCount // already defaults to 0
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
        
        if (req.path == '/') {
            return res.status(200).send(summitData);
        }
        
        if (req.path == '/widgets') {
            return res.status(200).send(widgetData);
        }

        if (req.path == '/full') {
            let fullData = {
                ...widgetData,
                dateLastRun: dateLastRunData
            }
            return res.status(200).send(fullData);
        }

        return res.status(404).send("404 Not Found");
    } 

    if(req.method == "POST") {
        console.info("SummitStatusDataUpdater: Saving Data!"); // Used for querying Logging Explorer to find the "SummitStatusDataUpdater"

        const STATS_MAP: Record<string, {
            redisKey: string,
            field: string,
            label: string,
            defaultParam?: string
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
            }
        }

        const route = STATS_MAP[req.path];
        if (!route) {
            return res.status(404).json({ status: "ERROR", message: "Incorrect endpoint."});
        }

        const payload = req.body?.[route.field];
        if (payload === undefined) {
            return res.status(204).json({ 
                status: "SUCCESS", 
                message: `No data to save for ${route.label}. This usually means an error occurred while querying the database or upstream API` 
            });
        }

        // special case for nightly digest
        if (req.path === '/nightly-digest-stats') {
            // validate new daily value
            const newValue = req.body.data?.exposure_count ?? 0; // req.body guaranteed to exist due to the payload === undefined check above.
            const lastRunKey = 'summit-status:date-last-run';
            const todayUTC = new Date().toISOString().split('T')[0]; // Format: "YYYY-mm-dd"
            const lastRunDate = await client.get(lastRunKey);
            console.info(`newValue: ${newValue}`);
            console.info(`req.body.params: ${req.body.params}`);

            console.info(`lastRunDate: ${lastRunDate}`);
            console.info(`todayUTC: ${todayUTC}`);

            let override = false;
            if (req.body?.params === 'reaccumulate') {
                console.info('reaccumulating');
                override = true;
            }

            if (!Number.isInteger(newValue)){
                return res.status(400).json({ status: "ERROR", message: "Invalid exposure_count "})
            }

            if (!override && lastRunDate !== null && (lastRunDate >= todayUTC)) {
                console.info('skipping ... nightly digest already processed for today')
                return res.status(429).json({ 
                    status: "SKIPPED", 
                    message: "Nightly digest already processed for today." 
                });
            }

            // add cached old value to new one
            const currentCache = await client.get('summit-status:exposures') ?? 0;
            const mergedValue = Number(currentCache) + Number(newValue);
            console.info(`mergedValue: ${mergedValue}`);

            // cache both the new value and when the last run was
            await client.set(route.redisKey, mergedValue);
            await client.set(lastRunKey, todayUTC);

            return res.status(200).json({ status: "SUCCESS", message: `Saved ${route.label} data!` });
        }

        // all other routes
        const finalRedisKey = route.defaultParam 
            ? `${route.redisKey}-${req.body.params || route.defaultParam}` 
            : route.redisKey;

        await client.set(finalRedisKey, JSON.stringify(payload));
        return res.status(200).json({ status: "SUCCESS", message: `Saved ${route.label} data!` });
    }

    if (req.method == "DELETE") {
        // delete desired key given the `key` query parameter
        const validKeys = new Set(['date-last-run', 'exposures']);
        const targetKey = req.query.key as string;

        if (!targetKey || !validKeys.has(targetKey)) {
            return res.status(400).json({ 
                status: "ERROR", 
                message: `Valid keys are: ` + Array.from(validKeys).join(', ') 
            });
        }

        const fullTargetKey = `summit-status:${targetKey}`;
        try {
            const result = await client.del(fullTargetKey);

            if (result === 1) {
                console.info(`Successfully cleared ${fullTargetKey}`);
                return res.status(200).json({ 
                    status: "SUCCESS", 
                    message: `${fullTargetKey} cache cleared successfully.`
                });
            }
            
            return res.status(404).json({ 
                status: "NOT_FOUND", 
                message: `${fullTargetKey} key did not exist in cache.`
            });
            
        } catch (error) {
            console.error(`Error deleting cache for ${fullTargetKey}:`, error);
            return res.status(500).json({ 
                status: "ERROR", 
                message: "Failed to clear cache." 
            });
        }
    }
    return res.status(400).json({ status: "error", reason: "bad request" })
});
