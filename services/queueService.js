import redis from '../config/redis.js';
import { getRequestById } from '../models/request.js';

const addToQueue = async (requestId, priorityScore) => {
  await redis.zAdd('float_queue', [{ score: priorityScore, value: String(requestId) }]);
};

const getQueuePosition = async (requestId) => {
  const rank = await redis.zRank('float_queue', String(requestId));
  return rank !== null ? rank + 1 : null;
};

const getNextRequest = async () => {
  const [requestId] = await redis.zRange('float_queue', 0, 0);
  if (requestId) {
    await redis.zRem('float_queue', requestId);
    return await getRequestById(requestId);
  }
  return null;
};

export { addToQueue, getQueuePosition, getNextRequest };