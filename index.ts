import { createClient } from 'redis';
import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';

ff.http('summit-status', async (req: ff.Request, res: ff.Response) => {
    res.set('Access-Control-Allow-Origin', "*")
    res.set('Access-Control-Allow-Methods', 'GET, POST');

    if (req.method === "OPTIONS") {
        // Send response to OPTIONS requests
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
        
    } else if(req.method == "POST") {
        console.log("SummitStatusDataUpdater: Saving Data!"); // Used for querying Logging Explorer to find the "SummitStatusDataUpdater"

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
        let basicCloudSummitData = await client.get('summit-status:cloud-weather-current')

        let summitData = {
            current: (currentSummitData == null) ? { error: "No data available." } : JSON.parse(currentSummitData),
            hourly: (hourlySummitData == null) ? { error: "No data available." } : JSON.parse(hourlySummitData),
            daily: (dailySummitData == null) ? { error: "No data available." } : JSON.parse(dailySummitData),
            dome: (domeSummitData == null) ? { error: "No data available." } : JSON.parse(domeSummitData),
            basicWeather: (basicWeatherSummitData == null) ? { error: "No data available." } : JSON.parse(basicWeatherSummitData),
            cloudWeather: (basicCloudSummitData == null) ? { error: "No data available." } : JSON.parse(basicCloudSummitData)
        }
        return res.status(200).send(summitData);
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

