import { createClient } from 'redis';
import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';

ff.http('summit-status', async (req: ff.Request, res: ff.Response) => {
    res.set('Access-Control-Allow-Origin', "*")
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") {
        // Send response to OPTIONS requests
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
        
    } else if(req.method == "POST") {
        console.log("SummitStatusDataUpdater: Saving Data!"); // Used for querying Logging Explorer to find the "SummitStatusDataUpdater"

        const authHeader = req.headers.authorization;
        const REDIS_BEARER_TOKEN = process.env.REDIS_BEARER_TOKEN;

        if (!authHeader || authHeader !== `Bearer ${REDIS_BEARER_TOKEN}`) {
            console.error('Unauthorized attempt');
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized: Missing or invalid token."
            })
        }

        const client = await getClient();
        await client.connect();

        if(req.path == "/current-stats") {
            if(req.body.current == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while querying the EFD database."});
            } else {
                await client.set('summit-status:current', JSON.stringify(req.body.current));
                return res.status(200).json({ status: "SUCCESS", message: "Saved current stats data!"});
            }
        } else if(req.path == "/hourly-stats") {
            if(req.body.hourly == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while querying the EFD database."});
            } else {
                await client.set('summit-status:hourly', JSON.stringify(req.body.hourly));
                return res.status(200).json({ status: "SUCCESS", message: "Saved hourly stats data!"});
            }
        } else if(req.path == "/daily-stats") {
            if(req.body.daily == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while querying the EFD database."});
            } else {
                await client.set("summit-status:daily", JSON.stringify(req.body.daily));
                return res.status(200).json({ status: "SUCCESS", message: "Saved daily stats data!"});
            }
        } else if(req.path == "/dome-stats") {
            if(req.body.dome == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while querying the EFD database."});
            } else {
                await client.set("summit-status:dome", JSON.stringify(req.body.dome));
                return res.status(200).json({ status: "SUCCESS", message: "Saved dome stats data!"});
            }
        } else if(req.path == "/basic-weather-stats") {
            if(req.body.data == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while querying the Weather API."});
            } else {
                const mode = req.body.params || 'current';
                const cacheKey = `summit-status:basic-weather-${mode}`;
                await client.set(cacheKey, JSON.stringify(req.body.data));
                return res.status(200).json({ status: "SUCCESS", message: `Saved basic weather data!`});
            }
        } else if(req.path == "/cloud-weather-stats") {
            if(req.body.data == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while querying the Weather API."});
            } else {
                const mode = req.body.params || 'current';
                const cacheKey = `summit-status:cloud-weather-${mode}`;
                await client.set(cacheKey, JSON.stringify(req.body.data));
                return res.status(200).json({ status: "SUCCESS", message: "Saved cloud weather data!"});
            }
        } else if(req.path == "/raw-current-weather-stats") {
            if(req.body.data == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while querying the Weather API."});
            } else {
                const cacheKey = `summit-status:raw-current-weather-data`;
                await client.set(cacheKey, JSON.stringify(req.body.data));
                return res.status(200).json({ status: "SUCCESS", message: "Saved raw current weather data!"});
            }
        } else if(req.path == "/nightly-digest-stats") {
            if(req.body.data == undefined) {
                return res.status(204).json({ status: "SUCCESS", message: "No data to save! This usually means an error occurred while updating the data for the Nightly Digest API."});
            } else {
                const cacheKey = `summit-status:nightly-digest`;
                const newData = req.body.data;
                const oldDataRaw = await client.get(cacheKey);
                let oldData = { exposure_count: 0 }
                if (oldDataRaw === null) {
                    console.error(`No existing data found for redis key: ${cacheKey}`)
                } else {
                    try {
                        oldData = JSON.parse(oldDataRaw);
                    } catch (error) {
                        console.error(`Could not parse oldData for redis key: ${cacheKey}`)
                    }
                }

                const mergedData = {
                    ...newData,
                    exposure_count: (oldData.exposure_count || 0) + (newData.exposure_count || 0)
                }
                
                await client.set(cacheKey, JSON.stringify(mergedData));
                return res.status(200).json({ status: "SUCCESS", message: "Saved nightly digest data!", cachedData: JSON.stringify(mergedData)});
            }
        } else {
            return res.status(404).json({ status: "ERROR", message: "Incorrect endpoint."});
        }

    } else if(req.method == "GET") {
        const client = await getClient();
        await client.connect();

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
        } else if (req.path == '/widgets') {
            const exposureCount = summitData.nightlyDigest?.exposure_count ?? 0;
            const totalExpectedExposureCount = process.env.TOTAL_EXPECTED_EXPOSURE_COUNT ?? summitData.survey?.totalExpectedExposureCount;
            const surveyProgress = (totalExpectedExposureCount
                ? (exposureCount / totalExpectedExposureCount)
                : 0).toFixed(2);

            let widgetData = {
                weather: { 
                    pictocode: summitData.rawCurrentWeather?.data_current?.pictocode_detailed ?? 0 
                },
                exposure: { 
                    count: summitData.nightlyDigest?.exposure_count ?? 0 
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
        } else {
            return res.status(404).send("404 Not Found");
        }
    } else {
        return res.status(400).send();
    }
});

async function getClient() {
    const client = createClient({
        url: `redis://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASS}@${process.env.REDIS_IP}:${process.env.REDIS_PORT}`,
        socket: {
            connectTimeout: 30000
        }
    });

    client.on('error', err => console.log('Redis Client Error', err));

    return client;
}

