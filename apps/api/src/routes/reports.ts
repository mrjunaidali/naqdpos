// Owner reports (US047–US049, US068; architecture §5, §9). Thin: the route checks the caller is
// the shop's owner (can(role, 'see_reports')) and the range, then calls the owner-only SQL
// function, which checks the owner role again (both layers, CLAUDE.md rule 7). CSV is built from
// the same JSON with the core functions the app uses for its offline export.
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  can,
  ErrorResponse,
  ExpenseReportQuery,
  ExpenseReportSchema,
  expensesCsv,
  ProductReportSchema,
  productsCsv,
  ReportQuery,
  ReportSummarySchema,
  staffCsv,
  StaffReportSchema,
  validateRange,
} from '@naqdpos/core';
import { sql, type RawBuilder } from 'kysely';
import type { z } from 'zod';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx, type TxContext } from '../db/index.ts';
import { shopRole } from '../db/roles.ts';
import { errorBody, pgCode } from '../errors.ts';
import { requireUser } from './require-user.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const errors = {
  400: { description: 'Bad range (from <= to, at most 366 days)', content: json(ErrorResponse) },
  401: { description: 'Not signed in', content: json(ErrorResponse) },
  403: { description: 'Not the owner of this shop', content: json(ErrorResponse) },
};

function reportRoute<Q extends z.ZodObject, R extends z.ZodType>(
  name: string,
  query: Q,
  response: R,
  csv: boolean,
) {
  return createRoute({
    method: 'get',
    path: `/reports/${name}`,
    summary: `Owner report: ${name}${csv ? ' (JSON, or CSV with format=csv)' : ''}`,
    security: [{ bearer: [] }],
    request: { query },
    responses: {
      200: {
        description: 'The report',
        content: {
          ...json(response),
          ...(csv && { 'text/csv': { schema: { type: 'string' as const } } }),
        },
      },
      ...errors,
    },
  });
}

const summaryRoute = reportRoute('summary', ReportQuery, ReportSummarySchema, false);
const productsRoute = reportRoute('products', ReportQuery, ProductReportSchema, true);
const staffRoute = reportRoute('staff', ReportQuery, StaffReportSchema, true);
const expensesRoute = reportRoute('expenses', ExpenseReportQuery, ExpenseReportSchema, true);

type Outcome = { ok: true; value: unknown } | { ok: false; status: 400 | 403; message?: string };

export function reportRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/reports/*', requireUser(deps.auth));

  async function run(
    context: TxContext,
    q: { shop_id: string; from: string; to: string },
    query: RawBuilder<{ r: unknown }>,
  ): Promise<Outcome> {
    const range = validateRange(q.from, q.to);
    if (range) return { ok: false, status: 400, message: range };
    try {
      return await withUserTx(deps.db, context, async (tx) => {
        if (!can(await shopRole(tx, q.shop_id), 'see_reports'))
          return { ok: false, status: 403 } as const;
        const { rows } = await query.execute(tx);
        return { ok: true, value: rows[0]?.r } as const;
      });
    } catch (error) {
      const code = pgCode(error);
      if (code === '42501') return { ok: false, status: 403 };
      if (code === '22023' || code === '22007' || code === '22008')
        return { ok: false, status: 400 };
      throw error;
    }
  }
  const failed = (o: Extract<Outcome, { ok: false }>) =>
    o.status === 403 ? errorBody('forbidden') : errorBody('bad_request', o.message);
  const csvResponse = (body: string, name: string, q: { from: string; to: string }) =>
    new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}-${q.from}-${q.to}.csv"`,
      },
    });

  app.openapi(summaryRoute, async (c) => {
    const q = c.req.valid('query');
    const r = await run(
      c.get('tx'),
      q,
      sql`select report_summary(${q.shop_id}::uuid, ${q.from}::date, ${q.to}::date) as r`,
    );
    if (!r.ok) return c.json(failed(r), r.status);
    return c.json(ReportSummarySchema.parse(r.value), 200);
  });

  app.openapi(productsRoute, async (c) => {
    const q = c.req.valid('query');
    const r = await run(
      c.get('tx'),
      q,
      sql`select report_products(${q.shop_id}::uuid, ${q.from}::date, ${q.to}::date) as r`,
    );
    if (!r.ok) return c.json(failed(r), r.status);
    const rows = ProductReportSchema.parse(r.value);
    if (q.format === 'csv') return csvResponse(productsCsv(rows), 'products', q);
    return c.json(rows, 200);
  });

  app.openapi(staffRoute, async (c) => {
    const q = c.req.valid('query');
    const r = await run(
      c.get('tx'),
      q,
      sql`select report_staff(${q.shop_id}::uuid, ${q.from}::date, ${q.to}::date) as r`,
    );
    if (!r.ok) return c.json(failed(r), r.status);
    const rows = StaffReportSchema.parse(r.value);
    if (q.format === 'csv') return csvResponse(staffCsv(rows), 'staff', q);
    return c.json(rows, 200);
  });

  app.openapi(expensesRoute, async (c) => {
    const q = c.req.valid('query');
    const r = await run(
      c.get('tx'),
      q,
      sql`select report_expenses(${q.shop_id}::uuid, ${q.from}::date, ${q.to}::date,
        ${q.category_id ?? null}::uuid, ${q.method_code ?? null}::text, ${q.staff_id ?? null}::uuid) as r`,
    );
    if (!r.ok) return c.json(failed(r), r.status);
    const report = ExpenseReportSchema.parse(r.value);
    if (q.format === 'csv') return csvResponse(expensesCsv(report.lines), 'expenses', q);
    return c.json(report, 200);
  });

  return app;
}
