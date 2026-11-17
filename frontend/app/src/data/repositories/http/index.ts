/**
 * Every repository function, implemented as a call to the API (VITE_DATA_SOURCE=http). Built from the endpoint
 * table, so it has exactly the fixture's functions and signatures.
 */
import { request } from './client';
import { ENDPOINTS, type Repo } from './endpoints';

export const http = Object.fromEntries(
  Object.entries(ENDPOINTS).map(([name, endpoint]) => [
    name,
    async (...args: any[]) => request(endpoint, (endpoint.call as (...a: unknown[]) => Parameters<typeof request>[1])(...args)),
  ]),
) as unknown as Repo;
