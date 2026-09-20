import { createClient } from 'redis';
import dotenv from "dotenv";
dotenv.config({quiet: true});

const client = createClient({
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        tls: true,
    }
});

client.on('error', err => console.log('❌ Redis Client Error', err));

client.on("ready", () => {
  console.log("✅ Redis client connected and ready to use!");
});

await client.connect();

export default client;