/**
 * CORS middleware for koa2: https://github.com/zadzbw/koa2-cors/blob/master/src/index.js
 *
 * @param {Object} [options]
 *  - {String|Function(ctx)} origin `Access-Control-Allow-Origin`, default is request Origin header
 *  - {Array} exposeHeaders `Access-Control-Expose-Headers`
 *  - {String|Number} maxAge `Access-Control-Max-Age` in seconds
 *  - {Boolean} credentials `Access-Control-Allow-Credentials`
 *  - {Array} allowMethods `Access-Control-Allow-Methods`,
 *    default is ['GET', 'PUT', 'POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
 *  - {Array} allowHeaders `Access-Control-Allow-Headers`
 * @return {Function}
 * @api public
 */
import { Context, Next } from 'koa';

export interface CorsOptions {
  origin?: string | ((ctx: Context) => string);
  exposeHeaders?: string[];
  maxAge?: number | string;
  credentials?: boolean;
  allowMethods?: string[];
  allowHeaders?: string[];
}

export default function crossOrigin(options: CorsOptions = {}) {
  const defaultOptions: Partial<CorsOptions> = {
    allowMethods: ['GET', 'PUT', 'POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  };

  // set defaultOptions to options
  const finalOptions = Object.assign({}, defaultOptions, options);

  // eslint-disable-next-line consistent-return
  return async function cors(ctx: Context, next: Next) {
    // always set vary Origin Header
    // https://github.com/rs/cors/issues/10
    ctx.vary('Origin');

    let origin: string;
    if (typeof finalOptions.origin === 'function') {
      origin = finalOptions.origin(ctx);
    } else {
      origin = finalOptions.origin || ctx.get('Origin') || '*';
    }
    if (!origin) {
      return await next();
    }

    // Access-Control-Allow-Origin
    ctx.set('Access-Control-Allow-Origin', origin);

    if (ctx.method === 'OPTIONS') {
      // Preflight Request
      if (!ctx.get('Access-Control-Request-Method')) {
        return await next();
      }

      // Access-Control-Max-Age
      if (finalOptions.maxAge) {
        ctx.set('Access-Control-Max-Age', String(finalOptions.maxAge));
      }

      // Access-Control-Allow-Credentials
      if (finalOptions.credentials === true) {
        // When used as part of a response to a preflight request,
        // this indicates whether or not the actual request can be made using credentials.
        ctx.set('Access-Control-Allow-Credentials', 'true');
      }

      // Access-Control-Allow-Methods
      if (finalOptions.allowMethods) {
        ctx.set('Access-Control-Allow-Methods', finalOptions.allowMethods.join(','));
      }

      // Access-Control-Allow-Headers
      if (finalOptions.allowHeaders) {
        ctx.set('Access-Control-Allow-Headers', finalOptions.allowHeaders.join(','));
      } else {
        ctx.set('Access-Control-Allow-Headers', ctx.get('Access-Control-Request-Headers'));
      }

      ctx.status = 204; // No Content
    } else {
      // Request
      // Access-Control-Allow-Credentials
      if (finalOptions.credentials === true) {
        if (origin === '*') {
          // `credentials` can't be true when the `origin` is set to `*`
          ctx.remove('Access-Control-Allow-Credentials');
        } else {
          ctx.set('Access-Control-Allow-Credentials', 'true');
        }
      }

      // Access-Control-Expose-Headers
      if (finalOptions.exposeHeaders) {
        ctx.set('Access-Control-Expose-Headers', finalOptions.exposeHeaders.join(','));
      }
      await next();
    }
  };
}
