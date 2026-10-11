// file: src/api/server.ts
// description: Hono API server for ClawKeeper with multi-tenant support
// reference: src/api/routes/*.ts, orcaflow server pattern

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import { guardrails_middleware } from '../guardrails';
import { auth_routes } from './routes/auth';
import { invoice_routes } from './routes/invoices';
import { report_routes } from './routes/reports';
import { reconciliation_routes } from './routes/reconciliation';
import { agent_routes } from './routes/agents';
import { account_routes } from './routes/accounts';
import { create_dashboard_routes } from './routes/dashboard';
import { create_activity_routes } from './routes/activity';
import { create_vendor_routes } from './routes/vendors';
import { create_customer_routes } from './routes/customers';
import { create_metrics_routes } from './routes/metrics';
import { admin_routes } from './routes/admin';
import { websocket_handler } from './websocket_handler';
import { setup_routes } from './setup';
import type { AppEnv } from '../types/hono';

// Database connection. Without DATABASE_URL, the postgres companion from docker-compose.yml — the same
// credentials, reached on localhost because the two containers share a pod (or a host network).
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://clawkeeper:clawkeeper_local_password@localhost:5432/clawkeeper';
const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
});

// Create Hono app with typed environment
const app = new Hono<AppEnv>();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Guardrails middleware (rate limiting, PII detection, injection detection)
app.use('/api/*', guardrails_middleware);

// Tenant context middleware
app.use('/api/*', async (c, next) => {
  const auth_header = c.req.header('Authorization');
  
  if (!auth_header || !auth_header.startsWith('Bearer ')) {
    // Skip for public endpoints
    if (c.req.path === '/api/auth/login' || c.req.path === '/api/health' || c.req.path === '/api/agents/status' || c.req.path === '/api/admin/molten-sync') {
      return next();
    }
    
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = auth_header.substring(7);
  
  // Verify JWT signature and expiration
  try {
    const jwt_secret = process.env.JWT_SECRET;
    if (!jwt_secret) {
      console.error('[Auth] JWT_SECRET not configured');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    const decoded = jwt.verify(token, jwt_secret) as {
      tenant_id: string;
      user_id: string;
      role: string;
    };
    
    // Set context for this request
    c.set('tenant_id', decoded.tenant_id);
    c.set('user_id', decoded.user_id);
    c.set('user_role', decoded.role);
    
    // Set PostgreSQL session variables for RLS (use unsafe for SET commands)
    try {
      await sql.unsafe(`SET app.current_tenant_id = '${decoded.tenant_id}'`);
      await sql.unsafe(`SET app.current_user_id = '${decoded.user_id}'`);
      await sql.unsafe(`SET app.current_user_role = '${decoded.role}'`);
    } catch (error) {
      // RLS variables may not be configured, continue anyway
      console.warn('[Auth] Could not set RLS variables:', error);
    }
    
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    if (error instanceof jwt.TokenExpiredError) {
      return c.json({ error: 'Token expired' }, 401);
    }
    console.error('[Auth] Token verification error:', error);
    return c.json({ error: 'Authentication failed' }, 401);
  }
});

// First-run setup: enter the LLM keys (outside /api, which requires a JWT)
app.route('/', setup_routes());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'clawkeeper-api',
    version: '0.1.0',
  });
});

// Routes
app.route('/api/auth', auth_routes(sql));
app.route('/api/invoices', invoice_routes(sql));
app.route('/api/reports', report_routes(sql));
app.route('/api/reconciliation', reconciliation_routes(sql));
app.route('/api/agents', agent_routes(sql));
app.route('/api/accounts', account_routes(sql));
app.route('/api/dashboard', create_dashboard_routes(sql));
app.route('/api/activity', create_activity_routes(sql));
app.route('/api/vendors', create_vendor_routes(sql));
app.route('/api/customers', create_customer_routes(sql));
app.route('/api/metrics', create_metrics_routes(sql));
app.route('/api/admin', admin_routes());

// WebSocket endpoint
app.get('/ws', (c) => {
  // Return upgrade info for HTTP GET (browser compatibility)
  return c.json({
    message: 'WebSocket endpoint ready',
    usage: 'Upgrade this connection to WebSocket protocol',
    stats: websocket_handler.get_stats(),
  });
});

// Start server
const port = Number(process.env.PORT) || 4004;

// Port 4004 is the canonical port per .env.ports
// Remove obsolete validation against 9100

console.log(`
╔═════════════════════════════════════════════════════════════════╗
║  🔐 ClawKeeper API Server                                       ║
╚═════════════════════════════════════════════════════════════════╝

Port:        ${port}
Environment: ${process.env.NODE_ENV || 'development'}
Database:    ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}
JWT Secret:  ${process.env.JWT_SECRET ? 'Configured' : '⚠️  NOT CONFIGURED - Using default'}

Health:      http://localhost:${port}/health
API:         http://localhost:${port}/api
Dashboard:   http://localhost:3000

Ready for requests...
`);

export default {
  port,
  fetch: app.fetch,
  websocket: {
    open: websocket_handler.open.bind(websocket_handler),
    message: websocket_handler.message.bind(websocket_handler),
    close: websocket_handler.close.bind(websocket_handler),
    error: websocket_handler.error.bind(websocket_handler),
  },
};

// Export websocket handler for use in agents
export { websocket_handler, emit_agent_status } from './websocket_handler';
