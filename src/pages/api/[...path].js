import { env } from 'cloudflare:workers';
import { handleApi } from '../../lib/api.js';
import { D1Store } from '../../lib/store.js';

export const prerender = false;

export const ALL = ({ request, params }) => handleApi(request, `/${params.path ?? ''}`, new D1Store(env.DB));
