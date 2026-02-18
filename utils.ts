import { createClient } from 'redis';
import 'dotenv/config';

export const getFormattedDate = (offset: number = 0): string => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    
    const iso = date.toISOString(); // "YYYY-MM-DDT01:01:00.000Z"
    
    return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10); // YYYYMMDD
};

export async function getRedisClient() {
    const client = createClient({
        url: `redis://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASS}@${process.env.REDIS_IP}:${process.env.REDIS_PORT}`,
        socket: {
            connectTimeout: 30000
        }
    });

    return client;
}