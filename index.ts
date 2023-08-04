import { createClient } from 'redis';
import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';

ff.http('summit-status', async (req: ff.Request, res: ff.Response) => {

    if(req.method == "POST") {
        console.log("SummitStatusDataUpdater: Saving Data!"); // Used for querying Logging Explorer to find the "SummitStatusDataUpdater"

        const client = await getClient();
        await client.connect();

        await client.hSet('summit-status:current', req.body.digest.current);

        await client.set("summit-status:daily", JSON.stringify(req.body.digest.daily));

        await client.set('summit-status:hourly', JSON.stringify(req.body.digest.hourly));

        return res.status(200).send("Saved data!");

    } else if(req.method == "GET") {
        const client = await getClient();
        await client.connect();

        let currentSummitData = await client.hGetAll('summit-status:current');
        let hourlySummitData = await client.get('summit-status:hourly');
        let dailySummitData = await client.get('summit-status:daily');

        let summitData = {
            current: currentSummitData,
            hourly: JSON.parse(String(hourlySummitData)),
            daily: JSON.parse(String(dailySummitData))
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

